# Leanna — Audit d'exécution réelle (Real vs Registered)

> **Mise à jour 2026-09-24** — L'écart « outils déclarés mais non fournis » décrit dans cet
> audit est désormais corrigé par le **runtime agentique**. Voir
> [`AGENTIC_RUNTIME.md`](AGENTIC_RUNTIME.md). Les chemins d'exécution
> (`agent_orchestrate`, `delegateTask`, `TaskScheduler`, flotte autonome) passent maintenant
> par un moteur partagé (`AgentTaskRunner` → `AgentRuntimeExecutor` → runtime agentique) avec
> budget de mission, écritures transactionnelles et vérification hashée. Les sections
> ci-dessous reflètent l'état **antérieur** à cette migration (Phases 1–5).

Date : 2026-09-23. Objectif : distinguer ce que Leanna **exécute réellement de bout en bout
au runtime** de ce qui est seulement **enregistré, initialisé ou déclaré** dans
l'architecture. Chaque verdict est prouvé par un appelant concret (fichier:ligne) tracé dans
le code exécuté (le miroir `.Leanna/sandbox/` est ignoré).

Complète [`LEANNA_AUTONOMY_MASTER_AUDIT.md`](LEANNA_AUTONOMY_MASTER_AUDIT.md) (qui cartographie
les boucles cognitives) en se concentrant ici sur **l'activation runtime effective**.

## Légende des verdicts

| Verdict | Signification |
|---|---|
| `FULLY_EXECUTED` | Chemin runtime réel, atteint à chaque exécution live. |
| `REACHABLE_VIA_ROUTE` | S'exécute réellement, mais seulement quand une route HTTP / un skill / Telegram le déclenche. |
| `ACTIVE_ONLY_WITH_CONFIG` | Actif uniquement si une config externe est présente (Supabase, projet sélectionné) ; sinon no-op silencieux **par conception**. |
| `REGISTERED_ONLY` | Construit/initialisé et consulté, mais ne pilote jamais l'exécution lui-même. |
| `ORPHAN` | Aucun appelant runtime ; seulement tests et/ou export barrel. |

## 1. La chaîne de bootstrap réelle (le pivot)

```text
server.ts (top-level)
  ├─ bootstrapRuntimeSync({ skills, onReady })            server.ts:290
  │    └─ onReady (async) :
  │         ├─ new Executor()                              server.ts:312
  │         ├─ executor.setSkillHandler / setLLMDecompose / setLLMReflect
  │         │   / setLLMArgGen / setLLMVerify / setToolSchemas / setStore
  │         │   / setAutonomyPolicy                        server.ts:312-357
  │         ├─ initMissionSystem(executor, skillNames)     server.ts:359
  │         ├─ sm._missionExecutor = executor              server.ts:364
  │         └─ executor.resumePending(skillNames)          server.ts:371
  ├─ new AutonomyPersistence()                             server.ts:391
  ├─ new LeannaCore(runtime, { persistence, executive.executeMission, onTask })
  ├─ leannaCore.start()                                    server.ts:427
  └─ agentOrchestrator.setSkillHandler(...)                server.ts:431
        └─ registry.initialize(handler)                    AgentOrchestrator.ts:63
              └─ for role of listAgentRoles():
                    new AutonomousAgent(role,...).start()   AgentRegistry.ts:77-81
```

**Fait critique de fragilité** : `bootstrapRuntimeSync` (la variante utilisée en prod,
`server/runtime/bootstrap.ts`) **n'appelle PAS** `agentOrchestrator.setSkillHandler`. Seule la
variante asynchrone `bootstrapRuntime` (non utilisée) le ferait. Toute la flotte d'agents
dépend donc de **la ligne top-level `server.ts:431`**. Si elle disparaissait,
`agentRegistry.isReady` resterait `false`, `getAgent` lèverait, et la flotte + délégation +
boucles autonomes deviendraient silencieusement orphelines. → Voir Recommandation R-1.

## 2. Verdict par composant

### AutonomousExecutive — `FULLY_EXECUTED`
- Instancié par `LeannaCore` quand `options.executive` est fourni (LeannaCore.ts, constructeur).
- `LeannaCore.start()` (server.ts:427) s'abonne à `EventBus.onAny` → `handleEvent` →
  `TaskManager.submit` → worker → `executive.execute()` → `decide()`.
- **Réellement exécuté** : perception déterministe, création/dédup d'objectif, priorité,
  décision, puis `executeMission` (voir §3). Preuve : `LeannaCore.ts:handleEvent` +
  `TaskManager` worker + `server.ts:394-426`.

### Mission Executor (Planner / SkillScorer / Reflection / verifyGoalCriteria) — `FULLY_EXECUTED`
- **Câblage LLM réel** (pas de fallback heuristique en prod) : `setLLMDecompose`,
  `setLLMReflect`, `setLLMArgGen`, `setLLMVerify` reçoivent tous `llmText` =
  `generateText({prompt, temperature:0.3})` (server.ts:318-324).
- Skill handler réel : `setSkillHandler((name,args,opts)=>sm.handleToolCall(...))`
  (server.ts:312-314).
- Boucle réelle : `executeMission → executeGoalsScheduled` (vagues de dépendances,
  parallèle, fan-in) / `executeGoalDirectly` (plan→act→reflect→retry/replan/escalate,
  garde `maxIterations=100`), puis `verifyGoalCriteria` (LLM + repli heuristique),
  `finalizeMission → proposeLearning`.
- **Nuance** : la persistance des missions (`MissionStore`) est `ACTIVE_ONLY_WITH_CONFIG`
  (no-op sans Supabase) — mais l'exécution, elle, est complète.

### Chaîne LeannaCore → executeMission → missionExecutor.startMission — `FULLY_EXECUTED` (avec déferrement intentionnel)
- `executeMission` résout l'executor **paresseusement** : `const executor =
  skillManager.missionExecutor;` (server.ts:398). S'il est `null` (fenêtre de démarrage,
  car `_missionExecutor` n'est posé qu'en `onReady` async, server.ts:364, alors que
  `leannaCore.start()` est synchrone, server.ts:427), il retourne
  `{ success:false, escalate:true }` (server.ts:400) — **il ne crashe pas et ne contourne
  pas** le pipeline plan/permission/dry-run. Après `onReady`, la chaîne est pleinement live.
- Preuve du design de déferrement : un `setInterval` (server.ts:~858) attend aussi que
  `missionExecutor` soit non-null avant de brancher le broadcaster WebSocket des missions.

### SkillScorer + StrategyMemory — `FULLY_EXECUTED`
- `Executor.startMission` amorce le scorer via `strategyMemory.getAllStats()` avant
  `preparePlan` ; `executeAction` enregistre `strategyMemory.recordSkillOutcome`. Câblés
  dans le chemin réel des missions (voir audit précédent, R5). StrategyMemory persiste dans
  `.Leanna-strategy.json` (par workspace, best-effort) — actif sans config externe.

### AgentRegistry — `FULLY_EXECUTED`
- `initialize()` (AgentRegistry.ts:44-86) boucle sur `listAgentRoles()`, crée un
  `AutonomousAgent` par rôle et appelle `agent.start()`. Atteint au boot via
  `server.ts:431 → AgentOrchestrator.setSkillHandler → registry.initialize`
  (AgentOrchestrator.ts:63). Consommé par `routes/agents.ts` (`getAgent`, `getFleetStatus`).

### AgentExecutor — `FULLY_EXECUTED`
- `execute(task)` (AgentExecutor.ts:201) : résout le contexte, construit le prompt, appelle
  le LLM via `callToolWithTimeout("agent_execute", {prompt})`, lance `executeToolLoop`
  (boucle d'outils réelle), écrit/vérifie via `GeneratedFileWriter`, collecte des preuves,
  puis dispatch les délégations (AgentExecutor.ts:373). Appelé par
  `AgentOrchestrator.delegateTask`, `TaskScheduler.ts:96`, `AutonomousAgent.handleTaskRequest`.

### AutonomousAgent + AutonomousLoop — `FULLY_EXECUTED`
- Instances créées et démarrées au boot (`AgentRegistry.ts:77-81`), abonnées au
  `AgentMessageBus`. `handleTaskRequest` (AutonomousAgent.ts:285) exécute : mode autonome
  (`metadata.autonomous===true`) → `loop.run(task)` ; sinon → `executor.execute(task)`.
  `AutonomousLoop` est construit par agent (AutonomousAgent.ts:79) et son `run()` boucle
  Observe→Decide→Act autour du même AgentExecutor.

### DelegationDispatcher — `FULLY_EXECUTED`
- Possédé par chaque `AgentExecutor` ; `dispatchDelegations` (AgentExecutor.ts:373) parse les
  blocs `## DÉLÉGATION`, applique profondeur max (4) et détection de cycle, publie des
  `task_request` sur le bus → consommés par les `AutonomousAgent` démarrés. Délégation réelle
  de bout en bout, pas seulement planifiée.

### AgentOrchestrator — construction `FULLY_EXECUTED` ; dispatch `REACHABLE_VIA_ROUTE`
- Singleton créé (AgentOrchestrator.ts:593), câblé au boot (server.ts:431). Ses méthodes de
  dispatch (`delegateTask`, `orchestrate`, `delegateAutonomously`, `collaborateByPattern`,
  `brainPlan/brainExecute`) s'exécutent réellement **quand** un skill (`server/skills/agents.ts`),
  une route (`server/routes/agents.ts`) ou Telegram les appelle. Aucune méthode publique morte
  trouvée.

### AutonomyPersistence — `ACTIVE_ONLY_WITH_CONFIG` (Supabase)
- Constructeur : actif seulement si `SUPABASE_URL` **et** `SUPABASE_SERVICE_ROLE_KEY` sont
  présents ; sinon `client=null` et chaque méthode (`saveTask`, `updateTask`,
  `loadPendingTasks`) commence par `if (!this.client) return`. La reprise est **réellement
  appelée** au démarrage (`LeannaCore.start → resumePersistedTasks → loadPendingTasks`) mais
  retourne `[]` sans config → reprise inerte hors Supabase.

### MissionStore — `ACTIVE_ONLY_WITH_CONFIG` (Supabase)
- Même contrat : `isEnabled()` = `client !== null`. `setStore` est appelé (server.ts:339) mais
  `persist()`/`resumePending()` sont no-op sans Supabase.

### Sandbox — `ACTIVE_ONLY_WITH_CONFIG` (sélection de projet ; ensuite obligatoire, fail-closed)
- État initial `DISABLED` (sandbox.ts:74). `assertSafeSandboxPath` **lève** `SANDBOX_NOT_READY`
  tant que l'état ≠ `READY`. Toutes les écritures d'agent passent par
  `resolveSandboxWriteTarget → assertSandboxReady` (codebaseHelpers.ts) **sans fallback vers
  SELF_ROOT** → écritures bloquées (fail-closed) au boot.
- `activateSandbox()` (→ `READY`) n'est appelé que par `switchSandboxProject`, lui-même
  déclenché par la sélection de projet (`routes/self-root.ts`, `routes/ftp.ts`,
  `skills/project.ts`), **jamais dans `server.ts` au boot**. Les missions autonomes écrivent
  donc via le sandbox une fois un projet ouvert ; il n'existe pas de chemin d'écriture
  parallèle qui le contourne.

### DynamicAgentRegistry — `REGISTERED_ONLY`
- Pur magasin de définitions (`Map<AgentRole, DynamicAgentDefinition>`). Alimenté par
  `routes/custom-agents.ts`, `routes/agent-registration.ts`, `initCustomAgents()`. Consulté via
  `hasAgent`/`getAgent` mais n'exécute jamais rien lui-même.

### DelegationManager — `ORPHAN`
- Exporté par `server/agents/index.ts` mais **aucun appelant runtime** :
  `delegationManager.` / `new DelegationManager(` n'apparaît que dans
  `DelegationManager.test.ts`. Le chemin de délégation actif est le `DelegationDispatcher`
  (Markdown), pas ce gestionnaire JSON structuré.

### Memory / KnowledgeGraph — voir audit maître
- Hierarchical Memory, ProjectMemory, KnowledgeGraph sont actifs et consultés
  (`ReasoningPipeline`, `UnderstandingEngine`, `SemanticSearch`). La persistance projet/long
  terme est `ACTIVE_ONLY_WITH_CONFIG` selon les adaptateurs configurés.

## 3. Tableau de synthèse

| Composant | Verdict | Preuve (appelant) |
|---|---|---|
| AutonomousExecutive | FULLY_EXECUTED | `LeannaCore.handleEvent` + `server.ts:394-426` |
| Mission Executor (plan/verify/reflect) | FULLY_EXECUTED | `server.ts:312-364` (LLM+handler câblés) |
| LeannaCore → executeMission → startMission | FULLY_EXECUTED (déféré) | `server.ts:398-411` |
| SkillScorer + StrategyMemory | FULLY_EXECUTED | `Executor.startMission`/`executeAction` |
| AgentRegistry | FULLY_EXECUTED | `AgentOrchestrator.ts:63` ← `server.ts:431` |
| AgentExecutor | FULLY_EXECUTED | `AgentExecutor.ts:201/373` ; `TaskScheduler.ts:96` |
| AutonomousAgent / AutonomousLoop | FULLY_EXECUTED | `AgentRegistry.ts:77-81` ; `AutonomousAgent.ts:79/285` |
| DelegationDispatcher | FULLY_EXECUTED | `AgentExecutor.ts:373` |
| AgentOrchestrator (dispatch) | REACHABLE_VIA_ROUTE | `routes/agents.ts`, `skills/agents.ts` |
| AutonomyPersistence | ACTIVE_ONLY_WITH_CONFIG | ctor env gate ; `LeannaCore.resumePersistedTasks` |
| MissionStore | ACTIVE_ONLY_WITH_CONFIG | `server.ts:338-339` ; `isEnabled()` |
| Sandbox | ACTIVE_ONLY_WITH_CONFIG | `sandbox.ts:74/229` ; `switchSandboxProject` |
| DynamicAgentRegistry | REGISTERED_ONLY | `routes/custom-agents.ts`, `initCustomAgents` |
| DelegationManager | ORPHAN | seulement `DelegationManager.test.ts` |

## 4. Ce que Leanna sait réellement faire de façon autonome (verdict)

**Réellement autonome, sans intervention** (une fois un projet sélectionné et les clés
provider présentes) :
- Réagir à un événement runtime → créer un objectif priorisé → décider → lancer une mission
  réelle → planifier avec le LLM → exécuter des outils (via ToolRegistry + sandbox) →
  vérifier → réfléchir → apprendre (fiabilité durable) → escalader si échecs répétés.
- Déléguer à une flotte d'agents spécialisés qui s'exécutent vraiment (LLM + boucle d'outils
  + écriture vérifiée), avec sous-délégation en cascade via le bus.

**Seulement enregistré / conditionnel** :
- Persistance & reprise (missions, tâches autonomes) : **inertes sans Supabase**.
- Écritures d'agent : **bloquées tant qu'aucun projet n'est ouvert** (sandbox DISABLED).
- `DelegationManager` : code présent mais **jamais exécuté**.
- `DynamicAgentRegistry` : stocke des définitions, **n'exécute pas**.

## 5. Recommandations (priorisées, non encore implémentées)

- **R-1 (robustesse, haute valeur)** : rendre l'initialisation de la flotte non dépendante
  d'une unique ligne top-level. Soit déplacer `agentOrchestrator.setSkillHandler(...)` dans
  `onReady` à côté du Mission System, soit ajouter au boot une assertion loggée
  `if (!agentRegistry.isReady) log.error(...)`. Empêche une régression silencieuse fatale.
- **R-2 (clarté)** : décider du sort de `DelegationManager` — soit le brancher comme
  alternative structurée au `DelegationDispatcher`, soit le retirer de l'export barrel pour
  ne pas laisser croire qu'il est actif. (Vérifier `server/agents/index.ts` et les tests
  avant suppression.)
- **R-3 (observabilité)** : exposer explicitement dans `/api/v2/metrics/health` les drapeaux
  `supabaseConfigured`, `sandboxState`, `missionExecutorReady`, `fleetReady` pour rendre
  visible l'écart « exécuté vs seulement configurable » sans lire les logs.
- **R-4 (démarrage)** : réduire/documenter la fenêtre où `missionExecutor` est null (les
  premiers événements s'escaladent). Éventuellement mettre en file les cycles jusqu'à
  `onReady` plutôt que d'escalader, si l'on veut zéro perte au démarrage.

Aucune de ces recommandations ne modifie la sécurité : toute écriture reste derrière
`ToolRegistry` + `PermissionPolicy` + `DryRun` + `AutonomyPolicy` + sandbox.
