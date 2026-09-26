# Leanna — IDE 

> Leanna ne lit, n'écrit et n'exécute **que sur le code source du projet ouvert**. Ce document décrit l'architecture self-referential et explique comment étendre les skills en respectant le périmètre verrouillé.

---

## 1. Principe

Leanna est un IDE multi-workspaces sécurisé : l'utilisateur peut ouvrir et basculer entre n'importe quels dépôts externes tout en garantissant que **l'IA et les outils restent strictement confinés au projet actif**. 

Cette contrainte est **structurelle**, pas cosmétique :
- Le workspace actif (`SELF_ROOT`) est la source unique de vérité pour toutes les compétences IA, explorateurs et sandbox.
- L'historique et le registre des dépôts sont stockés dans `.Leanna/workspaces.json` sous la racine interne de l'application (`Leanna_APP_ROOT`).
- Les chemins système racine (`C:\`, `/`, `C:\Windows`, etc.) sont bloqués dès la pré-validation (`validateWorkspacePath`).
- Tous les accès filesystem passent par une validation de chemin centralisée et un suivi anti-symlink escape.
- Les fichiers critiques nécessitent une confirmation explicite avant modification.
- Chaque écriture crée un checkpoint git automatique (rollback trivial).
- Les documents PDF du workspace sont lus et indexés dans le périmètre autorisé, puis rendus dans l’IDE pour lecture et analyse documentaire.

---

## 2. Le module `selfRoot.ts`

`server/utils/selfRoot.ts` est la **source unique de vérité** pour le périmètre autorisé et le registre multi-workspaces.

### Exports

| Export | Type | Rôle |
|--------|------|------|
| `SELF_ROOT` | `string` | Racine absolue du workspace actif courant |
| `listWorkspaces()` | `() => WorkspaceEntry[]` | Retourne la liste des dépôts enregistrés triés par date de dernier accès |
| `validateWorkspacePath(path)` | `(string) => Promise<WorkspaceValidationResult>` | Valide un chemin candidat, empêche l'accès aux dossiers systèmes et audite les symlinks |
| `addOrUpdateWorkspace(path, siteUrl?, name?)` | `(...) => WorkspaceEntry` | Enregistre ou actualise un dépôt dans `.Leanna/workspaces.json` |
| `removeWorkspace(idOrPath)` | `(string) => boolean` | Retire un workspace du registre (sans supprimer les fichiers sur disque) |
| `normalizeSelfPath(target)` | `(string) => string \| null` | Résout un chemin relatif et vérifie qu'il reste dans `SELF_ROOT`. Retourne `null` si sortie du périmètre |
| `isWriteForbidden(absPath)` | `(string) => boolean` | `true` si le chemin est totalement interdit en écriture (`.git/config`, `node_modules`…) |
| `isCriticalFile(absPath)` | `(string) => boolean` | `true` si le fichier nécessite une confirmation utilisateur (`server.ts`, `.env`…) |
| `resolveRealPathWithinSelf(path)` | `(string) => Promise<string \| null>` | Résout les symlinks et vérifie le chemin réel (anti symlink-escape) |
| `auditSymlinks()` | `() => Promise<string[]>` | Scanne le repo pour détecter les symlinks pointant hors du périmètre |
| `listFtpServers()` | `() => FtpServerEntry[]` | Retourne les serveurs FTP connus, sans mot de passe |
| `saveFtpServer(...)` | `(...) => FtpServerEntry` | Ajoute ou actualise un serveur FTP dans `.Leanna/ftp-servers.json` |
| `removeFtpServer(id)` | `(string) => boolean` | Retire un serveur FTP du registre sans supprimer son miroir local |
| `renameFtpServer(id, name)` | `(string, string) => FtpServerEntry \| null` | Modifie le nom d'affichage d'un serveur FTP |

### Synchronisation FTP

Le routeur `server/routes/ftp.ts` expose la connexion FTP/FTPS et utilise `server/utils/ftpSync.ts` pour travailler avec un miroir local. Le mot de passe est transmis uniquement dans la requête courante et n'est pas écrit dans le registre.

- `POST /api/ftp/test` vérifie l'authentification et l'accès au chemin distant, puis enregistre les métadonnées du serveur si le test réussit.
- `POST /api/ftp/download` ouvre un flux SSE, télécharge récursivement le répertoire distant et active le miroir comme workspace à la fin.
- `POST /api/ftp/push` ouvre un flux SSE et envoie tous les fichiers du miroir, ou seulement les chemins relatifs fournis dans `files`.
- `POST /api/ftp/list` liste un répertoire distant sans récursion ; `POST /api/ftp/local-path` calcule le chemin local du miroir.
- `GET/DELETE/PATCH /api/ftp/servers` gère le registre des connexions connues.

Les miroirs sont stockés sous `~/.Leanna/ftp-workspaces/<hôte>_<port>/<chemin>/`. Les dossiers système courants (`.ssh`, `.gnupg`, `logs`, `tmp`, etc.) et les liens symboliques sont ignorés pendant le téléchargement.

### Listes de protection

```typescript
// Nécessitent une confirmation explicite avant modification
CRITICAL_FILES = [
  "server.ts", "server/security.ts", "server/utils/selfRoot.ts",
  "electron/main.cjs", "electron/preload.cjs",
  ".env", ".env.local", ".gemini-keys.json",
];

// Totalement interdits en écriture, même avec confirmation
FORBIDDEN_WRITE_TARGETS = [".git/config", ".git/HEAD", "node_modules"];
```

---

## 3. Règles pour étendre un skill

Quand vous ajoutez un skill qui touche au filesystem, respectez **impérativement** ce contrat :

### ✅ À faire

```typescript
import { SELF_ROOT, normalizeSelfPath, isWriteForbidden, isCriticalFile } from "../utils/selfRoot";

// 1. Toujours résoudre le root via SELF_ROOT (jamais process.cwd())
function getProjectRoot(): string {
  return SELF_ROOT;
}

// 2. Valider tout chemin entrant AVANT accès
const normalized = normalizeSelfPath(requestedPath);
if (!normalized) return { error: "Chemin invalide ou en dehors du workspace." };

// 3. Pour les écritures : vérifier les interdits et les fichiers critiques
if (isWriteForbidden(normalized)) return { error: "Écriture interdite sur fichier protégé." };
const critical = isCriticalFile(normalized);
```

### ❌ À ne pas faire

```typescript
// JAMAIS : process.cwd() n'est pas fiable en Electron packagé
const root = process.cwd();

// JAMAIS : accès direct sans normalisation (path traversal)
fs.readFileSync(path.join(root, userInput));

// JAMAIS : lire Leanna_DEFAULT_WORKSPACE (supprimé du produit)
const ws = process.env.Leanna_DEFAULT_WORKSPACE;
```

---

## 4. Les garde-fous auto-modification (Phase 2)

Quand un skill modifie du code, chaînez les protections dans cet ordre :

```typescript
// 1. Rate limiting (anti-boucle infinie : 30 écritures/min)
if (!checkWriteRateLimit()) return { error: "Rate limit atteint." };

// 2. Validation du chemin
const normalized = normalizeSelfPath(requestedPath);
if (!normalized) return { error: "Chemin invalide." };
if (isWriteForbidden(normalized)) return { error: "Interdit." };

// 3. Confirmation interactive pour fichiers critiques
const critical = isCriticalFile(normalized);
if (critical && toolContext.emitToClient) {
  const approved = await requestConfirmation(requestedPath, 'write', toolContext.emitToClient);
  if (!approved) return { error: "Refusé par l'utilisateur." };
}

// 4. Checkpoint git AVANT écriture
await createCheckpoint(`avant écriture: ${requestedPath}`);

// 5. Écriture effective
await fs.promises.writeFile(normalized, content, "utf-8");

// 6. Audit enrichi (avec diff)
appendAuditEvent({ action: 'write', target: requestedPath, actor: 'ai',
  diff: generateDiffSummary(beforeContent, content) });

// 7. Restart serveur si nécessaire + validation post-édition
triggerRestartIfNeeded(requestedPath);
scheduleValidation();
```

### Modules impliqués

| Module | Rôle |
|--------|------|
| `utils/checkpoint.ts` | Snapshot git avant modification, rollback, validation `tsc` |
| `utils/confirmationBridge.ts` | Demande de confirmation UI (timeout 30s → refus) |
| `utils/serverRestart.ts` | Détecte les modifs serveur, redémarrage contrôlé |
| `utils/postEditValidator.ts` | Lance `tsc --noEmit` automatiquement (debounce 2.5s) |
| `audit.ts` | Journal NDJSON enrichi avec diff sommaire |

## 4.1 Transparence des réponses et missions

Toute réponse produite à partir du workspace doit conserver les preuves réellement utilisées : chemins ou sources, lignes, tests exécutés et extraits. Le panneau **Inspecter le contexte** permet de vérifier ces preuves et d'exclure une source pour la réponse en cours ; l'exclusion impose de recalculer le contexte avant toute nouvelle citation.

Pour une mission multi-étapes, l'état `planned` précède l'état `running`. Le plan doit afficher les objectifs, fichiers ciblés, outils, risques, coût estimé et conditions d'arrêt. La confirmation de l'utilisateur est requise avant le premier outil d'écriture ou d'exécution, et une condition d'arrêt satisfaite termine la mission sans lancer l'étape suivante.

---

## 5. Moteur AST Tree-sitter, Call-Graph & Documents PDF

Leanna analyse le codebase en profondeur grâce au moteur **Tree-sitter WASM** (`server/knowledge/ASTParser.ts`) et au graphe d'appels bidirectionnel (`server/knowledge/ASTCallGraph.ts`). En complément, le système inclut un mécanisme d'extraction documentaire pour les PDF du workspace, avec lecture du texte via `pdf-parse`, indexation dans le `DocumentStore` et ouverture dans l’IDE.

### Outils disponibles pour l'assistant :

| Outil | Usage |
|---|---|
| `knowledge_ast_callers` | Trouve tous les appelants d'une fonction (qui en dépend ?) |
| `knowledge_ast_callees` | Trouve toutes les fonctions appelées par une fonction |
| `knowledge_ast_call_chain` | Déroule l'arbre récursif BFS d'exécution |
| `knowledge_ast_file_inspect` | Inspecte l'AST d'un fichier (signatures typées, plages de lignes, classes) |
| `knowledge_build_context` | Collecte le contexte optimal (fichiers, faits, AST) pour une mission |

---

## 6. Sandboxing MCP (Phase 4)

Les serveurs MCP externes peuvent exposer des outils qui reçoivent des chemins. `McpBridge.sanitizePathArgs()` intercepte tous les arguments dont la clé ressemble à un chemin (`path`, `file`, `dir`, `cwd`, `target`, `source`, `destination`…) et vérifie qu'ils restent dans `SELF_ROOT`. Un chemin hors périmètre lève une erreur avant l'appel du tool.

---

## 7. Configuration développeur

En développement uniquement, vous pouvez surcharger le root pour les tests :

```bash
# NODE_ENV=development requis
Leanna_SELF_ROOT_OVERRIDE="/chemin/vers/repo/test" npm run dev
```

Cette variable est **ignorée en production** et absente du `.env.example` public.

---

## 7. Tests de sécurité

Le périmètre est couvert par des tests automatisés :

| Fichier | Couverture |
|---------|-----------|
| `server/security.test.ts` | Path traversal, fichiers interdits, fichiers critiques |
| `server/selfRoot.test.ts` | Résolution du root, immutabilité, isolation env |
| `server/utils/safeguards.test.ts` | Confirmation, restart, diff audit, MCP sandboxing |
| `server/utils/checkpoint.test.ts` | Checkpoints, validation build |

```bash
npm run test
```

---

## 8. Interface utilisateur

- **Settings → Self-Root** : affiche le root verrouillé, la branche git, le statut sync.
- **Settings → Garde-fous** : toggles (checkpoint auto, validation, confirmation critique), liste des checkpoints, rollback.
- **Self-Edit Banner** : bandeau dans l'éditeur quand l'IA modifie le fichier ouvert.
- **StatusBar** : branche git, statut build, connexion MCP, compteur tokens.
- **Onboarding** : écran de premier lancement expliquant le périmètre.

### Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Ctrl+Shift+K` | Créer un checkpoint manuel |
| `Ctrl+Shift+B` | Lancer la validation (`tsc --noEmit`) |
| `Ctrl+Shift+H` | Afficher le panneau des checkpoints |
