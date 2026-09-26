# Leanna Design System Tokens

**Version:** 2.1.0
**Date:** 23 septembre 2026
**Périmètre:** Tous les composants React dans `src/components/`

Ce document définit les tokens, conventions visuelles et règles d'implémentation du design system de **Leanna**.

Tous les nouveaux composants doivent respecter ces conventions. Toute exception doit être justifiée par un besoin fonctionnel ou d'accessibilité et rester limitée au composant concerné.

---

## 1. Principes fondamentaux

Le design system repose sur quelques principes simples :

1. **Tokens avant valeurs arbitraires**
   Les composants utilisent les tokens CSS et les classes Tailwind standard plutôt que des valeurs isolées.

2. **Cohérence avant personnalisation**
   Deux composants ayant le même rôle visuel doivent utiliser les mêmes primitives.

3. **Sémantique avant apparence**
   Les couleurs doivent exprimer un état ou un rôle (`success`, `warning`, `error`, `info`) et non une couleur brute.

4. **Dark et Light par défaut**
   Chaque composant doit fonctionner dans les deux thèmes sans modifier sa structure.

5. **Accessibilité obligatoire**
   Le contraste, le focus clavier, les états interactifs et la réduction des animations doivent être pris en compte.

6. **Pas de valeurs arbitraires sans nécessité**
   Les classes telles que `text-[13px]`, `rounded-[14px]` ou `shadow-[...]` sont interdites sauf exception documentée.

---

# 2. Échelle typographique

## 2.1 Paliers standardisés

L'échelle typographique utilise exclusivement les classes Tailwind standard suivantes :

| Rôle             | Taille cible | Classe Tailwind | Usage                                     |
| ---------------- | -----------: | --------------- | ----------------------------------------- |
| Micro-label      |         12px | `text-xs`       | Badges, tags, métadonnées courtes         |
| Corps secondaire |         14px | `text-sm`       | Légendes, descriptions, textes de support |
| Corps principal  |         16px | `text-base`     | Contenu courant, listes, formulaires      |
| Sous-titre       |         18px | `text-lg`       | Titres de section, en-têtes de panneau    |
| Titre            |         20px | `text-xl`       | Titres de vue, dialogues secondaires      |
| Grand titre      |         24px | `text-2xl`      | Titres principaux, modales importantes    |

> **Important :** les noms des classes Tailwind sont conservés tels quels. La taille réellement rendue dépend de la configuration Tailwind du projet. Si Leanna surcharge ces valeurs, les valeurs effectives doivent être définies dans la configuration centrale plutôt que dans les composants.

## 2.2 Règles

### Interdit

```tsx
text-[8px]
text-[9px]
text-[10px]
text-[11px]
text-[12.5px]
text-[13px]
text-[15px]
text-[17px]
text-[19px]
```

Sont également à éviter les styles inline arbitraires :

```tsx
style={{ fontSize: '13px' }}
style={{ fontSize: 15 }}
```

### Autorisé

```tsx
text-xs
text-sm
text-base
text-lg
text-xl
text-2xl
```

### Migration

Utiliser la correspondance suivante :

| Ancienne valeur               | Nouvelle classe                                        |
| ----------------------------- | ------------------------------------------------------ |
| `text-[8px]` → `text-[11px]`  | `text-xs`                                              |
| `text-[12px]` → `text-[13px]` | `text-sm`                                              |
| `text-[14px]` → `text-[15px]` | `text-sm`                                              |
| `text-[16px]` → `text-[17px]` | `text-base`                                            |
| `text-[18px]` → `text-[19px]` | `text-lg`                                              |
| `text-[20px]` → `text-[23px]` | `text-xl`                                              |
| `text-[24px]` et plus         | `text-2xl` ou niveau supérieur si explicitement défini |

La migration doit privilégier la fonction visuelle du texte plutôt qu'une conversion mécanique de pixel à pixel.

## 2.3 Poids typographiques

Les poids doivent rester limités aux besoins du système :

```text
font-normal
font-medium
font-semibold
font-bold
```

Recommandations :

| Usage                             | Poids           |
| --------------------------------- | --------------- |
| Texte courant                     | `font-normal`   |
| Labels et contrôles               | `font-medium`   |
| Titres de section                 | `font-semibold` |
| Titres principaux / emphase forte | `font-bold`     |

---

# 3. Couleurs sémantiques

## 3.1 Tokens existants

Les composants doivent utiliser des tokens sémantiques plutôt que des couleurs hexadécimales.

| Token                | Rôle                        | Dark      | Light     |
| -------------------- | --------------------------- | --------- | --------- |
| `--color-success`    | États positifs, validations | `#3ecf8e` | `#059669` |
| `--color-warning`    | Avertissements              | `#e2b341` | `#d97706` |
| `--color-error`      | Erreurs, suppressions       | `#f26d6d` | `#dc2626` |
| `--color-info`       | Information, liens          | `#6ea8fe` | `#2563eb` |
| `--accent-primary`   | Accent principal            | `#6ea8fe` | `#2563eb` |
| `--accent-secondary` | Accent secondaire           | `#c792ea` | `#f59e0b` |

Ces valeurs constituent les valeurs de référence du design system. Elles sont définies à un emplacement central : `src/index.css` (blocs `:root[data-theme="…"]`), qui fait autorité. **Ce tableau doit rester synchronisé avec `index.css`.**

### Direction visuelle (v2.1.0)

Le système repose sur la **sobriété** : surfaces neutres, un seul accent par thème, couleurs sémantiques adoucies. Chaque thème est distinct :

| Thème           | Base                     | Accent principal      | Intention                          |
| --------------- | ------------------------ | --------------------- | ---------------------------------- |
| `dark` (défaut) | neutre near-black `#0a0a0c` | indigo-bleu `#6ea8fe` | Pro, moderne, reposant             |
| `light`         | blanc `#ffffff`          | bleu franc `#2563eb`  | Contraste lisible, orange secondaire |
| `cyberpunk`     | navy `#060814`           | néon cyan `#00f0ff`   | Le seul thème néon (magenta assumé) |
| `sepia`         | crème `#fbf0d9`          | solarized `#b58900`   | Lecture chaude                     |
| `high-contrast` | noir `#000000`           | jaune `#ffff00`       | Accessibilité maximale             |

> Les surfaces `dark` ne portent plus de teinte navy/cyan : les bordures sont des filets neutres (`rgba(255,255,255,0.09)`) pour laisser respirer l'accent. Seul `cyberpunk` conserve le néon d'origine.

## 3.2 Tokens subtils

Chaque couleur sémantique peut disposer d'une variante destinée aux arrière-plans faibles.

```css
--color-success-subtle:
  color-mix(in srgb, var(--color-success) 12%, transparent);

--color-warning-subtle:
  color-mix(in srgb, var(--color-warning) 12%, transparent);

--color-error-subtle:
  color-mix(in srgb, var(--color-error) 12%, transparent);

--color-info-subtle:
  color-mix(in srgb, var(--color-info) 12%, transparent);
```

Pour l'accent secondaire :

```css
/* Dark : #c792ea (violet doux) · Light : #f59e0b (orange) */
--color-accent-alt: #c792ea;
```

avec la variante :

```css
--color-accent-alt-subtle:
  color-mix(in srgb, var(--color-accent-alt) 12%, transparent);
```

Les valeurs Light/Dark de `--color-accent-alt` sont définies au niveau du thème.

## 3.2.1 Surfaces interactives (hover / active)

Deux tokens de surface pilotent les états de survol et d'activation. Ils
sont **theme-aware** : voile clair sur fond sombre, voile sombre sur fond
clair. Ne jamais utiliser `bg-white/N` en dur (invisible en thème clair).

```css
/* Dark  */ --bg-hover: rgba(255, 255, 255, 0.06);  --bg-active: rgba(255, 255, 255, 0.1);
/* Light */ --bg-hover: rgba(17, 24, 39, 0.05);     --bg-active: rgba(17, 24, 39, 0.09);
```

### Autorisé

```tsx
className="hover:bg-[var(--bg-hover)]"
style={{ backgroundColor: 'var(--bg-hover)' }}
```

### Interdit

```tsx
className="hover:bg-white/5"   /* casse en thème clair/sepia */
```

## 3.3 Règles

### Interdit

```tsx
color: '#4ade80'
color: '#ef4444'
backgroundColor: '#f59e0b'
```

ou :

```tsx
className="text-[#4ade80]"
className="bg-[#ef4444]"
```

### Autorisé

```tsx
color: 'var(--color-success)'
color: 'var(--color-error)'
backgroundColor: 'var(--color-success-subtle)'
```

ou les classes utilitaires correspondantes :

```tsx
className="text-success"
className="bg-success-subtle"
className="badge-success"
```

Les valeurs `rgba()` et `rgb()` en dur sont également interdites lorsqu'un token sémantique équivalent existe.

---

# 4. Classes utilitaires sémantiques

Les classes utilitaires doivent centraliser les couleurs et leurs variantes.

## 4.1 Success

```css
.text-success {
  color: var(--color-success);
}

.bg-success-subtle {
  background-color:
    color-mix(in srgb, var(--color-success) 10%, transparent);
}

.border-success-subtle {
  border-color:
    color-mix(in srgb, var(--color-success) 25%, transparent);
}

.badge-success {
  background-color:
    color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success);
  border: 1px solid
    color-mix(in srgb, var(--color-success) 25%, transparent);
}
```

## 4.2 Error

```css
.text-error {
  color: var(--color-error);
}

.bg-error-subtle {
  background-color:
    color-mix(in srgb, var(--color-error) 10%, transparent);
}

.border-error-subtle {
  border-color:
    color-mix(in srgb, var(--color-error) 25%, transparent);
}

.badge-error {
  background-color:
    color-mix(in srgb, var(--color-error) 12%, transparent);
  color: var(--color-error);
  border: 1px solid
    color-mix(in srgb, var(--color-error) 25%, transparent);
}
```

## 4.3 Warning

```css
.text-warning {
  color: var(--color-warning);
}

.bg-warning-subtle {
  background-color:
    color-mix(in srgb, var(--color-warning) 10%, transparent);
}

.border-warning-subtle {
  border-color:
    color-mix(in srgb, var(--color-warning) 25%, transparent);
}

.badge-warning {
  background-color:
    color-mix(in srgb, var(--color-warning) 12%, transparent);
  color: var(--color-warning);
  border: 1px solid
    color-mix(in srgb, var(--color-warning) 25%, transparent);
}
```

## 4.4 Info

```css
.text-info {
  color: var(--color-info);
}

.bg-info-subtle {
  background-color:
    color-mix(in srgb, var(--color-info) 10%, transparent);
}

.border-info-subtle {
  border-color:
    color-mix(in srgb, var(--color-info) 25%, transparent);
}

.badge-info {
  background-color:
    color-mix(in srgb, var(--color-info) 12%, transparent);
  color: var(--color-info);
  border: 1px solid
    color-mix(in srgb, var(--color-info) 25%, transparent);
}
```

---

# 5. Rayons

Les composants utilisent quatre niveaux de rayon.

| Élément                    | Rayon cible | Classe        |
| -------------------------- | ----------: | ------------- |
| Bouton, Input, Badge       |         6px | `rounded-md`  |
| Carte, Panneau             |         8px | `rounded-lg`  |
| Popover, Dropdown, Tooltip |        12px | `rounded-xl`  |
| Modale, Dialogue           |        16px | `rounded-2xl` |

## Règles

### Interdit

```text
rounded-[5px]
rounded-[10px]
rounded-[14px]
rounded-[18px]
rounded-[28px]
```

### Autorisé

```text
rounded-md
rounded-lg
rounded-xl
rounded-2xl
```

## Hiérarchie

```text
Bouton/Input/Badge
        ↓
Carte/Panneau
        ↓
Popover/Dropdown/Tooltip
        ↓
Modale/Dialogue
```

Plus un élément appartient à une couche élevée de l'interface, plus son rayon peut être important.

---

# 6. Ombres et élévation

| Élément                      | Élévation  | Classe       |
| ---------------------------- | ---------- | ------------ |
| Bouton / Input / Badge       | aucune     | aucune       |
| Élément en focus             | légère     | `shadow-sm`  |
| Carte / Panneau              | légère     | `shadow-sm`  |
| Popover / Dropdown / Tooltip | forte      | `shadow-lg`  |
| Modale / Dialogue            | très forte | `shadow-2xl` |

## Règles

### Interdit

```text
shadow-[...]
```

### Autorisé

```text
shadow-sm
shadow-lg
shadow-2xl
```

Les ombres ne doivent pas être utilisées uniquement pour décorer. Elles doivent communiquer une différence d'élévation.

---

# 7. Backdrop Blur

Le système utilise un seul niveau de backdrop blur pour garantir une apparence cohérente.

| Élément         | Classe             |
| --------------- | ------------------ |
| Modale          | `backdrop-blur-sm` |
| Dropdown        | `backdrop-blur-sm` |
| Popover         | `backdrop-blur-sm` |
| Tooltip         | `backdrop-blur-sm` |
| Banner flottant | `backdrop-blur-sm` |

## Règle

Utiliser exclusivement :

```text
backdrop-blur-sm
```

### Interdit

```text
backdrop-blur
backdrop-blur-md
backdrop-blur-lg
backdrop-blur-xl
backdrop-blur-2xl
```

Une exception peut être introduite uniquement si le design system est volontairement étendu et documenté.

---

# 8. Animation

## 8.1 Librairie

Le projet utilise exclusivement :

```tsx
import { motion } from 'motion/react';
```

`framer-motion` ne doit plus être utilisé dans les composants.

## 8.2 Migration

Rechercher les imports restants :

```bash
grep -r "from 'framer-motion'" src/components/ \
  --include="*.tsx" \
  --include="*.ts"
```

Tous les fichiers concernés doivent être migrés vers `motion/react`.

## 8.3 Accessibilité

Les animations doivent respecter `prefers-reduced-motion`.

Les animations décoratives ou non essentielles doivent pouvoir être réduites ou désactivées.

Éviter les animations longues et les déplacements importants pour les interactions courantes.

---

# 9. États interactifs

Tous les éléments interactifs doivent définir au minimum :

* état normal ;
* état hover ;
* état focus-visible ;
* état active lorsque pertinent ;
* état disabled lorsque pertinent ;
* état loading lorsque pertinent.

## Focus

Le focus clavier doit rester visuellement identifiable.

Exemple :

```tsx
className="
  focus-visible:outline-none
  focus-visible:ring-2
  focus-visible:ring-[var(--accent-primary)]
"
```

Si le projet possède un token de focus dédié, celui-ci doit être préféré.

## Disabled

Un élément désactivé doit :

* réduire visuellement son emphase ;
* ne pas être confondu avec un élément actif ;
* empêcher l'interaction ;
* conserver une indication compréhensible de son état.

---

# 10. Accessibilité

## 10.1 Contraste

Le texte courant doit viser un contraste minimal de **4.5:1** avec son arrière-plan.

Les textes de grande taille peuvent suivre les seuils adaptés aux recommandations WCAG applicables au projet.

## 10.2 Focus

Chaque élément interactif accessible au clavier doit présenter un état `focus-visible` identifiable.

## 10.3 Couleur

La couleur ne doit jamais être le seul moyen de communiquer une information.

Exemple :

```text
❌ Rouge = erreur uniquement

✅ Icône + texte + couleur = erreur
```

## 10.4 Thèmes

Chaque composant doit être testé dans :

```html
data-theme="light"
```

et :

```html
data-theme="dark"
```

---

# 11. Conventions de composants

Les composants doivent privilégier :

1. les classes Tailwind standardisées ;
2. les tokens CSS sémantiques ;
3. les variantes centralisées ;
4. les primitives existantes avant la création de nouvelles variantes.

Exemple :

```tsx
<StatusBadge variant="success">
  Connected
</StatusBadge>
```

plutôt que :

```tsx
<span
  style={{
    color: '#4ade80',
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
  }}
>
  Connected
</span>
```

---

# 12. Checklist de recette par composant

Un composant est considéré comme migré uniquement lorsqu'il respecte les points suivants :

* [ ] Aucune taille typographique arbitraire.
* [ ] Utilisation exclusive des paliers typographiques du système.
* [ ] Aucune couleur hexadécimale en dur dans le composant.
* [ ] Utilisation des tokens CSS sémantiques.
* [ ] Aucun `rounded-[...]` arbitraire.
* [ ] Aucun `shadow-[...]` arbitraire.
* [ ] Utilisation des rayons standardisés.
* [ ] Utilisation des niveaux d'ombre standardisés.
* [ ] `backdrop-blur-sm` pour les overlays concernés.
* [ ] Aucun import de `framer-motion`.
* [ ] Utilisation de `motion/react`.
* [ ] Fonctionnement en thème clair.
* [ ] Fonctionnement en thème sombre.
* [ ] Contraste vérifié.
* [ ] Focus clavier visible.
* [ ] États hover/focus/disabled définis lorsque nécessaires.
* [ ] Support de `prefers-reduced-motion` lorsque des animations sont présentes.

---

# 13. Plan de migration

## Phase 1 — Fondations

Objectif : établir les primitives sans modifier inutilement le rendu.

* [ ] Vérifier les tokens CSS dans `src/index.css`.
* [ ] Ajouter les tokens `*-subtle`.
* [ ] Vérifier les variables de rayon.
* [ ] Vérifier les variables d'ombre.
* [ ] Vérifier les tokens Light/Dark.
* [ ] Migrer les fichiers `framer-motion` vers `motion/react`.
* [ ] Uniformiser `backdrop-blur-sm`.

---

## Phase 2 — Primitives UI

Répertoires :

```text
src/components/ui/
```

Composants prioritaires :

* [ ] `StatusBadge.tsx`
* [ ] `Toast.tsx`
* [ ] `Panel.tsx`
* [ ] `SidePanel.tsx`
* [ ] `IconButton.tsx`
* [ ] `Toggle.tsx`
* [ ] `Tooltip.tsx`
* [ ] `EmptyState.tsx`
* [ ] `ViewHeader.tsx`

---

## Phase 3 — Coquille applicative

* [ ] `components/sidebar/`
* [ ] `components/ide/sidebar/`
* [ ] `StatusBar.tsx`
* [ ] `Breadcrumb.tsx`
* [ ] `EditorTabs.tsx`
* [ ] `CommandPalette.tsx`

Priorités :

1. typographie ;
2. couleurs ;
3. rayons ;
4. ombres ;
5. overlays ;
6. accessibilité.

---

## Phase 4 — Modules fonctionnels

### Panels

```text
components/panels/
```

Appliquer :

* typographie ;
* couleurs ;
* rayons ;
* ombres ;
* états interactifs.

### Notebooks

```text
components/notebooks/
```

Utiliser les tokens spécifiques :

```text
--notebook-*
```

lorsqu'ils existent.

---

## Phase 5 — Réglages et modales

Migrer :

```text
components/settings/
```

ainsi que :

```text
SystemModal.tsx
IdeModal.tsx
ShortcutsModal.tsx
TemplateSelectorModal.tsx
```

Une attention particulière doit être portée aux overlays, au focus clavier et au `backdrop-blur-sm`.

---

# 14. Exemples de migration

## 14.1 StatusBadge

### Avant

```tsx
// ❌ Taille arbitraire
const fontSize = size === 'sm' ? '10px' : '11px';

const padding = size === 'sm'
  ? '2px 6px'
  : '3px 8px';

// ❌ Couleurs en dur
color: '#4ade80',
backgroundColor: 'rgba(16,185,129,0.12)',
```

### Après

```tsx
// ✅ Paliers typographiques standardisés
const fontSize = size === 'sm'
  ? 'text-xs'
  : 'text-sm';

const padding = size === 'sm'
  ? 'px-1.5 py-0.5'
  : 'px-2 py-1';

// ✅ Token sémantique
className="badge-success"
```

---

## 14.2 Toast

### Avant

```tsx
// ❌ Couleurs en dur
const COLORS = {
  success: {
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.3)',
    icon: '#10b981',
  },
  error: {
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.3)',
    icon: '#ef4444',
  },
};

// ❌ Blur non standardisé
backdrop-blur-xl
```

### Après

```tsx
const COLORS = {
  success: {
    bg: 'var(--color-success-subtle)',
    border: 'var(--border-success-subtle)',
    icon: 'var(--color-success)',
  },
  error: {
    bg: 'var(--color-error-subtle)',
    border: 'var(--border-error-subtle)',
    icon: 'var(--color-error)',
  },
};
```

Et :

```tsx
className="backdrop-blur-sm"
```

> Les tokens `--border-success-subtle` et `--border-error-subtle` doivent être définis dans `src/index.css` s'ils sont utilisés comme variables CSS. À défaut, utiliser directement les classes `border-success-subtle` et `border-error-subtle`.

---

# 15. Outils de vérification

## 15.1 Tailles typographiques arbitraires

```bash
grep -rE "text-\[[0-9.]+px\]" src/components/ \
  --include="*.tsx" \
  --include="*.ts"
```

## 15.2 Couleurs hexadécimales

```bash
grep -rE "#[0-9a-fA-F]{3,8}" src/components/ \
  --include="*.tsx" \
  --include="*.ts"
```

## 15.3 Rayons arbitraires

```bash
grep -r "rounded-\[" src/components/ \
  --include="*.tsx" \
  --include="*.ts"
```

## 15.4 Ombres arbitraires

```bash
grep -r "shadow-\[" src/components/ \
  --include="*.tsx" \
  --include="*.ts"
```

## 15.5 Ancienne librairie d'animation

```bash
grep -r "from 'framer-motion'" src/components/ \
  --include="*.tsx" \
  --include="*.ts"
```

## 15.6 Backdrop blur non standard

```bash
grep -r "backdrop-blur-" src/components/ \
  --include="*.tsx" \
  --include="*.ts" \
  | grep -v "backdrop-blur-sm"
```

## 15.7 Valeurs RGB/RGBA en dur

```bash
grep -rE "(rgba?|hsla?)\(" src/components/ \
  --include="*.tsx" \
  --include="*.ts"
```

Cette commande doit être vérifiée manuellement : certaines valeurs peuvent être légitimes lorsqu'aucun token équivalent n'existe.

---

# 16. Critères de validation finale

Avant de considérer la migration terminée, exécuter :

```bash
npm run lint
npm run build
```

Puis effectuer une vérification visuelle des principales vues en :

```text
Light
Dark
```

et tester au minimum :

```text
Desktop
Clavier
Focus
Hover
Disabled
Loading
Réduction des animations
```

La migration est terminée lorsque :

1. les primitives utilisent les tokens du design system ;
2. aucune violation connue ne subsiste ;
3. les deux thèmes sont cohérents ;
4. les composants interactifs restent accessibles ;
5. le build et le lint passent ;
6. aucune régression visuelle importante n'est introduite.

---

# 17. Références

* [Tailwind CSS Documentation](https://tailwindcss.com/docs)
* [MDN — CSS `color-mix()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix)
* [Motion for React Documentation](https://motion.dev/react)
* [WCAG — Web Content Accessibility Guidelines](https://www.w3.org/WAI/standards-guidelines/wcag/)

---

## Historique

### 2.0.0 — 20 septembre 2026

* Correction de l'incohérence entre tailles en pixels et classes Tailwind.
* Clarification des six niveaux typographiques.
* Suppression des correspondances ambiguës entre `text-[14px]`, `text-xl` et `text-2xl`.
* Standardisation des poids typographiques.
* Clarification des tokens sémantiques et des variantes `subtle`.
* Ajout des règles de focus et d'états interactifs.
* Ajout de `prefers-reduced-motion`.
* Correction des exemples de tokens de bordure.
* Ajout de validations `lint` et `build`.
* Ajout d'une checklist d'accessibilité.
* Clarification des exceptions au système.
* Harmonisation des exemples TypeScript/React.
