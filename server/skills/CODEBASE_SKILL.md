# Codebase Skill - Documentation

Le skill `codebase` permet à l'assistant Leanna d'explorer, lire, créer, modifier, déplacer et
supprimer des fichiers dans le workspace du projet.

## Stratégie de lecture/édition recommandée

1. `read_file_outline` — structure du fichier (exports, fonctions, classes, lignes). Beaucoup
   moins coûteux en tokens qu'une lecture complète.
2. `read_project_file` avec `startLine`/`endLine` — ne lire que la section concernée.
3. `search_in_files` ou `list_project_files` (recursive) — si l'emplacement du code est incertain.
4. Édition, par ordre de priorité : `patch_project_file` (par lignes) > `modify_project_file`
   (remplacement de texte exact) > `write_project_file` (création ou réécriture totale
   uniquement).

Ne jamais lire un gros fichier intégralement, ne jamais inventer de contenu.

## Vérification automatique

Après `write_project_file`, `modify_project_file`, `patch_project_file` ou
`rename_project_file`, le serveur exécute automatiquement `verify_file` sur le fichier concerné
(`tsc --noEmit` ciblé + test associé s'il existe). Le résultat est renvoyé dans la réponse ;
ne pas relancer `verify_file` manuellement, mais corriger immédiatement si `ok=false`.

## Outils disponibles

### Exploration

#### `get_workspace_info`
Retourne le chemin absolu du workspace, son statut, et les fichiers de config détectés
(`package.json`, `tsconfig.json`, etc.). Aucun paramètre.

#### `open_ide`
Ouvre l'interface IDE dans l'application. À appeler avant les opérations fichiers si l'IDE
n'est pas encore visible. Aucun paramètre.

#### `list_project_files`
Liste les fichiers et dossiers d'un répertoire du projet.
- `path` (string, optionnel) : chemin relatif du dossier à lister (`.` pour la racine).
- `recursive` (boolean, optionnel) : liste récursivement les sous-dossiers. Défaut `false`.

#### `search_in_files`
Recherche un texte ou un pattern dans les fichiers du projet, avec contexte autour des
correspondances. Utile pour trouver où une fonction/classe/variable est utilisée.
- `query` (string, requis) : texte exact ou pattern regex.
- `path` (string, optionnel) : dossier de recherche (défaut : racine du projet).
- `extensions` (string, optionnel) : extensions séparées par des virgules (ex. `ts,tsx,js`).
- `caseSensitive` (boolean, optionnel) : défaut `false`.
- `maxResults` (number, optionnel) : défaut `20`.

### Lecture

#### `read_file_outline`
Retourne la structure d'un fichier (exports, fonctions, classes, interfaces + numéros de
ligne). À utiliser AVANT `read_project_file` pour cibler la bonne section.
- `path` (string, requis)

#### `read_project_file`
Lit le contenu d'un fichier existant.
- `path` (string, requis)
- `startLine` (number, optionnel) : première ligne à lire (1-based).
- `endLine` (number, optionnel) : dernière ligne à lire (1-based).

Pour les gros fichiers, toujours préciser `startLine`/`endLine` (ex. ±20 lignes autour de la
zone à modifier) plutôt que de lire tout le fichier.

#### `analyze_project_file`
Retourne des métadonnées sur un fichier (nombre de lignes, taille, extension) et un aperçu du
contenu.
- `path` (string, requis)

#### `open_project_file`
Ouvre un fichier dans l'IDE et positionne le curseur à une ligne donnée. Utile pour montrer
visuellement un fichier après édition.
- `path` (string, requis)
- `line` (number, optionnel, 1-based)
- `column` (number, optionnel, 1-based)

### Écriture

#### `write_project_file`
Crée un nouveau fichier ou écrase complètement un fichier existant.
- `path` (string, requis)
- `content` (string, requis) : contenu complet du fichier.

**⚠️ Attention :** écrase totalement le fichier s'il existe déjà. Toujours lire le fichier
avant de le réécrire. À réserver à la création ou à la réécriture totale volontaire.

#### `modify_project_file`
Remplace un texte exact par un nouveau texte.
- `path` (string, requis)
- `searchText` (string, requis) : texte exact à rechercher (espaces/indentation compris).
- `replaceText` (string, requis) : texte de remplacement.
- `replaceAll` (boolean, optionnel) : remplace toutes les occurrences si `true`. Défaut
  `false` (première occurrence uniquement).

**💡 Conseil :** `searchText` doit correspondre EXACTEMENT au contenu du fichier (utiliser
`read_project_file` avant). Le remplacement est effectué en littéral (pas d'interprétation de
motifs `$1`, `$&`, etc. dans `replaceText`).

#### `patch_project_file`
Modifie un fichier via des opérations ligne par ligne. Plus économe en tokens que
`modify_project_file` pour des changements ciblés. Utiliser `read_file_outline` en amont pour
identifier les numéros de ligne.
- `path` (string, requis)
- `operations` (array, requis) : liste d'opérations, chacune avec :
  - `type` : `"replace"` (remplace les lignes `startLine`-`endLine`), `"insert"` (insère après
    `startLine`) ou `"delete"` (supprime les lignes `startLine`-`endLine`).
  - `startLine` (number, requis, 1-based)
  - `endLine` (number, requis pour `replace`/`delete`, 1-based inclusif)
  - `content` (string, requis pour `replace`/`insert`, lignes séparées par `\n`)

**⚠️ Important :**
- Les opérations sont réordonnées et appliquées automatiquement du bas vers le haut (par
  `startLine` décroissant) afin que les numéros de ligne restent stables pendant l'application.
  L'ordre indiqué dans la requête n'est donc pas forcément l'ordre d'exécution.
- Les plages d'opérations ne doivent **pas se chevaucher** : une validation rejette la requête
  avec une erreur explicite si deux opérations touchent les mêmes lignes. Découper en plages
  disjointes ou fusionner les changements en une seule opération.

### Organisation

#### `create_project_directory`
Crée un dossier (et ses parents si nécessaire).
- `path` (string, requis)

#### `rename_project_file`
Renomme ou déplace un fichier/dossier dans le workspace.
- `oldPath` (string, requis)
- `newPath` (string, requis) : peut inclure un changement de dossier pour déplacer le fichier.

#### `delete_project_file`
Supprime un **fichier** individuel du projet.
- `path` (string, requis)

#### `delete_project_folder`
Supprime un **dossier entier** et tout son contenu de façon récursive.
- `path` (string, requis) : chemin relatif du dossier (ex: `src/old-feature`, `dist/legacy`)

⚠️ Une confirmation interactive est demandée si le dossier contient des fichiers. Dossiers protégés non supprimables : `.git`, `node_modules`, `.Leanna`, `electron`, `.husky`.

## Sécurité

- Tous les chemins sont validés pour rester dans le workspace du projet (`normalizeProjectPath`).
- Les modifications sont tracées et peuvent être annulées via Git.

## Exemples de commandes pour l'utilisateur

### Exploration
- "Liste les fichiers dans src/components"
- "Cherche où la fonction `formatDate` est utilisée"

### Lecture
- "Montre-moi la structure de server.ts"
- "Lis les lignes 100 à 150 de server.ts"

### Création
- "Crée un nouveau composant React dans src/components/Button.tsx"

### Modification
- "Dans App.tsx, change le titre de 'Hello' à 'Bonjour'"
- "Remplace les lignes 42-45 de server.ts par cette nouvelle route"

### Suppression / Organisation
- "Supprime le fichier test-old.js"
- "Déplace src/utils/helper.ts vers src/lib/helper.ts"
- "Crée une structure de dossiers pour les tests : tests/unit et tests/integration"

## Notes techniques

- Limite de lecture : 200 000 caractères par fichier (au-delà, aperçu tronqué avec avertissement).
- Encodage : UTF-8.
- Chemins : relatifs à la racine du projet (`process.cwd()`).
