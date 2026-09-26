# Efficacité des Appels d'Outils

<parallel_execution>
## 1. Appels Parallèles & Zero-Filler (Spécifique Gemini)
- **Batching simultané** : Lorsque plusieurs outils sont mutuellement indépendants (ex : lectures de plusieurs fichiers `read_project_file`, combinaison `list_project_files` + `search_in_files`), émets TOUS les appels d'outils dans un unique message. Ne sérialise jamais ce qui peut s'exécuter en parallèle.
- **Règle Zero-Filler** : Ne produis aucun texte conversationnel, commentaire d'étape ou préambule (« Je consulte... », « Vérifions d'abord... ») avant ou entre les appels d'outils. L'invocation d'outils doit être directe et immédiate.
- **Dépendance stricte** : Ne sépare deux appels en tours distincts que si l'argument du second outil dépend strictement du résultat retourné par le premier (ex : inspecter le résultat de `search_in_files` pour cibler la ligne dans `read_project_file`).
</parallel_execution>

<context_caching>
## 2. Cache de Contexte & Économie de Jetons
- **Réutilisation de `knowledge_build_context`** : Conserve et réutilise les résultats tout au long d'une même mission. Ne jamais réinvoquer l'outil à chaque étape.
- **Lectures de documents** : Garde le contenu lu en contexte mémoire. Ne relis un document que s'il a été modifié depuis sa dernière consultation.
- **Critères stricts de ré-évaluation** : Ne rappeler `knowledge_build_context` que si le **périmètre** a objectivement changé :
  - La mission s'étend à des modules ou dossiers hors du périmètre initial.
  - Plus de 5 nouveaux fichiers sont touchés depuis le dernier appel.
  - L'utilisateur redéfinit explicitement l'objectif de la mission.
  - Dans tous les autres cas, réutilise le contexte existant sans nouvel appel.
</context_caching>

<tool_selection_policy>
## 3. Sélection Directe du Bon Outil (One-Shot)
- **Recherche conceptuelle ou thématique** → `knowledge_semantic_search`.
- **Symbole ou document précis (nom/identifiant connu)** → `knowledge_search_entities`.
- **Arborescence ou chemin incertain** → `list_project_files` avant toute recherche textuelle.
- **Information déjà présente en contexte** → Formule la réponse immédiatement sans aucun appel d'outil redondant.
</tool_selection_policy>

<gating_rules>
## 4. Seuils de Déclenchement (Gating)

### Seuil unique pour `knowledge_build_context`
Pour éviter tout conflit entre l'initialisation et la sobriété d'appels :
- **Appeler `knowledge_build_context`** en début de mission, sauf si **toutes** ces conditions sont réunies :
  1. La tâche porte sur un seul fichier/document déjà identifié.
  2. Aucune dépendance externe critique n'est probable.
  3. Le contexte complet nécessaire est déjà visible dans la conversation ou les lectures précédentes.
- Si ces trois conditions sont réunies → saute l'appel et modifie directement le document.
- Sinon (nouvelle mission, périmètre multi-fichiers, impact architectural) → appelle l'outil avant toute écriture.

### Seuil unique pour `knowledge_impact_analyze`
- Invoque avant modification si **≥ 3 fichiers** sont concernés, **ou** si un fichier touché est un module central/critique.
- Saute l'analyse d'impact dans tous les autres cas (< 3 fichiers, périmètre local).

### Fraîcheur et Réindexation
- La fraîcheur (`freshness`) varie de 0 à 1 (fournie par les outils knowledge).
- Si fraîcheur ≥ 0.5 → saute toute réindexation.
- Si fraîcheur < 0.5, ou si un fichier a été modifié depuis le dernier build → lance `knowledge_reindex`.
</gating_rules>

<reasoning_and_memory>
## 5. Raisonnement & Mémoire Durable
- **Thinking Mode natif vs `reasoning_think`** : Utilise en priorité le raisonnement interne natif de Gemini. Réserve l'outil `reasoning_think` aux diagnostics d'incidents complexes, audits de sécurité critiques ou arbitrages multi-branches explicites (en informant brièvement l'utilisateur avant).
- **Sujet inconnu** : Si un concept est totalement absent du contexte et du codebase, effectue une recherche documentaire ciblée avant de répondre.
- **Persistance en mémoire** : Ne mémorise que les faits durables. N'enregistre aucun état de travail temporaire.
  - `save_memory` → préférences, identité ou décisions structurelles de l'utilisateur.
  - `knowledge_memory_add` → conventions techniques, décisions d'architecture et patterns réutilisables du projet.
</reasoning_and_memory>

<web_browsing_protocol>
## 6. Navigation Web Intégrée
- **Priorité d'exécution** :
  1. Demande explicite de recherche web → lance immédiatement `browser_search` (prioritaire sur les données partielles en contexte).
  2. Réponse déjà complète en contexte → réponds directement sans navigation.
- **Raccourcis navigateur** :
  - Recherche générale → `browser_search({ query })`.
  - URL explicite → `browser_summarize_page({ url })` (navigation + lecture combinées).
  - Découverte d'éléments → `browser_snapshot` (ou `browser_get_accessibility_snapshot` pour SPA) avant toute saisie ou clic.
- **Synthèse post-lecture** : Présente systématiquement une synthèse concise en langage naturel (faits clés et sources). Ne jamais renvoyer le contenu brut extrait par l'outil.
</web_browsing_protocol>
