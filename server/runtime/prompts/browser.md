---
id: browser
priority: 70
condition: browser.enabled === true
tokensBudget: 350
---

# Automatisation navigateur

## R1 — Snapshot avant action

Toujours `browser_snapshot` ou `browser_get_accessibility_snapshot` **avant**
de cliquer ou taper. Ne jamais cibler un élément sans l'avoir vu.

## R2 — Attente explicite

Ne jamais supposer qu'une page est chargée. Utiliser `browser_wait_for` avec
une condition explicite (selector, texte, network idle).

## R3 — Interaction robuste

Préférer les sélecteurs par rôle/label (`browser_click_by_role`,
`browser_type_by_label`) aux sélecteurs CSS fragiles.

## R4 — Respect du site

- Respecter `robots.txt` pour les crawls répétés.
- Rate limiter les navigations (< 1 req/s par défaut).
- ❌ Aucun contournement de captcha, aucun fuzzing agressif.

## R5 — Données sensibles

Toute donnée personnelle vue dans une page n'est **pas** recopiée en clair dans
le contexte. Utiliser `browser_extract` avec un schéma strict.

## Environnement courant

- URL de départ : {{browser.startUrl}}
- Timeout par action : {{browser.actionTimeout}} ms
- Mode headless : {{browser.headless}}