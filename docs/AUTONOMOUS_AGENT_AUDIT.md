# Audit de l'agent autonome Leanna

Date : 23 septembre 2026. Cet audit privilégie le code exécuté sur `output.md`, qui ne contient pas une cartographie exploitable complète.

## A. Architecture actuelle

```text
Runtime EventBus / Heartbeat
  -> PerceptionEngine (classification déterministe)
  -> LeannaCore + TaskManager (déduplication, retry, timeout, circuit breaker)
  -> [nouveau] AutonomousExecutive (observation, objectif, priorité, décision)
  -> callback Mission/Brain existant
  -> ToolRegistry (PermissionPolicy + DryRunController)
  -> Mission Executor / BrainScheduler (vérification, réflexion)
  -> Memory / ProjectMemory / LearningEngine
```

Le runtime (`server/runtime/AgentRuntime.ts`) est le conteneur des agents, de `ToolRegistry`, de la mémoire et de l'`EventBus`. Les outils sont le seul point d'exécution prévu : la politique de permissions et le dry-run sont donc préservés. `LeannaCore` écoute les événements, réveille le heartbeat et dépose le travail borné dans `TaskManager`.

## B. Capacités réellement présentes

| Capacité | Fichier / classe | Entrée → sortie / état / persistance | Tests / limites |
|---|---|---|---|
| Runtime et outils sécurisés | `server/runtime/AgentRuntime.ts`, `ToolRegistry`, `PermissionPolicy`, `DryRunController` | Tâche/outil → résultat/événements. État runtime en mémoire ; mémoire projet optionnelle. | Tests runtime, permission et dry-run. La sécurité dépend du passage par `ToolRegistry`. |
| Perception/heartbeat | `server/autonomy/PerceptionEngine.ts`, `HeartbeatService.ts` | `RuntimeEvent` → importance, attention, actions. | `PerceptionEngine.test.ts`. Avant ce changement, les actions étaient seulement `observe/maintenance/mission`, sans décision explicite. |
| Queue autonome | `server/autonomy/TaskManager.ts` | tâche autonome → exécution bornée. Déduplication, priorité, timeout, backoff, circuit breaker ; Supabase facultatif via `AutonomyPersistence`. | `TaskManager.test.ts`, soak test. Pas de mission créée par défaut. |
| Pont d'autonomie | `server/autonomy/LeannaCore.ts` | événement → tâche réactive/maintenance ; timeline WebSocket. | `LeannaCore.test.ts`. La tâche ne portait pas l'événement normalisé et son callback pouvait être un no-op. |
| Plan/DAG | `server/agents/brain/BrainScheduler.ts`, `DynamicPlanner.ts`, `BrainPlanValidator.ts` | étapes + dépendances → fan-out/fan-in, propagation d'échec, rapport. | `BrainScheduler.test.ts`, validator tests. Les limites de ressources/annulation restent surtout portées par les couches appelantes. |
| Mission | `server/mission/Mission.ts`, `Planner.ts`, `Executor.ts`, `Reflection.ts` | objectif → plan → skills → réflexion/correction/escalade. `MissionStore` Supabase est optionnel. | `Executor.test.ts`, skills mission tests. API de mission distincte de la queue autonomie. |
| Mémoire et apprentissage | `server/runtime/HierarchicalMemoryService.ts`, `server/knowledge/ProjectMemory.ts`, `LearningEngine.ts` | faits/retours → mémoire projet et propositions/apprentissages. | Tests hiérarchiques et knowledge. Les catégories cognitives ne sont pas un contrat unique transversal. |
| Agents, orchestration et délégation | `server/agents/AgentOrchestrator.ts`, `AgentExecutor.ts`, `AgentRegistry.ts`, `DelegationManager.ts` | demande → agent/délégation → résultats. | Tests agents/délégation. Les déclencheurs autonomes ne les appelaient pas directement. |
| Connaissance / navigateur / terminal / MCP | `server/knowledge/*`, `server/routes/browser.ts`, `terminal.ts`, `mcp.ts` | compétences et routes → outils/observations. | Tests par route/skill. Ce sont des capacités, pas une boucle de décision unique. |

## C. Boucles existantes

* **Agent/runtime** : `AgentRuntime` gère l'état des tâches et les agents enregistrés.
* **Retry/circuit breaker** : `TaskManager.run()` applique retry exponentiel, timeout, dead-letter et coupe-circuit.
* **Correction** : `BrainCorrectionLoop`, `AgentRepairLoop` et `ReflectionEngine` existent autour de l'exécution.
* **Heartbeat/autonomie** : `HeartbeatService` réveille `LeannaCore`; celui-ci transforme les événements urgents en tâches bornées.
* **Mission** : `Executor` enchaîne planifier, agir, réfléchir, corriger/replanifier/escalader.
* **DAG** : `BrainScheduler` exécute les étapes prêtes en parallèle et bloque les descendants d'un échec.
* **Vérification/apprentissage** : `BrainVerifier`, `ReflectionEngine` et `LearningEngine` existent mais l'appel de fin de mission dépend de l'intégrateur.

## D. Gaps et corrections apportées

### Perception → Decision
* **PROBLÈME :** un événement urgent créait une tâche opaque, sans observation normalisée, disposition ni priorité reproductible.
* **CAUSE / FICHIERS :** `LeannaCore` ne conservait que reason/resources; `PerceptionEngine` ne produisait pas IGNORE…ESCALATE.
* **IMPACT :** absence de déduplication d'objectifs et impossibilité d'auditer la décision.
* **SOLUTION :** `AutonomousExecutive` conserve l'événement, crée/déduplique un `AutonomousGoal`, arbitre avec `PriorityEngine` déterministe et émet des événements structurés.
* **RISQUE :** le callback d'intégration doit continuer à utiliser les outils enregistrés, pas des accès directs.
* **TEST À AJOUTER :** `AutonomousExecutive.test.ts` couvre priorité, déduplication et escalade de permission.

### Decision → Mission
* **PROBLÈME :** aucune frontière typée n'unissait tâche autonome et mission.
* **CAUSE / FICHIERS :** `LeannaCoreOptions.onTask` ne connaissait que `AutonomousTask`.
* **IMPACT :** intégrations fragiles/no-op possibles.
* **SOLUTION :** `server.ts` raccorde maintenant `executeMission(AutonomousMissionRequest)` au `Mission.Executor` initialisé au bootstrap. `Executor.waitForMission()` attend le résultat terminal vérifié au lieu de considérer la création asynchrone comme un succès.
* **RISQUE :** un événement reçu avant l'initialisation du Mission System est explicitement escaladé ; il ne déclenche aucun outil hors politique.
* **TEST À AJOUTER :** test d'intégration callback + MissionStore.

### Mission → Scheduler / Scheduler → Execution
* **PROBLÈME :** systèmes séparés plutôt qu'absence de DAG.
* **CAUSE / FICHIERS :** Mission Executor et `BrainScheduler` sont deux couches historiques.
* **IMPACT :** l'intégrateur doit choisir le scheduler approprié.
* **SOLUTION :** le nouvel executive ne remplace pas le scheduler : il délègue la mission au pipeline existant, qui préserve DAG, retries et validation.
* **RISQUE :** une adaptation future ne doit pas appeler un outil hors `ToolRegistry`.
* **TEST À AJOUTER :** mission déclenchée par événement avec fan-out/fan-in.

### Execution → Verification / Verification → Reflection
* **PROBLÈME :** la vérification/réflexion existe mais n'était pas atteinte depuis l'autonomie.
* **CAUSE / FICHIERS :** queue autonome non reliée à une mission réelle.
* **IMPACT :** incidents détectés sans résultat vérifié ni apprentissage.
* **SOLUTION :** le callback mission est explicitement le propriétaire de `Planner`, `BrainPlanValidator`, `BrainScheduler`, `BrainVerifier` et `ReflectionEngine`; son résultat ferme ou bloque le goal.
* **RISQUE :** un callback qui retourne succès sans vérification contourne ce contrat.
* **TEST À AJOUTER :** vérification négative produit goal BLOCKED et escalade bornée.

### Reflection → Learning → Memory → Next Decision
* **PROBLÈME :** pas de contrat homogène de retour de mission à l'autonomie.
* **CAUSE / FICHIERS :** `ReflectionEngine`, `LearningEngine`, `ProjectMemory` sont indépendants.
* **IMPACT :** les résultats ne sont pas toujours retrouvés au prochain cycle.
* **SOLUTION :** l'executive écrit les observations/outcomes dans la mémoire runtime et porte un goal stable. `Executor.finalizeMission()` appelle maintenant `LearningEngine` avec `applyAutoImprovements: false`, expose des `candidateImprovements` et émet un événement de fin d'apprentissage sans modifier le workspace.
* **RISQUE :** `LearningEngine` ne doit appliquer aucune modification sensible sans politique/confirmation.
* **TEST À AJOUTER :** une leçon issue d'échec influe sur un plan suivant après validation explicite de la proposition.

## Architecture cible et règles d'intégration

`server.ts` construit `LeannaCore` avec `executive.executeMission`. Cette fonction adapte **une seule fois** le `AutonomousMissionRequest` vers le système de mission déjà configuré et attend son état terminal. Elle : (1) valide le plan; (2) délègue au DAG; (3) exécute exclusivement par `ToolRegistry`; (4) vérifie; (5) réfléchit et propose l'apprentissage; (6) retourne succès, blocage ou escalade. Les budgets, confirmations, permissions et dry-run restent les responsabilités du runtime/outils existants. `maxConcurrentCycles` borne les cycles simultanés (les tâches excédentaires restent soumises aux retries de `TaskManager`) et une permission refusée s'escalade immédiatement, sans tentative d'exécution.

La limite est configurée par `LEANNA_AUTONOMY_MAX_CONCURRENT_CYCLES` (valeur positive, défaut sûr `1`). Elle est intentionnellement séparée de `LEANNA_AUTONOMY_MAX_CONCURRENCY` : la première borne la partie décision/mission, la seconde les workers de queue.
