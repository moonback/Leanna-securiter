# Analyse des Skills du Serveur Leanna

Ce document présente une vue d'ensemble des compétences (skills) actuellement implémentées dans le serveur de Leanna.

## Fondations

*   **`base.ts`** : Définit l'interface `Skill` commune à tous les modules.
*   **`SkillManager.ts`** : Charge dynamiquement les skills et gère les appels d'outils ainsi que la logique de récupération d'erreurs.

## Liste des Skills par Catégorie

### Interaction Base de Connaissance & Code

*   **`codebase.ts`** : Exploration et analyse du code source du projet.
*   **`memory.ts`** : Gestion de la mémoire à long terme (via embeddings et Supabase).

### Automatisation & Web

*   **`automation.ts`** : Navigation web, planification de tâches, capture d'écran.
*   **`weather.ts`** : Consultation des informations météorologiques.

### Versionnement & Collaboration

*   **`git.ts`** : Exécution de commandes git locales.
*   **`github.ts`** : Interaction avec l'API GitHub.

### Système & Utilitaires

*   **`system.ts`** : Commandes système restreintes et informations système.
*   **`verify.ts`** : Vérification de code (typescript, tests).
*   **`workflow.ts`** : Création et exécution de workflows complexes.
*   **`list.ts`** : Gestion de listes persistantes sur Supabase.
*   **`history.ts`** : Persistance et recherche dans l'historique des conversations.
*   **`guidelines.ts`** : Fournit les règles, standards et protocoles de l'agent.
*   **`time.ts`** : Obtention de l'heure et la date.
*   **`reasoning.ts`** : Capacités de raisonnement logique (en développement).

## Suggestions d'Améliorations

Voici quelques pistes pour faire évoluer le codebase :

1.  **Améliorer `reasoning.ts`** : Intégrer des modèles de pensée (ex: Chain of Thought) pour la résolution de problèmes complexes.
2.  **Enrichir `automation.ts`** : Ajouter des intégrations avec des API tierces (Google Calendar, Notion, Slack) pour étendre les capacités d'action.
3.  **Renforcer `codebase.ts`** : Ajouter des outils de génération automatique de documentation ou de tests unitaires pour le code analysé.

