# Roadmap — Leanna AI Operating System

> **Dernière refonte : Septembre 2026** · Version courante : **1.3.0** · Licence BUSL 1.1
>
> Cette roadmap a été **re-auditée contre le code réel** après les itérations `AGENTIC_RUNTIME` (2026-09-24) et `LEANNA_AUTONOMY_IMPLEMENTATION` (2026-09-23). Elle distingue rigoureusement ce qui est *réellement livré et solide*, ce qui est *scaffolding en attente de câblage*, et ce qui est *ambitieux mais buildable*. **Aucune case n'est ✅ sans preuve dans le code source, avec le fichier et le symbole qui l'attestent.**

Leanna est un **OS agentique local-first** : un IDE, un runtime d'agents autonomes et une mémoire long-terme réunis dans une seule application desktop. La vision reste : passer d'un « IDE qui délègue à des agents » à un **système d'exploitation cognitif qui comprend une intention, planifie un vrai graphe d'exécution parallèle, agit de façon autonome sous garde-fous, et apprend de chaque mission**.

---

## Changelog de la roadmap

| Version | Date | Changements majeurs |
|---|---|---|
| **1.3.0** | 2026-09-25 | Re-audit post-`AGENTIC_RUNTIME` et `AUTONOMY_IMPLEMENTATION`. 11 items migrés 📋/🟡 → ✅ (preuves fichier+test). Dette technique recalculée. KPI actualisés. |
| 1.2.0 | 2026-09-04 | Refonte complète : audit du code, 5 paris, 6 phases R0→R6, registre de risques. |

**Ce qui a changé depuis la 1.2.0** (récapitulatif pour les lecteurs pressés) :

- **Agent Brain** : ✅ scheduler DAG parallèle, ✅ validation Zod du plan LLM, ✅ réplanification à chaud, ✅ Mermaid.
- **Autonomie** : ✅ dispatcher de missions réel (plus de `onTask` no-op), ✅ escalade bornée, ✅ `/autonomy` WebSocket.
- **Apprentissage** : ✅ `StrategyMemory` durable, ✅ amorçage du `SkillScorer`, ✅ warning au planner, ✅ escalade après N échecs.
- **Budgets** : ✅ arrêt dur par action (`checkBudget → abort`), nuance : pas de kill-switch temps-réel pendant une action longue.
- **Dette technique** : 4 items P0 **soldés** (exécution Brain séquentielle, `onTask` no-op, budgets comptés-seulement, parsing regex LLM).

---

## Sommaire

1. [État réel du produit (audit 2026-09-25)](#état-réel-du-produit-audit-2026-09-25)
2. [Vision refondée — les 5 paris](#vision-refondée--les-5-paris)
3. [Principes directeurs](#principes-directeurs)
4. [Légende & conventions](#légende--conventions)
5. [KPI de succès](#kpi-de-succès)
6. [Phase R0 — Vérité du socle (immédiat)](#phase-r0--vérité-du-socle-immédiat)
7. [Phase R1 — Le cerveau qui planifie vraiment](#phase-r1--le-cerveau-qui-planifie-vraiment)
8. [Phase R2 — L'autonomie qui agit](#phase-r2--lautonomie-qui-agit)
9. [Phase R3 — Le moteur de modèles universel](#phase-r3--le-moteur-de-modèles-universel)
10. [Phase R4 — Mémoire cumulative & apprentissage](#phase-r4--mémoire-cumulative--apprentissage)
11. [Phase R5 — Innovation & différenciation](#phase-r5--innovation--différenciation)
12. [Phase R6 — Ouverture & portabilité](#phase-r6--ouverture--portabilité)
13. [Registre des risques](#registre-des-risques)
14. [Dette technique prioritaire](#dette-technique-prioritaire)

---

## État réel du produit (audit 2026-09-25)

Constat honnête, tiré du code source. C'est le point de départ de toute la refonte. Chaque ligne ✅ est traçable à un fichier + un symbole + (si applicable) un test.

### ✅ Réellement solide, production-grade

| Sous-système | Preuve dans le code |
|---|---|
| **Sandbox isolé & sync transactionnel** | `server/utils/sandbox.ts` — machine à états fail-closed (DISABLED→INITIALIZING→READY), défense anti-échappement (chemins absolus/UNC/drive-relative rejetés, walk des symlinks segment par segment), sync transactionnelle avec checkpoint + rollback total, mutex anti-concurrence. Tests : `server/utils/sandbox.test.ts`, `server/utils/safeguards.test.ts`. |
| **RAG hybride** | `server/notebooks/RAGEngine.ts` — pipeline réel en 5 étapes : expansion de requête LLM (`expandQuery`), embeddings sémantiques (`embeddingStore.search`), TF-IDF lexical (`searchTFIDF`), fusion RRF pondérée (`RRF_K`), re-ranking LLM (`rerankWithLLM`), citations sourcées `[SOURCE N]`. |
| **Suivi coûts & tokens** | `server/observability/TelemetryService.ts` — capture réelle des tokens (Gemini/OpenRouter), calcul de coût par table de pricing, agrégation par modèle/agent/mission, flush Supabase. Enrichi par `setTelemetryContext` dans `server.ts` au démarrage de chaque mission. |
| **Failover multi-provider** | `server/utils/textGeneration.ts` — routeur Gemini↔OpenRouter avec circuit breaker par provider (`LEANNA_PROVIDER_BREAKER_*`), key-pool Gemini avec rotation 429 (`withGeminiRetry`), streaming supporté (`generateTextStream`). |
| **Runtime agentique** *(nouveau)* | `server/runtime/agentic/AgentRuntime.ts` — vraie boucle `run/plan/execute/verify/recover/finalize`, budget transactionnel 8/3/9/6/4 (`DEFAULT_AGENT_BUDGET`), `WorkspaceState` adressé par hash SHA-256, `AgentRepairLoop` borné. Tests : `agentic.test.ts` (12 scénarios), `mission-harness.test.ts` (4 scénarios end-to-end), `AgentTaskRunnerContract.test.ts` (10 invariants contre les **deux** moteurs). |
| **Agent Brain (DAG parallèle)** *(corrigé)* | `server/agents/brain/BrainScheduler.ts` — scheduler topologique avec fan-out/fan-in (`await Promise.allSettled(runs)`), détection de deadlock, propagation d'échecs, suivi `executionOrder`. `BrainPlanValidator.ts` — validation Zod stricte + détection de cycle DFS + Mermaid. `AgentBrain.replanSubgraph` — réplanification à chaud bornée par `maxReplans`. Tests : `BrainScheduler.test.ts` (4 cas dont parallélisme réel du diamant), `BrainPlanValidator.test.ts` (Mermaid, cycles, refs orphelines), `supervisor-harness.test.ts` (end-to-end). |
| **Validation Zod des plans LLM** *(corrigé)* | `server/agents/brain/DynamicPlanner.ts` — `llmStageSchema`, `llmPlanSchema`, `parseLLMPlanResponse()` (JSON isolé → `safeParse` → repli heuristique si invalide). Tests : `DynamicPlanner.test.ts` (8 cas dont JSON malformé). |
| **Cross-mission learning** *(corrigé)* | `server/knowledge/StrategyMemory.ts` — store durable par workspace (JSON atomique `tmp+rename`), decay, prune. Consommé par `SkillScorer.seedFromReliability()` (appelé dans `Executor.startMission`), `Planner.buildFailingSkillsWarning()`, `AutonomousExecutive.recallOutcome()` (escalade après 3 échecs). Tests : `StrategyMemory.test.ts` (6 cas), `Planner.replan.test.ts` (2 cas), `AutonomousExecutive.test.ts` (+3 cas). |
| **Dispatcher de missions autonome** *(corrigé)* | `server.ts` — `LeannaCore` reçoit `executive.executeMission` qui appelle `executor.startMission()` **et** `executor.waitForMission()` (attente de l'état terminal vérifié). `AutonomousExecutive.execute()` transitionne le goal via `GoalManager` et persiste un tally `autonomy:fingerprint:*` dans la mémoire projet. |
| **Budgets appliqués (kill-switch par action)** *(corrigé)* | `server/mission/Executor.ts` — `checkBudget(mission.id)` en tête de `executeAction`, suivie d'un `mission.recordActionResult(..., false)` + retour `decision: "abort"` avant l'exécution. Nuance : le kill-switch est **par action**, pas temps-réel pendant une action longue. |
| **Contrat `AgentTaskRunner` (10 invariants)** | `server/agents/AgentTaskRunner.ts` — docstring listant les 10 invariants. `AgentTaskRunnerContract.test.ts` — suite **exécutée contre les deux moteurs** (`AgentExecutor` legacy et `AgentRuntimeExecutor` agentique). A révélé un vrai bug (`ProgressNotifier.notify` levait pour un rôle inconnu). |
| **Intégration multi-workspace FTP** | `server/routes/ftp.ts` + `server/utils/ftpSync.ts` — SSE streaming, registre `~/.Leanna/ftp-workspaces/`, `validateFtpHost` (blocage RFC1918 + lookup DNS pour prévention DNS rebinding). |
| **Autonomie durable** | `server/autonomy/AutonomyPersistence.ts` — table `autonomy_tasks`, checkpoint/reprise au démarrage (`resumePersistedTasks`), dégradation propre sans Supabase. `server/runtime/RedisEventBridge.ts` — EventBus multi-processus (Redis Streams, `XADD`/`XREAD BLOCK`, garde anti-boucle par `instanceId`). Tests : `RedisEventBridge.test.ts`, `TaskManager.soak.test.ts`. |
| **Tests & sécurité de base** | 103 tests d'intégration REST (`server/routes/*.test.ts`), 136+ tests skills, auth `timingSafeEqual` (`server/security.ts`), rate limiting (`server/config/rateLimits.ts`), écoute loopback (`Leanna_LISTEN_HOST`), audit log NDJSON (`server/audit.ts`). |

### 🟡 Scaffolding solide, mais pas encore câblé au réel

| Sous-système | Le gap précis |
|---|---|
| **Observabilité (export réel)** | Les traces OpenTelemetry sont créées, corrélées mission→task→tool→model (`TelemetryService.startMissionTrace`), mais **aucun exporter OTLP par défaut** : `OTEL_CONSOLE_EXPORT` reste vide dans `.env.example`. Pas de Jaeger/Tempo local câblé. |
| **Kill-switch budget temps-réel** | Le budget **stoppe** l'exécution entre deux actions, mais une action longue (ex. `run_project_command` bloqué sur un build de 10 min) n'est pas interrompue à mi-parcours. Il n'y a pas d'`AbortController` propagé au ToolRegistry pour un arrêt réellement temps-réel. |
| **Timeline de mission rejouable** | Les événements `autonomy:*` sont diffusés sur WebSocket `/autonomy` (`AutonomyTimeline.tsx`, `useAutonomyTimeline.ts`), mais **pas de replay** : pas de fixtures, pas de stockage ordonné des décisions/outils/diffs. |
| ✅ ~~**Planification par capacités**~~ | ✅ Livré : `determineRoleSequence` (`DynamicPlanner`) ne repose plus sur des mots-clés d'intention ni sur la branche « header responsive ». Les phases nécessaires sont dérivées du `GoalUnderstanding`, et le rôle porteur de chaque phase est choisi par couverture de ses `capabilities` déclarées sur les outils *signature* de la phase (`selectRoleForPhase` / `scoreRoleForCapabilities`). Un agent aux bonnes capabilities devient éligible sans modifier le planner. |
| **File d'approbation humaine** | `Executor.resolveApproval(actionId, approved)` + `AutonomyPolicy` (`suggest`/`ask`/`auto`) existent, et `requestApproval()` bloque jusqu'à résolution ou timeout. Mais l'**UI de validation interactive** (bouton approuver/refuser dans `AutonomyView`) et le relais **Telegram** des demandes ne sont pas câblés. `AutonomyView` reste décrite comme « lecture seule » côté doc. |

### 🔴 Absent ou très mince

| Sujet | Réalité |
|---|---|
| **Modèles locaux (Ollama)** | Aucune trace dans le code. `textGeneration.ts` ne connaît que `'gemini' \| 'openrouter'`. Aucune var Ollama dans `.env.example`. Le « local-first » ne s'applique pas encore à l'inférence. |
| **Harness d'évaluation d'agents** | Pas de dossier `eval/`, pas de suite de tâches de référence, pas de scoring reproductible, pas de fixtures enregistrées. Les tests agentiques (`mission-harness.test.ts`) valident la **mécanique** (budget, hash, réparation) avec un modèle déterministe, pas la **qualité** des décisions. |
| **CI GitHub Actions bloquante** | Aucun `.github/workflows/*.yml` dans le dépôt. La règle « lint + typecheck + test + build à chaque PR » n'est pas automatisée. |
| **Migrations Supabase versionnées** | `supabase/migrations/` ne contient qu'**une seule migration** (`20260726000000_memories_updated_at.sql`). Les autres schémas sont des fichiers `.sql` ad-hoc à exécuter manuellement. Pas de processus de migration réversible. |
| **Exécution sandboxée des skills tiers** | `McpBridge.sanitizePathArgs()` protège les chemins passés aux serveurs MCP, mais il n'y a **pas de worker isolé** ni de signature pour un skill tiers custom. `dynamicAgentRegistry` accepte une définition sans vérification de signature. |
| **Support Linux / macOS Electron** | `package.json > build.win` uniquement (`nsis` x64). Pas de cible AppImage/deb/dmg. |
| **Mode headless / CLI** | Pas de binaire CLI. L'unique point d'entrée est `server-bootstrap.ts` qui démarre HTTP + WebSocket + Electron. |
| **SDK de plugins versionné** | Non présent. Aucun package `@leanna/plugin-sdk`, aucune API publique versionnée. |

---

## Vision refondée — les 5 paris

Ces cinq paris structurent toute la roadmap. Chacun transforme une force existante ou comble un gap identifié à l'audit.

1. **Un cerveau qui planifie vraiment.** ✅ **Atteint** — le scheduler DAG parallèle, la validation Zod et la réplanification à chaud sont livrés. Reste à industrialiser : estimation coût/risque/durée, timeline rejouable, rapport post-mission.
2. **Une autonomie qui agit sous garde-fous.** ✅ **Atteint (mécanique)** — le dispatcher autonome est branché. Reste à câbler la **file d'approbation** (UI + Telegram) et les **snapshots** avant mission longue.
3. **Un moteur de modèles universel.** 🚧 **En cours** — le failover Gemini↔OpenRouter est solide. Manque Ollama local + routeur intelligent.
4. **Une mémoire qui apprend.** ✅ **Atteint** — `StrategyMemory` influence la planification dès la première itération, escalade sur échecs répétés. Restent les playbooks et les profils par projet.
5. **De l'inédit, mesurable.** 📋 **À construire** — time-travel, simulation, harness d'évaluation, voix comme interface principale.

---

## Principes directeurs

| # | Principe | Conséquence concrète |
|---|---|---|
| 1 | **Local-first** | Rien ne quitte la machine sans action explicite. À étendre à l'inférence via Ollama (R3). |
| 2 | **Agent sous contrôle** | Toute action destructive est réversible (sandbox, checkpoint) ou soumise à approbation. |
| 3 | **Observable par défaut** | Si l'agent le fait, on le voit, on le rejoue, on en connaît le coût — et le budget peut *stopper* la mission, pas seulement la compter. |
| 4 | **Extensible sans fork** | Skills, agents, modèles et workflows s'ajoutent sans toucher au cœur. |
| 5 | **Honnêteté d'ingénierie** | Une case n'est ✅ que si le code la prouve **et** un test la couvre. |

---

## Légende & conventions

**Statut** : ✅ Fait (prouvé par le code + test) · 🟡 Partiel/scaffolding · 🚧 En cours · 📋 Planifié · 💡 Idée

**Priorité** : P0 (fondation, débloque le reste) · P1 (majeur) · P2 (confort) · P3 (opportuniste)

**Effort** : S (< 2 j) · M (2–5 j) · L (1–2 sem.) · XL (> 2 sem.)

**DoD** : code + tests + doc + entrée CHANGELOG. Sans les quatre, pas de ✅.

---

## KPI de succès

| Indicateur | Aujourd'hui (2026-09-25) | Cible R5 |
|---|---|---|
| Taux de succès des missions autonomes | mécanique prouvée (`mission-harness.test.ts`), **score métier non mesuré** | ≥ 85 % sur suite d'évaluation |
| Parallélisme réel du planificateur | ✅ démontré (`BrainScheduler.test.ts`, diamant b1∥c1) | ≥ 4 étapes concurrentes sur DAG large |
| Missions autonomes réellement exécutées | ✅ branché (`executeMission` + `waitForMission`) | ≥ 90 % des tâches perçues tracent une action |
| Inférence locale disponible | non | Ollama : ≥ 1 modèle en fallback hors-ligne |
| Budget appliqué (kill-switch) | ✅ par action ; 🟡 pas temps-réel | Arrêt temps-réel à 100 % du dépassement |
| Coût médian d'une mission | mesuré, affiché | mesuré, affiché, **plafonnable et appliqué temps-réel** |
| Régression agent détectée en CI | non | PR bloquée si le score baisse |
| Temps de démarrage à froid (Electron) | à mesurer | < 3 s |

---

## Phase R0 — Vérité du socle (immédiat)

**Thème** : rendre vrai ce qui est marqué comme fait. Ces items sont des dettes qui bloquent la crédibilité et les phases suivantes.

| Fonctionnalité | Prio | Effort | Statut |
|---|---|---|---|
| ✅ ~~Validation de schéma Zod du plan LLM~~ | P0 | S | ✅ Livré (`DynamicPlanner.parseLLMPlanResponse` + `DynamicPlanner.test.ts`) |
| ✅ ~~Appliquer les budgets (arrêt dur au dépassement)~~ | P0 | M | ✅ Livré par action (`Executor.executeAction` → `checkBudget → abort`) ; ✅ arrêt temps-réel via `AbortSignal` propagé au `ToolRegistry.call` |
| **Exporter OpenTelemetry réel** (OTLP → Jaeger/Tempo local en container) — les traces existent mais ne sortent nulle part | P0 | S | 📋 |
| **CI GitHub Actions bloquante** : lint + typecheck + test + build + `npm audit` à chaque PR | P0 | M | 📋 |
| **Reconnexion WebSocket auto** (backoff exponentiel) sur `/live`, `/terminal`, `/sandbox-watch`, `/autonomy` | P0 | S | 📋 |
| **Scan + redaction de secrets** dans logs, traces, prompts et avant tout commit/push agent | P0 | M | 📋 |
| ✅ ~~**Kill-switch budget temps-réel** : propager un `AbortSignal` jusqu'au `ToolRegistry.call` pour interrompre une action longue en cours~~ | P0 | M | ✅ Livré (`ToolCallOptions.signal` + course abort dans `ToolRegistry.executeWithTimeout` ; `AgentExecutor` propage `AbortController.signal` via `SkillHandler` → `bootstrap` → registry ; `run_project_command` tue le sous-processus via `execFile({ signal })`) |
| **Health check enrichi** `/api/health` : Supabase, Gemini, pgvector, Ollama, uptime, version | P1 | S | 📋 |
| **Endpoint `/api/metrics` Prometheus** (latences, erreurs, files, coûts) | P2 | M | 📋 |

---

## Phase R1 — Le cerveau qui planifie vraiment

**Thème** : transformer l'Agent Brain d'un pipeline linéaire déguisé en DAG en un **vrai orchestrateur de graphe**. *(Phase largement soldée.)*

| Fonctionnalité | Prio | Effort | Statut |
|---|---|---|---|
| ✅ ~~Scheduler topologique~~ (fan-out/fan-in, respect des dépendances) | P0 | XL | ✅ `BrainScheduler.ts` + `BrainScheduler.test.ts` |
| ✅ ~~Réplanification à chaud~~ (re-décomposition du sous-graphe restant) | P0 | L | ✅ `AgentBrain.replanSubgraph`, garde-fou `maxReplans` |
| ✅ ~~Plan validé & inspectable~~ (schéma Zod strict, Mermaid) | P1 | M | ✅ `BrainPlanValidator` + `toMermaid()` + `BrainPlanValidator.test.ts` |
| ✅ ~~Détection de boucle infinie d'agent~~ (même action N fois → pivot/escalade) | P1 | S | ✅ `AgentRepairLoop` + `AutonomousExecutive.recallOutcome` |
| ✅ ~~**Planification par capacités, pas par mots-clés** : remplacer `determineRoleSequence` (échelle de rôles codée en dur, branche « header responsive » dédiée) par une sélection basée sur les `capabilities` déclarées~~ | P1 | L | ✅ Livré (`DynamicPlanner.PHASES` + `determineNeededPhases` + `selectRoleForPhase`/`scoreRoleForCapabilities` ; guardrails `AgentBrain.test.ts` verts) |
| **Estimation coût/risque/durée avant exécution** affichée sur le plan | P1 | M | 📋 |
| **Timeline de mission rejouable** : chaque décision, outil, diff, coût, horodaté et navigable | P1 | L | 📋 |
| **Rapport post-mission automatique** (fichiers touchés, tests lancés, coût, durée, échecs, corrections) | P1 | M | 🟡 partiel (`BrainExecutionResult`, `Mission.toContextSummary` existent ; pas de rapport Markdown unifié) |

---

## Phase R2 — L'autonomie qui agit

**Thème** : câbler la perception (déjà solide) à l'exécution réelle, sous tous les garde-fous existants.

| Fonctionnalité | Prio | Effort | Statut |
|---|---|---|---|
| ✅ ~~Dispatcher de missions autonome~~ (`ToolRegistry` → `PermissionPolicy` → `DryRunController` → `AutonomyPolicy`) | P0 | XL | ✅ `server.ts` `executeMission` + `waitForMission` |
| **File d'approbation humaine** : bouton UI + relais Telegram pour approuver/refuser une action en attente (`Executor.resolveApproval` existe côté backend) | P0 | M | 🟡 backend prêt, UI à câbler |
| **Mode approbation granulaire** : validation requise avant écriture hors sandbox, `git push`, commande shell | P0 | M | 🟡 `AutonomyPolicy` gère le mode, la granularité par outil reste à exposer dans l'UI |
| **Snapshots de workspace** avant mission longue, rollback en un clic | P1 | M | 📋 (checkpoints Git existent, snapshot automatisé à ajouter) |
| **Vue Autonomie interactive** : passer de « lecture seule » à un centre de contrôle (approuver, mettre en pause, annuler) | P1 | M | 🟡 `AutonomyTimeline` connecté, actions absentes |
| **Agents proactifs** : détectent dette technique, dépendance vulnérable, test manquant, et **proposent** une mission (sans l'exécuter sans accord) | P1 | L | 💡 |
| **Rotation du token API** et **audit des accès** exposés dans l'UI | P1 | M | 📋 |

---

## Phase R3 — Le moteur de modèles universel

**Thème** : de « Gemini + fallback » à un vrai moteur multi-modèles avec inférence locale.

| Fonctionnalité | Prio | Effort | Statut |
|---|---|---|---|
| **Intégration Ollama** : provider local first-class dans le routeur (`'gemini' \| 'openrouter' \| 'ollama'`), mode 100 % hors-ligne | P0 | L | 📋 |
| **Abstraction provider complète** : découpler les skills du client Gemini (dette technique P0 identifiée) | P0 | L | 📋 |
| **Fallback en cascade multi-niveaux** (Gemini → OpenRouter → Ollama local) sur quota/erreur | P0 | M | 🟡 2 niveaux sur 3 |
| **Routeur de modèles intelligent** : choix automatique par complexité, coût, latence et confidentialité de la tâche | P1 | L | 📋 |
| **Cache sémantique de prompts** : réponse réutilisée si prompt équivalent (économie tokens) | P1 | M | 📋 |
| **Compression de contexte** : résumé auto des longues sessions avant dépassement de fenêtre | P1 | L | 🟡 `POST /api/tokens/summarize-context` existe ; pas de trigger automatique en fin de fenêtre |
| **Multi-modèles simultanés** : Gemini + Claude + local en parallèle sur la même tâche, meilleure réponse retenue | P2 | XL | 💡 |

---

## Phase R4 — Mémoire cumulative & apprentissage

**Thème** : une mémoire qui ne fait pas qu'injecter du contexte, mais **change les décisions**. *(Brique fondamentale livrée.)*

| Fonctionnalité | Prio | Effort | Statut |
|---|---|---|---|
| ✅ ~~Mémoire d'échecs~~ : les erreurs passées modifient la planification (évite les approches qui ont échoué) | P1 | L | ✅ `StrategyMemory` + `Planner.buildFailingSkillsWarning` + `seedFromReliability` |
| ✅ ~~Cross-mission reliability~~ : signal durable par outil, escalade après N échecs de la même classe | P1 | L | ✅ `AutonomousExecutive.recallOutcome` + `GET /api/v2/metrics/reliability` |
| **Playbooks appris** : après une mission réussie, le Brain persiste la séquence d'agents gagnante et la réutilise sur objectifs similaires | P1 | L | 💡 |
| **Profils d'agent par projet** : conventions, style de code, règles apprises et appliquées automatiquement | P1 | M | 📋 |
| **Recherche hybride étendue à la mémoire long-terme** (déjà en place pour les notebooks — l'étendre à `HierarchicalMemoryService` longterm) | P1 | M | 🟡 notebooks ✅, longterm TF-IDF seul |
| **Reranking + citations obligatoires** étendus à toutes les réponses mémoire, pas seulement notebooks | P2 | M | 📋 |
| **Ré-indexation incrémentale** du Knowledge Graph et des embeddings (pas de reconstruction complète) | P2 | M | 🟡 FileWatcher existe, embeddings à confirmer |
| **Journal de bord quotidien** auto-généré (ce qui a changé, pourquoi, par quel agent) | P2 | M | 💡 |

---

## Phase R5 — Innovation & différenciation

**Thème** : du jamais-vu, mais buildable sur le socle. C'est ce qui distingue Leanna.

| Fonctionnalité | Prio | Effort | Statut |
|---|---|---|---|
| **Harness d'évaluation d'agents** : suite de tâches de référence scorées automatiquement, détection de régression en CI | P0 | XL | 📋 |
| **Simulation complète de mission (dry-run global)** : exécuter tout le DAG en simulation, voir tous les diffs et coûts prévus, sans aucun effet de bord | P1 | L | 🟡 `DryRunController` existe ; orchestration dry-run bout-en-bout à câbler |
| **Time-travel debugging de missions** : rejouer une mission étape par étape avec réponses modèles enregistrées (fixtures), inspecter chaque état | P1 | XL | 💡 |
| **Voix comme interface principale** : mot d'activation, conversation mains libres continue, compréhension de l'écran temps réel (socle Gemini Live + partage d'écran existent) | P1 | L | 💡 |
| **Agent de revue de PR** : commente le diff, suggère, ne pousse rien sans accord | P1 | L | 💡 |
| **Leanna se développe elle-même (SELF_IDE complet)** : ouvre une PR sur son propre repo, la teste, la documente, attend une revue humaine | P2 | XL | 💡 |
| **Compagnon mobile** : app iOS/Android en accès distant au serveur local (suivre, approuver, relire) — le pont Telegram est un premier pas | P2 | XL | 💡 |
| **Versionnage & A/B testing de prompts** sur la suite d'évaluation | P2 | L | 💡 |

---

## Phase R6 — Ouverture & portabilité

**Thème** : Leanna tourne partout et s'étend sans fork.

| Fonctionnalité | Prio | Effort | Statut |
|---|---|---|---|
| **Exécution des skills tiers en sandbox** (worker isolé, permissions déclarées, timeout) + **signature** | P0 | L | 📋 |
| **Support Linux** (AppImage/deb) et **macOS** (.dmg notarisé) | P1 | L | 📋 |
| **Docker Compose self-hosted** (app + Supabase local + Ollama + Jaeger) | P1 | M | 📋 |
| **Mode headless / CLI** : lancer une mission depuis le terminal ou un cron, sans UI | P1 | L | 📋 |
| **Supabase local** (Postgres + pgvector en container) pour un fonctionnement 100 % hors-ligne | P1 | L | 📋 |
| **Migrations de schéma versionnées et réversibles** (dette identifiée — actuellement une seule migration dans `supabase/migrations/`) | P1 | M | 📋 |
| **Export/Import complet du profil** (skills, workflows, agents, mémoires) | P1 | M | 📋 |
| **SDK de plugins** (`@leanna/plugin-sdk`) avec API stable et versionnée | P1 | XL | 💡 |
| **Workflows en DSL YAML** versionnables en Git, éditables en UI ou texte | P2 | L | 💡 |
| **Webhooks entrants/sortants** (déclencher une mission depuis un événement externe) | P2 | M | 💡 |

---

## Registre des risques

| Risque | Impact | Mitigation |
|---|---|---|
| Dépendance forte à Gemini (quotas, ruptures d'API) | Élevé | Routeur multi-provider + Ollama local (R3), abstraction provider (dette P0) |
| Agent autonome causant une perte de données | Élevé | Sandbox (déjà solide), snapshots (R2), permissions, file d'approbation (R2) |
| Coûts modèles non maîtrisés | Moyen | Budgets **appliqués par action** (R0 ✅) ; kill-switch temps-réel à ajouter (R0 📋) |
| Scaffolding pris pour du fini (fausse confiance) | Moyen | Cette roadmap distingue explicitement 🟡 de ✅ ; DoD strict (code + test + doc + changelog) |
| Parallélisme du scheduler introduisant des races | Moyen | Sandbox transactionnel + mutex existants ; `BrainScheduler.test.ts` couvre le fan-out/fan-in |
| Skills tiers non fiables | Élevé | Sandbox d'exécution + signature (R6) |
| Fuite de secrets dans prompts/logs | Élevé | Scan + redaction (R0) |
| Boucle de réparation qui ne converge pas | Moyen | ✅ `AgentRepairLoop` détecte patch identique répété / stall / régression (`AgentRepairLoop.assess`) ; `maxReplans` borné |

---

## Dette technique prioritaire

À traiter en continu, elle conditionne plusieurs phases.

| Sujet | Priorité | Statut | Débloque |
|---|---|---|---|
| Couplage des skills au client Gemini | P0 | 📋 Ouvert | R3 (multi-provider, Ollama) |
| ✅ ~~Exécution Brain séquentielle (boucle `for`, abort au 1er échec)~~ | P0 | ✅ **Soldé** (`BrainScheduler`) | — |
| ✅ ~~`onTask` autonome no-op~~ | P0 | ✅ **Soldé** (`executeMission`) | — |
| ✅ ~~Budgets comptés mais non appliqués~~ | P0 | ✅ **Soldé par action** (kill-switch temps-réel à ajouter) | — |
| ✅ ~~Parsing regex du plan LLM sans validation~~ | P1 | ✅ **Soldé** (`llmPlanSchema.safeParse`) | — |
| Traces OTel sans exporter | P1 | 📋 Ouvert | R0 (observabilité réelle) |
| Absence de migrations Supabase versionnées (1 migration / 8 schémas) | P1 | 📋 Ouvert | R6 (portabilité) |
| Serveur Express monoprocessus (blocages CPU longs) | P1 | 📋 Ouvert | R2/R3 (charge autonome + inférence locale) |
| **`planner` a `delete_project_file` dans ses capabilities** (contredit « planner lecture seule ») | P1 | 🐛 Bug identifié | Cohérence du contrat de rôles |
| **Contrat de sortie des agents parsé par heuristique textuelle** (`ResultParser.detectFailure`) plutôt qu'un `status` structuré | P1 | 🐛 Bug identifié (cf. `output.md`) | Fiabilité des décisions |

---

*Cette roadmap est un document vivant, mais elle refuse le vaporware : une fonctionnalité marquée ✅ est prouvée par le code source (fichier + symbole) et couverte par un test. Un 🟡 est du scaffolding honnête, avec le gap précisément identifié. Tout le reste est planifié avec priorité, effort et critère de succès. L'ambition est réelle — le parallélisme, l'autonomie exécutante, l'inférence locale et l'apprentissage cumulatif — et depuis la 1.2.0, quatre des cinq paris structurants sont passés de « planifié » à « prouvé ».*

---

## Annexe — Comment vérifier une case ✅

Pour chaque fonctionnalité marquée ✅, vous pouvez exécuter le test associé :

```bash
# Agent Brain : scheduler DAG parallèle
node --import tsx --test server/agents/brain/BrainScheduler.test.ts

# Agent Brain : validation de plan + Mermaid
node --import tsx --test server/agents/brain/BrainPlanValidator.test.ts

# Agent Brain : plan LLM — validation Zod stricte
node --import tsx --test server/agents/brain/DynamicPlanner.test.ts

# Runtime agentique : budget 8/3/9/6/4, hash, réparation
node --import tsx --test server/runtime/agentic/agentic.test.ts

# Runtime agentique : mission harness end-to-end (modèle déterministe)
node --import tsx --test server/runtime/agentic/mission-harness.test.ts

# Contrat partagé AgentTaskRunner (10 invariants × 2 moteurs)
node --import tsx --test server/agents/AgentTaskRunnerContract.test.ts

# Apprentissage cross-mission
node --import tsx --test server/knowledge/StrategyMemory.test.ts
node --import tsx --test server/mission/Planner.replan.test.ts
node --import tsx --test server/autonomy/AutonomousExecutive.test.ts

# Superviseur AgentBrain end-to-end (vérification hashée)
node --import tsx --test server/agents/brain/supervisor-harness.test.ts
```

Un item ✅ **sans** test exécutable associé est un bug de cette roadmap — signalez-le.

---

**Note de maintenance.** Ce document doit être mis à jour à chaque itération majeure (nouvelle phase R*, changement de statut significatif). Les audits pointus (`docs/LEANNA_AUTONOMY_MASTER_AUDIT.md`, `docs/AGENTIC_RUNTIME.md`) restent la source de vérité pour les détails d'implémentation ; la roadmap reste la source de vérité pour **le statut** et **la priorisation**. En cas de contradiction, le code + les tests priment.