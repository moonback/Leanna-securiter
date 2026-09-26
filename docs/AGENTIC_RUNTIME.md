# Leanna — Runtime agentique

Date de mise à jour : 2026-09-24.

Ce document décrit le **runtime agentique** de Leanna : la boucle qui donne réellement
leurs outils aux agents et qui exécute une tâche via
`analyse → plan → écriture → vérification → correction → re-vérification`, avec un budget
de mission et un état de fichiers adressé par contenu.

Il complète :
- [`LEANNA_EXECUTION_REALITY_AUDIT.md`](LEANNA_EXECUTION_REALITY_AUDIT.md) — qui décrivait
  l'écart « outils déclarés mais non fournis » que ce runtime corrige.
- [`AUTONOMY_CONTRACT.md`](AUTONOMY_CONTRACT.md) — le contrat d'autonomie global.

---

## 1. Le problème corrigé

Avant : les agents **déclaraient** des `capabilities` (créer / renommer / supprimer des
fichiers…) mais l'exécuteur legacy (`AgentExecutor`) ne leur donnait pas réellement ces
outils. Il envoyait un prompt libre, puis **devinait** les appels d'outils dans le texte de
sortie du modèle, contre une liste blanche codée en dur (`EXECUTABLE_AGENT_TOOLS`) découplée
des capabilities déclarées.

Symptôme observé en production : un agent débogueur passait 5 tours à explorer, puis émettait
6 écritures au 6ᵉ tour — mais le budget était déjà dépassé (`41 > 30`), la boucle s'arrêtait,
et **les écritures étaient jetées** → 0 fichier modifié après 174 s.

Le flux est passé de :

```text
User → Router → Agent → LLM → Response
```

à une vraie boucle agentique :

```text
User → Intent/Task Analyzer → Planner → Execution Engine
        ┌───────────────────────────────────────────────┐
        │  Tool call → Observation → Reasoning →          │
        │  Next action → Verification                     │
        └───────────────────────────────────────────────┘
        → Finalizer → User
```

---

## 2. Architecture

```text
agent_orchestrate / delegateTask / TaskScheduler / AutonomousLoop / AutonomousAgent
        │  (interface partagée : AgentTaskRunner)
        ▼
   AgentRuntimeExecutor            server/agents/AgentRuntimeExecutor.ts
        ▼
   AgentRuntime (agentique)        server/runtime/agentic/AgentRuntime.ts
        ├─ ToolRegistry            server/runtime/ToolRegistry.ts   (permissions, dry-run, timeout, métriques)
        ├─ WorkspaceState          server/agents/WorkspaceState.ts  (hash SHA-256, verification record)
        └─ AgentRepairLoop         server/agents/AgentRepairLoop.ts (réparation bornée et progressive)
```

### Fichiers clés

| Fichier | Rôle |
|---|---|
| `server/runtime/agentic/types.ts` | Contrats : `AgentTask`, `Plan`, `PlanStep`, `Observation`, `Verification`, `Recovery`, `AgentResult`, `AgentBudget`, `BudgetUsage`, `IAgentRuntime`. |
| `server/runtime/agentic/AgentRuntime.ts` | La boucle : `run / plan / execute / verify / recover / finalize`. |
| `server/runtime/agentic/ToolPromptBuilder.ts` | Résolution des outils réels de l'agent + sections de prompt (outils, budget, historique). |
| `server/runtime/agentic/index.ts` | Barrel + `createAgentRuntime(runtime, { budget })`. |
| `server/agents/AgentTaskRunner.ts` | Interface partagée `{ execute, runTool? }` implémentée par les deux moteurs. |
| `server/agents/AgentRuntimeExecutor.ts` | Adaptateur `AgentTask ⇄ AgentResult` branché sur le runtime agentique. |

---

## 3. La boucle (OBSERVE → PLAN → ACT → VERIFY → RECOVER → COMPLETE)

`IAgentRuntime` (server/runtime/agentic/types.ts) :

```ts
interface IAgentRuntime {
  run(task: AgentTask): Promise<AgentResult>;
  plan(task: AgentTask): Promise<Plan>;
  execute(task: AgentTask, step: PlanStep): Promise<Observation>;
  verify(step: PlanStep, observation: Observation): Promise<Verification>;
  recover(error: AgentError): Promise<Recovery>;
  finalize(task: AgentTask): Promise<FinalResult>;
}
```

1. **PLAN** — le LLM produit un plan JSON (`intent`, `successCriteria`, `steps[]`).
2. **ACT** — pour chaque étape, un prompt **outillé** est construit : les outils réellement
   disponibles de l'agent (intersection `capabilities ∩ ToolRegistry`) sont exposés au modèle,
   qui répond en `tool_calls`. Chaque appel passe par `ToolRegistry.call()`.
3. **OBSERVE** — chaque appel produit un `ToolCallOutcome` structuré (succès/erreur, résultat
   tronqué, `cached`).
4. **VERIFY** — pour chaque fichier écrit : `verify_file` → `VerificationRecord` hashé →
   `WorkspaceState.recordVerification()` → l'étape ne passe que si `hash after == hash courant`.
5. **RECOVER** — en cas d'échec, `AgentRepairLoop.assess()` décide `retry / replan / abort`.
6. **COMPLETE** — synthèse finale + `AgentResult` (fichiers modifiés, outils exécutés,
   vérifications, budget consommé).

Un agent ne peut appeler **que** les outils qu'il a réellement (les autres sont refusés dans
la boucle, jamais exécutés).

---

## 4. Budget de mission (valeurs absolues = source de vérité)

Le budget est un **budget de mission par phase**, en valeurs absolues. Les fractions ne sont
que dérivées (affichage / diagnostic), jamais la source de vérité.

`AgentBudget` (server/runtime/agentic/types.ts) — défaut :

| Phase | Quota | Nature |
|---|---|---|
| `maxRead` | 8 | exploration (lecture / recherche) — **plafonné** |
| `maxPlan` | 3 | (re)planification / divers |
| `maxWrite` | 9 | écriture — **réservé** |
| `maxVerify` | 6 | vérification — **réservé** |
| `maxRecovery` | 4 | correction — **réservé** |
| `maxToolCalls` | 30 | total = somme des phases (dérivé via `normalizeBudget`) |

Règles :

- **Réserves étanches** — les quotas `write` / `verify` / `recovery` **ne peuvent pas** être
  consommés par l'exploration. Après la découverte, l'agent a toujours de quoi écrire ET
  vérifier. (`admitCall()` refuse une lecture au-delà de `maxRead` mais admet toujours une
  écriture/vérification tant que son quota tient.)
- **Comptabilité séparée** — `BudgetUsage` suit `readCalls / writeCalls / verifyCalls /
  recoveryCalls / otherCalls`, plus `filesRead / filesModified`.
- **Arrêt intelligent** — la boucle ne s'arrête sur le budget d'outils que lorsque **tous**
  les quotas de phase sont épuisés (en plus des limites dures : itérations, temps, coût).
- Limites dures additionnelles : `maxIterations` (20), `maxExecutionTimeMs` (5 min),
  `maxCost` (∞ par défaut).

---

## 5. Écritures transactionnelles + vérification hashée

Le défaut le plus dangereux du legacy — **des écritures réussies jetées quand le budget
tombe** — est corrigé. Chaîne exacte :

```text
WRITE (tool call)
  → handler exécuté et réussi
  → WorkspaceState.reread(path, "write")  (relecture + hash SHA-256)   ← ENREGISTRÉ IMMÉDIATEMENT
  → verify_file → VerificationRecord { hashBefore, hashAfter, ok, issues }
  → WorkspaceState.recordVerification()
  → HASH MATCH ?
       ├─ OUI → progrès (état "verified")
       └─ NON → AgentRepairLoop.assess() → retry / replan / stop
```

Une écriture confirmée est enregistrée dans `session.filesModified` **dès le retour du
handler**, avant tout contrôle de budget. Une limite atteinte plus tard n'annule jamais une
modification déjà émise. Le `VerificationRecord` (hash avant/après) est **conservé** dans le
`WorkspaceState`, jamais jeté.

### Réparation bornée (`AgentRepairLoop`)

`recover()` délègue à `AgentRepairLoop.assess()` par fichier, qui détecte :

- patch identique répété → `stop`
- absence de progrès (2 stalls) → `stop`
- régression forte (issue critique / explosion du nombre d'issues) → `stop`
- progrès mesurable → `continue` (retry ciblé)

Ainsi : `attempt 1 → fail → repair`, `attempt 2 → fail → repair`, `attempt 3 → même patch →
STOP`, au lieu d'un `retry++` infini.

---

## 6. Cache de contexte (anti search→read→search)

Les outils de lecture (`read_project_file`, `read_file_outline`, `list_project_files`,
`search_in_files`, `analyze_project_file`) sont mis en cache par `nom + paramètres` pendant un
run. Un appel identique déjà effectué est resservi (`cached: true`) sans nouvel appel ni
consommation de budget.

---

## 7. Migration (phases)

| Phase | Contenu | Statut |
|---|---|---|
| 1 | Runtime agentique + contrat `IAgentRuntime` (outils réellement fournis) | ✅ |
| 2 | Budget de mission absolu 8/3/9/6/4 (total 30), réserves étanches | ✅ |
| 3 | Écritures transactionnelles (jamais jetées) | ✅ |
| 4 | `WorkspaceState` + `VerificationRecord` + `AgentRepairLoop` câblés dans le runtime | ✅ |
| 5 | `AutonomousLoop` / `AutonomousAgent` / `AgentRegistry` / `TaskScheduler` / `delegateTask` sur le moteur partagé `AgentTaskRunner` | ✅ |
| 5.5 | Modèle déterministe injectable + Autonomous Mission Harness (bout en bout) ; `setRunner` protégé pendant une mission active | ✅ |
| 6 | Contrat `AgentTaskRunner` (10 invariants) + suite commune contre les deux moteurs | ✅ |
| 6.4 | Vérification d'étape du Brain routée sur `WorkspaceState` (verify_file hashé) | ✅ |
| 6.5 | Supervisor Harness (bout en bout) : `AgentBrain.executeGoal` sur DAG + vérification hashée + correction | ✅ |

Point de bascule : `AgentOrchestrator.enableAgenticRuntime(agentic)` (appelé au bootstrap)
remplace le moteur d'exécution par `AgentRuntimeExecutor` pour :
`orchestrate`, `delegateTask`, le `TaskScheduler` **et** la flotte autonome
(`AgentRegistry.setRunner`).

`AgentExecutor` (legacy) reste disponible **derrière la même interface** `AgentTaskRunner`
mais n'est plus le moteur principal — plus de fallback silencieux pour `agent_orchestrate`.

---

## 7bis. Contrat `AgentTaskRunner` (10 invariants)

Deux moteurs implémentent `AgentTaskRunner` (`AgentExecutor` legacy et
`AgentRuntimeExecutor` agentique). Pour éviter qu'ils divergent, une suite de contrat
COMMUNE (`server/agents/AgentTaskRunnerContract.test.ts`) vérifie les mêmes invariants contre
les deux, de façon hermétique :

1. statut terminal après `execute()` ; 2. `result` toujours cohérent ; 3. erreurs normalisées
sans fuite d'exception ; 4. annulation supportée ; 5. exécution d'outils via un point unique ;
6. `filesModified` fiable ; 7. aucune écriture non comptabilisée ; 8. exécution bornée ;
9. vérification observable ; 10. résultat déterministe.

> Le contrat a immédiatement attrapé un vrai bug commun aux deux moteurs :
> `ProgressNotifier.notify()` levait pour un rôle inconnu (via `getAgentDefinitionOrThrow`),
> l'exception s'échappant de `execute()` (violation de l'invariant 3). Corrigé : le notifier
> résout le nom de façon défensive (`getAgentDefinition` + repli sur le rôle) et ne peut plus
> faire crasher l'exécuteur.

---

## 7ter. Superviseur multi-agents (`AgentBrain`) sur la vérification hashée

Le superviseur multi-agents **existe déjà** : `AgentBrain.executeGoal` est le
`SUPERVISOR → PLANNER → TASK GRAPH → VERIFIER → REPAIR → SUPERVISOR` :

```text
planGoal (understanding + planner → DAG)
   ↓
BrainScheduler (fan-out / fan-in parallèle, dépendances)
   ↓  par étape
executeStage → delegateTask → moteur agentique (depuis la Phase 5)
   ↓
BrainVerifier.verifyStage  ── vérification HASHÉE (depuis 6.4) ──┐
   ↓                                                             │
(PASS → étape suivante) | (FAIL → BrainCorrectionLoop → re-verify)
   ↓
replanSubgraph (réplanification bornée du sous-graphe restant)
   ↓
BrainExecutionResult
```

**Vérification d'étape hashée (6.4)** — `BrainVerifier` reçoit un `runTool` injectable. Quand
il est présent, chaque fichier modifié par une étape est revérifié via `verify_file` →
`VerificationRecord` → `WorkspaceState.recordVerification` ; l'étape ne passe que si le hash
vérifié correspond au contenu courant. Sans `runTool`, l'ancien contrôle superficiel est
conservé (rétrocompatibilité). Le `runTool` est fourni par
`AgentOrchestrator.runTool` (délégué au moteur actif) lorsque `canRunTool` est vrai.

Aucun nouvel orchestrateur « AgentRuntime 2.0 » n'a été créé : cela aurait dupliqué
l'`AgentBrain`. Le superviseur roule sur le moteur agentique durci.

---

## 8. Vérification / typecheck

- `verify_typecheck` et `verify_full` exécutent **directement** `npx tsc --noEmit --incremental`
  (ils ne dépendent pas de `package.json`). `verify_file` utilise l'API compilateur TypeScript
  en mémoire, filtrée au fichier ciblé.
- Le script `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) existe pour
  `verify_run_script("typecheck")` (liste blanche : `build`, `lint`, `typecheck`, `test`).

---

## 9. Utilisation

```ts
import { bootstrapRuntime } from "./server/runtime";

const { agentic } = await bootstrapRuntime({ /* skills, ... */ });

const result = await agentic.run({
  role: "debugger",
  goal: "Analyse le projet et corrige les erreurs TypeScript.",
  // budget: { maxWrite: 12 }  // surcharge optionnelle (fusionnée + normalisée)
});

console.log(result.outcome, result.filesModified, result.budgetUsage);
```

Budget par défaut surchargé au bootstrap : `bootstrapRuntime({ agenticBudget: { maxRead: 6 } })`.

---

## 10. Tests

- `server/runtime/agentic/agentic.test.ts` — 12 scénarios : write→verify ok ; write→verify
  échoué→repair ; patch répété→stop ; budget récupération épuisé→stop ; budget write
  épuisé→plus d'écriture ; réserve verify disponible après writes ; `VerificationRecord`
  conservé ; hash avant/après ; budget absolu 8/3/9/6/4 ; résolution d'outils ; rôle inconnu.
- `server/agents/AgentTaskRunner.test.ts` — conformité au contrat partagé, `AutonomousLoop`
  contre un runner arbitraire, `AgentRegistry.setRunner` préservant la flotte.
- `server/agents/AgentTaskRunnerContract.test.ts` — suite de contrat commune exécutée contre
  les DEUX moteurs (10 invariants).
- `server/runtime/agentic/mission-harness.test.ts` — Autonomous Mission Harness (modèle
  déterministe) : success ; failure→repair→pass ; no-progress→stop ; budget réservé.
- `server/agents/brain/supervisor-harness.test.ts` — Supervisor Harness : `AgentBrain.executeGoal`
  sur un DAG avec vérification d'étape HASHÉE (`WorkspaceState`) et correction autonome.
