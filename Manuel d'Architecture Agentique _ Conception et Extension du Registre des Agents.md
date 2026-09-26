### Manuel d'Architecture Agentique : Conception et Extension du Registre des Agents

#### 1\. Fondations de l'OS Agentique Leanna

Leanna ne se définit pas comme une simple interface de chat, mais comme un  **Système d'Exploitation Agentique**  conçu pour l'ingénierie logicielle. En tant qu'IDE augmenté (React 19, Vite 6, Electron 43), sa mission est de faire transiter le LLM d'un état de générateur de texte stochastique vers celui d'un acteur agentique déterministe opérant au sein d'un runtime sandboxé. Cette transformation est indispensable pour garantir l'intégrité transactionnelle du code source lors des interventions de l'IA.

##### La transition vers le Runtime Agentique

L'architecture de Leanna résout la problématique de l'écart entre les capacités déclarées et l'exécution réelle (problème historique du "LLM-guessing"). En migrant vers un moteur partagé (AgentTaskRunner → AgentRuntimeExecutor), le système impose un cadre où les outils ne sont plus "devinés" dans le texte, mais explicitement fournis via un registre. Chaque action est désormais soumise à un budget de mission, à des écritures transactionnelles et à une vérification par preuve physique.

##### Structure de l'Écosystème

L'architecture repose sur quatre piliers techniques interdépendants :

1. **Interface et Workspace**  (React/Monaco/Electron) : Fournit la couche de présentation et la gestion visuelle du système de fichiers.  
2. **Runtime Agentique**  (ToolRegistry/Permissions) : Gère le cycle de vie des appels d'outils, la sécurité (PermissionPolicy.ts) et l'interception via dry-run.  
3. **Connaissance et Mémoire**  (Knowledge Graph/RAG) : Assure la compréhension structurelle via l'analyse AST (tree-sitter) et la persistence du contexte.  
4. **Orchestration**  (Agent Brain/Missions) : Responsable de la planification complexe, de la gestion des dépendances (DAG) et de la boucle de rétroaction.Cette robustesse repose sur une compréhension fine du cycle de vie de chaque action, garantissant qu'aucune modification n'est appliquée sans validation heuristique.

#### 2\. Le Cycle de Vie Agentique : De l'Intention à la Vérification

Le succès opérationnel de Leanna repose sur la standardisation rigoureuse de l'exécution via le contrat AgentTaskRunner. Ce cycle limite les défaillances par une boucle de rétroaction continue.

##### Décomposition des Phases (OBSERVE → COMPLETE)

* **OBSERVE**  : Perception de l'état actuel. Le système collecte les preuves via WorkspaceState.ts, qui agit comme le grand livre (ledger) définitif des changements physiques.  
* **PLAN**  : Le DynamicPlanner décompose l'objectif en étapes dépendantes. Le planificateur utilise la mémoire stratégique pour écarter les outils historiquement peu fiables.  
* **ACT**  : Appel effectif des outils via le ToolRegistry. Chaque appel est isolé et monitoré par le BudgetManager.  
* **VERIFY**  : Validation transactionnelle. Le système réeffectue une lecture et compare les  **hash SHA-256**  via le WorkspaceState. Une vérification par le compilateur (verify\_typecheck) est lancée pour assurer la non-régression.  
* **RECOVER**  : En cas de divergence ou d'erreur, l' **AgentRepairLoop**  intervient.  
* **COMPLETE**  : Finalisation, extraction des leçons apprises et mise à jour de la StrategyMemory.

##### La Boucle de Réparation (AgentRepairLoop)

L'AgentRepairLoop agit comme un  **circuit breaker**  (coupe-circuit). Elle interrompt l'exécution si :

* Un patch identique est appliqué de manière itérative sans succès (idempotence brisée).  
* L'analyse de progression ne détecte aucune réduction de la dette technique.  
* Une régression critique (ex: rupture du build) est introduite par l'action précédente.

#### 3\. ToolRegistry et Sécurité : Le Cadre d'Exécution

Le ToolRegistry est le point de passage unique de tout effet de bord. Fidèle à la philosophie  **"Fail-Closed"** , toute permission non explicitement accordée dans le fichier server/runtime/PermissionPolicy.ts ou via .env est refusée par défaut.

##### Modèle de Permissions et Garde-fous

La graduation de l'autonomie est régie par l' **AutonomyPolicy**  (modes : suggest, ask, auto).| Permission | Signification | Garde-fou (AutonomyPolicy) | Impact Système || \------ | \------ | \------ | \------ || **read** | Lecture de fichiers | **Auto**  par défaut | Accès en lecture seule via sandbox. || **write** | Modification/Suppression | **Ask**  (Intervention humaine) | Mutation du workspace (vérifiée par hash). || **network** | Réseau sortant | **Ask** | Prévention des fuites de données. || **exec** | Exécution de processus | **Suggest**  (Validation requise) | Lancement de scripts et compilateurs. |

##### Simulation et Dry-Run

Le DryRunController permet une exécution virtuelle sécurisée. En mode DRY\_RUN=true, les opérations  *write* ,  *exec*  et  *network*  sont interceptées et simulées. L'agent peut ainsi observer les conséquences potentielles de son plan sans affecter l'intégrité du workspace, permettant une réflexion de second niveau avant l'engagement des ressources.

##### Contrôle d'Accès via .leannaignore

Ce mécanisme est appliqué immédiatement à la sandbox. Il exclut les secrets, credentials (.env, \*.pem) et configurations de production. Aucune action agentique ne peut outrepasser ces règles de filtrage au niveau du ToolRegistry.

#### 4\. Orchestration Avancée : Agent Brain et BrainScheduler

L' **Agent Brain**  transforme des objectifs complexes en Graphes Dirigés Acycliques (DAG).

##### Logique de Planification et DAG

Le BrainScheduler gère l'exécution des tâches en fonction de leurs dépendances :  
graph TD  
    A\[Observation Workspace\] \--\> B\[Analyse Impact\]  
    B \--\> C\[Planification DAG\]  
    C \--\> D\[Tâche 1: Refactoring\]  
    C \--\> E\[Tâche 2: Tests Unitaires\]  
    D \--\> F\[Vérification SHA-256\]  
    E \--\> F  
    F \--\> G\[Rapport Final\]

##### BrainScheduler et Stratégie de Fiabilité

Contrairement aux systèmes simples, le BrainScheduler de Leanna est alimenté par le SkillScorer. Ce dernier utilise les données historiques de succès/échec stockées dans StrategyMemory (durable JSON). Si un outil (ex: patch\_project\_file) échoue répétitivement, le planificateur dépriorise cet outil pour les missions suivantes, forçant l'agent à adopter une stratégie alternative ou à escalader le problème.

#### 5\. Intelligence Contextuelle : Knowledge Graph et Mémoire Hiérarchique

L'intelligence de Leanna dépasse le simple RAG textuel pour atteindre une compréhension sémantique et structurelle.

##### Knowledge Graph et Analyse AST

L'intégration de tree-sitter permet un parsing AST complet. L'outil graphify (situé dans server/knowledge/) génère un graphe de connaissances persistant qui identifie les "god-nodes" (hubs architecturaux) et les graphes d'appels. L'agent peut ainsi réaliser une  **analyse d'impact**  avant d'appliquer une modification, identifiant tous les modules dépendants d'un type TypeScript spécifique.

##### Système de Mémoire Hiérarchique et Apprentissage Cross-Mission

La mémoire est structurée pour optimiser la réutilisation de l'expérience (Phase 0 Autonomy) :

* **Working Memory**  : Contexte de la session courante (volatil).  
* **Project Memory**  : Conventions de nommage et décisions d'architecture (.project-memory.json).  
* **Strategy Memory**  :  **Boucle d'apprentissage fermée** . Enregistre la fiabilité des outils. Le LearningEngine produit des propositions d'amélioration fondées sur les résultats des missions passées.Cette architecture permet à Leanna de ne pas simplement exécuter des tâches, mais d'apprendre la fiabilité de son propre outillage au fil du temps.

#### 6\. Guide d'Extension : Intégration de Nouvelles Compétences

L'ajout d'une compétence ("Skill") doit respecter le protocole de sécurité et de traçabilité de Leanna.

##### Processus d'ajout d'un Skill

1. **Déclaration des métadonnées**  : Créer un fichier SKILL.md décrivant l'outil, ses entrées et ses sorties.  
2. **Schéma d'entrée (Zod)**  : Définir une validation stricte dans server/skills/schemas.ts.  
3. **Définition du Prompt**  : Enregistrer la section de prompt dans server/runtime/PromptRegistry.ts pour que le LLM comprenne l'usage de l'outil.  
4. **Permissions**  : Assigner les droits minimaux nécessaires (read, write, etc.).  
5. **Logique de Dry-Run**  : Implémenter l'interception des effets de bord.  
6. **Tests Unitaires**  : Hard requirement pour le LearningEngine afin de tracker l'efficacité dès le déploiement.

##### Exemple de Déclaration de Skill

{  
  "name": "verify\_typecheck",  
  "description": "Vérifie la validité TypeScript du workspace.",  
  "permissions": \["exec"\],  
  "schema": {  
    "projectPath": "z.string()"  
  },  
  "autonomyPolicy": "auto"  
}

#### 7\. Conclusion et Roadmap de Maturité

Le passage à une architecture agentique déterministe transforme l'IA en un véritable  **collaborateur d'ingénierie** . En s'appuyant sur le cycle OBSERVE → COMPLETE et sur une vérification physique via WorkspaceState, Leanna garantit une fiabilité incompatible avec les modèles LLM classiques.L'autonomie de Leanna est conçue pour être graduée et sécurisée. Nous invitons les ingénieurs à exploiter cette structure  **fail-closed**  pour étendre les capacités du système. L'avenir de Leanna réside dans l'expansion du LearningEngine pour que chaque mission réussie ou échouée renforce la précision chirurgicale de l'Agent Brain, créant ainsi un environnement de développement qui s'auto-optimise continuellement.  
