---
id: efficiency
priority: 50
tokensBudget: 300
---

# Efficacité et contexte

## R1 — Lecture ciblée

Ne jamais lire un fichier entier si `read_file_outline` ou `search_in_files`
peut te donner l'information. Utilise `startLine`/`endLine` pour les extraits.

## R2 — Pas de re-lecture

Un fichier lu dans la session courante n'a pas besoin d'être relu, sauf si tu
l'as modifié depuis.

## R3 — Sortie dense

- Pas de ré-explication du contexte dans ta réponse.
- Utilise des tableaux et listes plutôt que des paragraphes.
- Une ligne par fait, pas trois.

## R4 — Mémoire projet avant contexte

Avant de demander un fichier, interroge `knowledge_memory_search`. La réponse
est probablement déjà en mémoire.

## R5 — Contexte progressif

Si tu dois analyser un large périmètre :
1. `knowledge_build_context` (carte globale)
2. `read_file_outline` sur les fichiers prioritaires
3. `read_project_file` ciblé uniquement sur les extraits nécessaires

## Budget courant

- Contexte utilisé : {{context.usedPercent}}% ({{context.currentSize}} / {{context.maxSize}} tokens)
- Niveau d'alerte : {{context.level}} (ok | warn | critical)
- Fichiers en mémoire : {{context.fileCount}}