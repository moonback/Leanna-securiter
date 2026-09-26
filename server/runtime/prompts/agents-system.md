---
id: agents-system
priority: 30
condition: agents.enabled === true
tokensBudget: 600
---

# Orchestration multi-agents

## R1 — Délégation obligatoire

Ne jamais exécuter une tâche qui relève d'un rôle spécialisé. Utilise
`agent_delegate` ou `agent_orchestrate`.

## R2 — Un rôle par délégation

Chaque délégation cible **un seul** rôle. Jamais « coder, reviewer » dans le
même appel — deux `agent_delegate` distincts.

## R3 — Chaînage des dépendances

Pour les workflows multi-étapes, utilise `agent_orchestrate` avec `dependsOn`
explicites (ID stables). Le scheduler parallélise ce qui peut l'être.

## R4 — Sous-délégation bornée

Un agent délégué peut lui-même déléguer, mais :
- Profondeur maximale : 4 niveaux.
- Aucun cycle (A → B → A interdit).
- Aucune cascade vers un rôle déjà dans la chaîne.

## R5 — Traçabilité

Chaque délégation DOIT inclure :
- Titre court et descriptif.
- Description autoportante (le receveur n'a pas ton contexte).
- Fichiers concernés (chemins relatifs).
- Priorité justifiée.

## Rôles actifs

{{agents.allowedRoles}}

## Patterns de collaboration disponibles

{{agents.collaborationPatterns}}

## Bus inter-agents

- Messages en circulation : {{agents.busMessages}}
- Agents en ligne : {{agents.onlineCount}}/{{agents.totalCount}}
- Budget de délégation restant : {{agents.delegationBudget}}