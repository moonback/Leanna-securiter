# API Reference — Leanna

## Authentification

Toutes les routes `/api/*` (sauf `GET /api/health`) requièrent le header suivant :

```
x-leanna-token: <Leanna_API_TOKEN>
```

Le token est défini dans `.env` (ou auto-généré au premier démarrage). La comparaison est effectuée en temps constant (`crypto.timingSafeEqual`) pour prévenir les timing attacks.

Les WebSockets `/live` et `/sandbox-watch` valident le token via le **cookie** `Leanna_token`, posé automatiquement par le premier appel REST authentifié.

**Codes HTTP communs :**

| Code | Signification |
|---|---|
| `200` | Succès |
| `202` | Accepté (tâche asynchrone démarrée) |
| `400` | Requête invalide (paramètre manquant ou malformé) |
| `401` | Non authentifié |
| `403` | Accès refusé (chemin hors workspace, code sandbox incorrect) |
| `404` | Ressource introuvable |
| `409` | Conflit (fichier déjà existant) |
| `429` | Trop de requêtes (rate limit) |
| `500` | Erreur interne serveur |
| `503` | Service indisponible (sandbox non prêt, Supabase non configuré) |

---

## Domaines fonctionnels

- [Santé](#santé)
- [Runtime autonome](#runtime-autonome)
- [IDE — Système de fichiers](#ide--système-de-fichiers)
- [Sandbox](#sandbox)
- [Agents](#agents)
- [Agents dynamiques (Builder / Registration / Custom)](#agents-dynamiques-builder--registration--custom)
- [Workflows](#workflows)
- [Conversations](#conversations)
- [Mémoires](#mémoires)
- [Mémoire hiérarchique](#mémoire-hiérarchique)
- [Compétences (Skills)](#compétences-skills)
- [Git / GitHub](#git--github)
- [Profil & Tokens](#profil--tokens)
- [Optimisation des tokens](#optimisation-des-tokens)
- [OpenRouter](#openrouter)
- [Notebooks (RAG)](#notebooks-rag)
- [Documents](#documents)
- [Automatisation](#automatisation)
- [Terminal](#terminal)
- [Navigateur intégré](#navigateur-intégré)
- [TTS (synthèse vocale)](#tts-synthèse-vocale)
- [Knowledge Graph](#knowledge-graph)
- [Tools Registry](#tools-registry)
- [Observabilité & coûts](#observabilité--coûts)
- [Audit](#audit)
- [Sauvegardes (Checkpoint & Safeguards)](#sauvegardes-checkpoint--safeguards)
- [Workspace & Self-Root](#workspace--self-root)
- [Listes](#listes)
- [Telegram](#telegram)
- [PM2](#pm2)
- [MCP](#mcp)
- [Export](#export)
- [FTP](#ftp)
- [Marketplace](#marketplace)
- [WebSockets](#websockets)

---

## Santé

### `GET /api/health`

Vérifie que le serveur est opérationnel. Seule route ne nécessitant **pas** d'authentification.

**Authentification :** Non

**Réponse 200 :**
```json
{ "status": "ok" }
```

---

## Runtime autonome

La couche `LeannaCore` utilise le `Runtime EventBus` existant pour créer des tâches de maintenance/réaction observables et bornées. Elle n’exécute aucun LLM depuis le heartbeat ou la perception et ne contourne pas `PermissionPolicy`, `DryRunController`, sandbox, approbations ou `AutonomyPolicy`.

### `GET /api/v2/metrics/autonomy`

Retourne l’état courant du runtime autonome et les tâches récentes. La liste est limitée aux 100 tâches les plus récentes. Cet endpoint reflète l’état en mémoire ; la persistance durable des tâches (checkpoint/reprise après crash) est assurée séparément par `AutonomyPersistence` quand Supabase est configuré (voir [AUTONOMY.md](AUTONOMY.md)). La timeline temps réel des événements `autonomy:*` est par ailleurs diffusée sur le canal WebSocket dédié `/autonomy`.

**Authentification :** Oui (`x-leanna-token`)

**Réponse 200 :**
```json
{
  "state": {
    "status": "watching",
    "activeTasks": 0,
    "pendingEvents": 0,
    "lastWakeAt": 1760000000000,
    "health": "healthy",
    "recentFailures": []
  },
  "tasks": [
    {
      "id": "uuid",
      "type": "maintenance",
      "priority": "high",
      "status": "completed",
      "attempts": 1,
      "maxRetries": 3,
      "timeoutMs": 60000
    }
  ]
}
```

Les statuts de tâche sont `pending`, `running`, `completed`, `dead_letter` et `cancelled`. Une tâche peut être refusée avant création en cas de backpressure, déduplication ou circuit breaker ouvert ; ce refus ne produit pas d’entrée dans `tasks`.

**Erreurs :** `503` si le runtime autonome n’est pas injecté dans le routeur de métriques.

Voir [AUTONOMY.md](AUTONOMY.md) pour la configuration, l’arrêt propre et la récupération.

---

## IDE — Système de fichiers

Toutes les opérations de lecture/écriture sont contraintes au workspace actif (sandbox ou workspace principal). Toute tentative d'accès hors de la racine retourne `403`.

### `GET /api/ide/tree`

Retourne l'arborescence du workspace actif (sandbox si actif, sinon workspace principal). Exclut `node_modules`, `.git`, `dist`, `build`, `out`. **Supporte la pagination côté serveur pour les workspaces avec > 10k fichiers.**

**Authentification :** Oui

**Query Parameters :**
| Paramètre | Type | Description | Obligatoire |
|---|---|---|---|
| `path` | string | Chemin relatif du répertoire à lister (par défaut : racine du workspace) | Non |
| `page` | number | Numéro de la page (début à 1) | Non |
| `pageSize` | number | Nombre d'entrées par page (0 = pas de pagination) | Non |

**Réponse 200 :**
```json
{
  "path": "/absolute/path/to/directory",
  "entries": [
    {
      "name": "src",
      "path": "src",
      "type": "directory",
      "children": []
    },
    {
      "name": "package.json",
      "path": "package.json",
      "type": "file"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 100,
    "total": 150,
    "totalPages": 2,
    "hasMore": true
  }
}
```

**Notes :**
- Lorsque `pageSize` > 0, seul le niveau de répertoire spécifié est retourné (les dossiers ont `children: []`)
- Pour accéder aux sous-éléments, faites des requêtes supplémentaires avec le paramètre `path`
- Si aucun paramètre de pagination n'est fourni et que le répertoire contient > 10 000 entrées, une limite de sécurité de 10 000 est appliquée automatiquement
- Le champ `pagination` n'est présent que lorsque la pagination est active

---

### `GET /api/ide/tree-workspace`

Retourne l'arborescence du workspace **principal** (ignore le sandbox). Exclut également `.Leanna`.

**Authentification :** Oui

**Réponse 200 :** Même format que `/api/ide/tree`.

---

### `GET /api/ide/file`

Lit le contenu d'un fichier texte.

**Authentification :** Oui

**Query params :**

| Nom | Type | Requis | Description |
|---|---|---|---|
| `path` | `string` | ✅ | Chemin relatif au workspace |

**Réponse 200 :**
```json
{ "path": "src/main.tsx", "content": "import React..." }
```

**Erreurs :** `400` si `path` absent · `403` hors workspace · `404` fichier introuvable

---

### `GET /api/ide/file-raw`

Sert un fichier **binaire** (image, PDF…) avec le bon `Content-Type`. Cache `public, max-age=3600`.

**Authentification :** Oui

**Query params :** Même que `/api/ide/file`.

**Réponse 200 :** Contenu binaire avec header `Content-Type` adapté à l'extension.

---

### `POST /api/ide/file`

Sauvegarde le contenu d'un fichier (crée les dossiers parents si nécessaire). Enregistre un événement d'audit.

**Authentification :** Oui

**Body :**
```json
{ "path": "src/utils/helper.ts", "content": "export const foo = () => {};" }
```

| Champ | Type | Requis | Description |
|---|---|---|---|
| `path` | `string` | ✅ | Chemin relatif au workspace |
| `content` | `string` | ❌ | Contenu du fichier (vide si absent) |

**Réponse 200 :**
```json
{ "status": "success", "path": "src/utils/helper.ts", "sandbox": true }
```

---

### `POST /api/ide/create-file`

Crée un fichier vide.

**Authentification :** Oui

**Body :**
```json
{ "path": "src/new-file.ts" }
```

**Réponse 200 :**
```json
{ "status": "success", "path": "src/new-file.ts" }
```

---

### `POST /api/ide/create-directory`

Crée un dossier (récursif).

**Authentification :** Oui

**Body :**
```json
{ "path": "src/components/new-feature" }
```

**Réponse 200 :**
```json
{ "status": "success", "path": "src/components/new-feature" }
```

---

### `POST /api/ide/rename`

Renomme ou déplace un fichier/dossier.

**Authentification :** Oui

**Body :**

| Champ | Type | Requis | Description |
|---|---|---|---|
| `oldPath` | `string` | ✅ | Chemin source relatif |
| `newPath` | `string` | ✅ | Chemin destination relatif |

**Réponse 200 :**
```json
{ "status": "success", "oldPath": "src/old.ts", "newPath": "src/new.ts" }
```

**Erreurs :** `404` source introuvable · `409` destination déjà existante

---

### `POST /api/ide/copy`

Copie un fichier ou dossier (récursif). Génère un nom unique si la destination existe déjà. Les liens symboliques sont refusés (sécurité sandbox).

**Authentification :** Oui

**Body :**

| Champ | Type | Requis | Description |
|---|---|---|---|
| `srcPath` | `string` | ✅ | Chemin source relatif |
| `destPath` | `string` | ✅ | Chemin destination relatif |

**Réponse 200 :**
```json
{ "status": "success", "srcPath": "src/foo.ts", "destPath": "src/foo_copy.ts" }
```

---

### `POST /api/ide/search`

Recherche plein-texte ou regex dans les fichiers du workspace.

**Authentification :** Oui

**Body :**

| Champ | Type | Requis | Description |
|---|---|---|---|
| `query` | `string` | ✅ | Texte ou pattern regex à rechercher |
| `caseSensitive` | `boolean` | ❌ | Sensible à la casse (défaut: `false`) |
| `regex` | `boolean` | ❌ | Interprète `query` comme une regex (défaut: `false`) |
| `filePattern` | `string` | ❌ | Filtre sur le nom de fichier |

**Réponse 200 :**
```json
{
  "results": [
    { "file": "src/main.tsx", "line": 42, "column": 3, "preview": "  const foo = ..." }
  ],
  "truncated": false
}
```

Limité à 1000 résultats. `truncated: true` si la limite est atteinte.

---

### `DELETE /api/ide/file`

Supprime un fichier ou dossier (récursif pour les dossiers).

**Authentification :** Oui

**Query params :**

| Nom | Type | Requis | Description |
|---|---|---|---|
| `path` | `string` | ✅ | Chemin relatif à supprimer |

**Réponse 200 :**
```json
{ "status": "success", "path": "src/old.ts" }
```

---

## Sandbox

Le sandbox isole les modifications de l'IA dans `.Leanna/sandbox/` avant application sur le workspace principal.

### `GET /api/sandbox/status`

Retourne l'état courant du sandbox.

**Authentification :** Oui

**Réponse 200 :**
```json
{
  "status": "success",
  "sandbox": {
    "active": true,
    "path": "/workspace/.Leanna/sandbox",
    "modifiedFiles": ["src/app.ts"]
  }
}
```

---

### `POST /api/sandbox/init`

Initialise le sandbox (copie miroir du workspace).

**Authentification :** Oui · **Body :** vide

**Réponse 200 :** `{ "status": "success", "filesCopied": 142 }`

---

### `POST /api/sandbox/activate`

Active le mode sandbox (les écritures IA sont redirigées vers le sandbox).

**Authentification :** Oui · **Body :** vide

**Réponse 200 :** `{ "status": "success", "active": true, "path": "..." }`

---

### `POST /api/sandbox/deactivate`

Désactive le mode sandbox. Nécessite le code de sécurité à 6 chiffres.

**Authentification :** Oui

**Body :**
```json
{ "code": "123456" }
```

**Erreurs :** `403` code incorrect · `429` trop de tentatives (bloqué 15 min)

---

### `POST /api/verify-exit-code`

Vérifie le code sandbox sans changer son état. Utile pour l'UI de confirmation.

**Authentification :** Oui

**Body :** `{ "code": "123456" }`

**Réponse 200 :** `{ "status": "success" }` · **403 :** code incorrect

---

### `POST /api/sandbox/validate`

Lance une validation TypeScript (`tsc --noEmit`) sur le sandbox.

**Authentification :** Oui · **Body :** vide

**Réponse 200 :**
```json
{
  "status": "success",
  "valid": true,
  "errorCount": 0,
  "warningCount": 2,
  "diagnostics": [],
  "errorsByFile": {}
}
```

---

### `POST /api/sandbox/sync`

Valide TypeScript puis copie le sandbox → workspace principal si valide.

**Authentification :** Oui · **Body :** vide

**Réponse 200 :** `{ "status": "success", "filesSynced": 3 }`

**Réponse si erreurs TS :** `{ "status": "validation_failed", "errorCount": 2, "diagnostics": [...] }`

---

### `GET /api/sandbox/diff`

Retourne la liste des fichiers modifiés dans le sandbox (comparaison avec le workspace principal).

**Authentification :** Oui

**Réponse 200 :** `{ "status": "success", "diffs": [{ "path": "src/app.ts", "status": "modified" }] }`

---

### `GET /api/sandbox/file-diff`

Retourne le contenu avant/après d'un fichier spécifique.

**Authentification :** Oui

**Query params :** `path` (string, requis)

**Réponse 200 :**
```json
{
  "status": "success",
  "path": "src/app.ts",
  "original": "// ancien contenu",
  "modified": "// nouveau contenu"
}
```

---

### `POST /api/sandbox/accept-file`

Applique un fichier individuel du sandbox vers le workspace principal.

**Authentification :** Oui · **Body :** `{ "path": "src/app.ts" }`

**Réponse 200 :** `{ "status": "success", "applied": true, "postValidation": { "valid": true, ... } }`

---

### `POST /api/sandbox/reject-file`

Restaure un fichier à sa version originale (annule la modification dans le sandbox).

**Authentification :** Oui · **Body :** `{ "path": "src/app.ts" }`

**Réponse 200 :** `{ "status": "success", "reverted": true }`

---

### `POST /api/sandbox/discard`

Abandonne toutes les modifications du sandbox (restore complet).

**Authentification :** Oui · **Body :** vide

**Réponse 200 :** `{ "status": "success" }`

---

### `POST /api/sandbox/reset`

Réinitialise le sandbox (re-copie complète depuis le workspace). Nécessite le code de sécurité.

**Authentification :** Oui · **Body :** `{ "code": "123456" }`

**Réponse 200 :** `{ "status": "success", "filesCopied": 145 }`

---

## Agents

### `GET /api/agents/status`

Statistiques de l'orchestrateur et liste des outils agents enregistrés.

**Authentification :** Oui

**Réponse 200 :** `{ "registered": true, "tools": ["agent_delegate", ...], "stats": { ... } }`

---

### `GET /api/agents/tasks`

Liste les 50 dernières tâches agents (en cours et terminées).

**Authentification :** Oui

**Réponse 200 :** `{ "tasks": [{ "id": "uuid", "role": "coder", "status": "completed", ... }] }`

---

### `GET /api/agents/roles`

Liste tous les rôles d'agents disponibles (statiques + dynamiques enregistrés à l'exécution).

**Authentification :** Oui

**Réponse 200 :**
```json
{
  "roles": [
    "coder", "refactor", "debugger", "reviewer", "tester", "security", "architect", "vision",
    "writer", "formatter", "researcher", "proofreader", "translator", "summarizer", "planner"
  ]
}
```

Les 15 rôles ci-dessus sont **statiques** (définis dans `server/agents/roles.ts`, toujours disponibles). Des rôles **dynamiques** additionnels peuvent apparaître s'ils ont été créés via l'Agent Builder / `POST /api/agent-registration/register`.

---

### `GET /api/agents/fleet`

Statut complet de la flotte d'agents (registry + orchestrateur).

**Authentification :** Oui

---

### `GET /api/agents/bus/metrics`

Métriques du bus de messages inter-agents (messages envoyés, reçus, erreurs).

**Authentification :** Oui

---

### `GET /api/agents/bus/history`

Historique des messages entre agents.

**Authentification :** Oui

**Query params :** `limit` (number, max 200, défaut 50)

**Réponse 200 :** `{ "messages": [{ "from": "coder", "to": "architect", "content": "...", "ts": "..." }] }`

---

### `GET /api/agents/collaboration/patterns`

Liste les patterns de collaboration disponibles (ex : `code-review`, `full-stack-feature`).

**Authentification :** Oui

---

### `POST /api/agents/collaborate`

Lance une collaboration structurée multi-agents selon un pattern.

**Authentification :** Oui

**Body :**

| Champ | Type | Requis | Description |
|---|---|---|---|
| `patternName` | `string` | ✅ | Nom du pattern (ex: `code-review`) |
| `context.title` | `string` | ✅ | Titre de la tâche |
| `context.description` | `string` | ✅ | Description détaillée |
| `context.files` | `string[]` | ❌ | Fichiers concernés |
| `context.instructions` | `string` | ❌ | Instructions supplémentaires |

**Réponse 202 :**
```json
{
  "orchestrationId": "uuid",
  "pattern": "code-review",
  "status": "running",
  "tasks": 3,
  "message": "Collaboration \"code-review\" démarrée"
}
```

---

### `POST /api/agents/delegate-autonomous`

Délègue une tâche à un agent autonome. L'agent peut sous-déléguer automatiquement.

**Authentification :** Oui

**Body :**

| Champ | Type | Requis | Description |
|---|---|---|---|
| `role` | `string` | ✅ | Rôle cible (coder, architect…) |
| `title` | `string` | ✅ | Titre de la tâche |
| `description` | `string` | ✅ | Description complète |
| `files` | `string[]` | ❌ | Fichiers à traiter |
| `instructions` | `string` | ❌ | Instructions spécifiques |
| `priority` | `"low"\|"medium"\|"high"\|"critical"` | ❌ | Priorité (défaut: `medium`) |
| `timeoutMs` | `number` | ❌ | Timeout en ms |

**Réponse 202 :**
```json
{
  "taskId": "uuid",
  "role": "coder",
  "status": "pending",
  "message": "Tâche déléguée à l'agent autonome \"coder\""
}
```

---

### `GET /api/agents/persistence/status`

État de la connexion Supabase pour la persistance des agents.

**Authentification :** Oui

---

### `GET /api/agents/tool-mapping`

Mapping complet outil → agent (tous les outils).

**Authentification :** Oui

---

### `GET /api/agents/tool-mapping/primary`

Mapping optimisé outil → agent principal. Utilisé par le frontend.

**Authentification :** Oui

**Réponse 200 :** `{ "success": true, "mapping": { "read_file": "coder", "run_tests": "test" }, "totalTools": 42 }`

---

### `GET /api/agents/:role/tools`

Liste tous les outils disponibles pour un rôle donné.

**Authentification :** Oui

**Path params :** `role` (string)

**Réponse 200 :** `{ "success": true, "role": "coder", "tools": ["read_file", "write_file", ...], "count": 12 }`

---

### `GET /api/v2/agents/*` · `GET /api/v2/metrics`

Endpoints du runtime V2 (nouveau système coexistant). Même logique, nouveau ToolRegistry.

**Authentification :** Oui

---

## Agents dynamiques (Builder / Registration / Custom)

Trois routeurs gèrent le cycle de vie des agents créés à l'exécution (au-delà des 15 rôles statiques).

### `POST /api/agent-builder/generate`

Génère la définition d'un agent dynamique à partir d'une description en langage naturel.

**Authentification :** Oui

---

### `POST /api/agent-registration/register`

Enregistre un nouvel agent dynamique dans le registre.

**Authentification :** Oui

---

### `GET /api/agent-registration/list` · `GET /api/agent-registration/list/all`

Liste les agents dynamiques (`/list`) ou l'ensemble statiques + dynamiques (`/list/all`).

**Authentification :** Oui

---

### `GET /api/agent-registration/check/:role`

Indique si un rôle (statique ou dynamique) existe.

**Authentification :** Oui · **Path params :** `role` (string)

---

### `POST /api/agent-registration/:role/start` · `POST /api/agent-registration/:role/stop`

Démarre ou arrête un agent dynamique déjà enregistré.

**Authentification :** Oui

---

### `DELETE /api/agent-registration/:role`

Supprime un agent dynamique.

**Authentification :** Oui

---

### `GET /api/agent-registration/stats`

Statistiques des agents dynamiques.

**Authentification :** Oui

---

### `GET /api/custom-agents` · `POST /api/custom-agents` · `PUT /api/custom-agents/:id` · `DELETE /api/custom-agents/:id`

CRUD des agents personnalisés persistés.

**Authentification :** Oui

---

### `POST /api/custom-agents/import`

Importe un lot d'agents personnalisés.

**Authentification :** Oui

---

## Workflows

### `GET /api/workflows`

Liste tous les workflows.

**Authentification :** Oui

**Réponse 200 :** `{ "status": "success", "workflows": [{ "id": "uuid", "name": "...", "enabled": true, "schedule": "24h", ... }] }`

---

### `GET /api/workflows/active-runs`

Liste les exécutions de workflows en cours.

**Authentification :** Oui

---

### `POST /api/workflows`

Crée un nouveau workflow.

**Authentification :** Oui

**Body :**

| Champ | Type | Requis | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Nom du workflow |
| `description` | `string` | ❌ | Description |
| `steps` | `object[]` | ✅ | Étapes (tableau JSON) |
| `schedule` | `string` | ❌ | Intervalle (ex: `"24h"`, `"30m"`) |
| `enabled` | `boolean` | ❌ | Actif par défaut (`true`) |

**Réponse 200 :** `{ "status": "success", "workflow": { ... } }`

---

### `POST /api/workflows/:id/run`

Exécute immédiatement un workflow.

**Authentification :** Oui · **Path params :** `id` (UUID)

**Réponse 200 :** `{ "status": "success", "result": { ... } }`

---

### `POST /api/workflows/:id/toggle`

Active ou désactive un workflow.

**Authentification :** Oui

**Body :** `{ "enabled": true }`

---

### `DELETE /api/workflows/:id`

Supprime un workflow.

**Authentification :** Oui

**Réponse 200 :** `{ "status": "success" }` ou `{ "status": "not_found" }`

---

## Conversations

### `GET /api/conversations`

Liste les conversations (paginées).

**Authentification :** Oui

**Query params :**

| Nom | Type | Description |
|---|---|---|
| `limit` | `number` | Max 100, défaut 30 |
| `offset` | `number` | Offset pour la pagination |

**Réponse 200 :** `{ "status": "success", "conversations": [{ "id": "uuid", "title": "...", "message_count": 12, ... }] }`

---

### `GET /api/conversations/search`

Recherche full-text dans les messages (PostgreSQL `to_tsvector` en français).

**Authentification :** Oui

**Query params :** `q` (string, requis) · `limit` (number, max 50)

**Réponse 200 :** `{ "status": "success", "results": [{ "message_id": "uuid", "content": "...", "rank": 0.8 }] }`

---

### `GET /api/conversations/:id`

Récupère les messages d'une conversation.

**Authentification :** Oui

**Path params :** `id` (UUID)

**Query params :** `limit` (max 500, défaut 100) · `offset`

**Réponse 200 :** `{ "status": "success", "messages": [{ "id": "uuid", "role": "user", "content": "...", "created_at": "..." }] }`

---

### `PATCH /api/conversations/:id`

Met à jour le titre d'une conversation.

**Authentification :** Oui · **Body :** `{ "title": "Nouveau titre" }`

---

### `DELETE /api/conversations/:id`

Supprime une conversation et ses messages (cascade).

**Authentification :** Oui

---

### `DELETE /api/conversations/all`

Supprime toutes les conversations.

**Authentification :** Oui

**Réponse 200 :** `{ "status": "success", "deleted": 42 }`

---

## Mémoires

### `GET /api/memories`

Liste les mémoires long-terme (Supabase). Requiert Supabase configuré.

**Authentification :** Oui

**Query params :** `limit` (max 100, défaut 20) · `offset`

**Réponse 200 :** `{ "memories": [{ "id": "uuid", "content": "...", "created_at": "..." }] }`

---

### `DELETE /api/memories/:id`

Supprime une mémoire par son ID.

**Authentification :** Oui

---

### `DELETE /api/memories/all`

Supprime toutes les mémoires.

**Authentification :** Oui

**Réponse 200 :** `{ "status": "success", "deleted": 15 }`

---

## Mémoire hiérarchique

Mémoire organisée par niveaux (`session`, puis niveaux supérieurs) avec promotion entre tiers. Montée sur `/api/memory/hierarchical`.

### `GET /api/memory/hierarchical/stats`

Statistiques par tier.

**Authentification :** Oui

---

### `GET /api/memory/hierarchical/search`

Recherche dans la mémoire hiérarchique.

**Authentification :** Oui · **Query params :** `query` (string)

---

### `GET /api/memory/hierarchical/list`

Liste les entrées d'un tier.

**Authentification :** Oui · **Query params :** `tier` (défaut `session`)

---

### `POST /api/memory/hierarchical/store`

Stocke une entrée.

**Authentification :** Oui · **Body :** `{ "tier", "content", "category?", "tags?", "confidence?", "ttl?", "key?" }`

---

### `POST /api/memory/hierarchical/promote`

Promeut une entrée vers un tier supérieur.

**Authentification :** Oui · **Body :** `{ "id", "fromTier", "toTier", "category?", "tags?", "removeSource?" }`

---

### `DELETE /api/memory/hierarchical/:tier/:id` · `DELETE /api/memory/hierarchical/:tier/clear`

Supprime une entrée précise ou vide un tier entier.

**Authentification :** Oui

---

## Compétences (Skills)

### `GET /api/skills`

Liste tous les skills natifs avec leur statut.

**Authentification :** Oui

**Réponse 200 :**
```json
{
  "skills": [
    { "id": "memory", "name": "Long-term Memory (Supabase)", "icon": "Database", "status": "authenticated" },
    { "id": "automation", "name": "Automation (Puppeteer)", "icon": "Globe", "status": "active" }
  ]
}
```

Statuts possibles : `active` · `authenticated` (Supabase connecté) · `requires_auth` (Supabase non configuré)

---

### `GET /api/custom-skills`

Liste les custom skills créés par l'utilisateur.

**Authentification :** Oui

---

### `POST /api/custom-skills`

Crée un nouveau custom skill.

**Authentification :** Oui

**Body :**

| Champ | Type | Requis | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Nom unique du skill |
| `description` | `string` | ✅ | Description pour l'IA |
| `parameters` | `object[]` | ❌ | Paramètres `[{name, type, description, required}]` |
| `instruction` | `string` | ✅ | Prompt/instruction exécutée par l'IA |
| `category` | `string` | ❌ | Catégorie (défaut: `custom`) |
| `icon` | `string` | ❌ | Icône Lucide (défaut: `Sparkles`) |

---

### `PUT /api/custom-skills/:id` · `DELETE /api/custom-skills/:id`

Met à jour ou supprime un custom skill.

**Authentification :** Oui

---

## Git / GitHub

### `GET /api/git/status`

Statut Git du workspace (fichiers modifiés, branche courante).

**Authentification :** Oui

**Réponse 200 :**
```json
{
  "branch": "main",
  "clean": false,
  "files": [
    { "index": "M", "worktree": " ", "path": "src/app.ts" }
  ]
}
```

---

### `GET /api/git/commits`

Historique des commits récents.

**Authentification :** Oui

**Query params :** `limit` (max 50, défaut 20)

**Réponse 200 :** `{ "commits": [{ "hash": "abc123", "shortHash": "abc", "author": "Dev", "date": "...", "message": "feat: ..." }] }`

---

### `GET /api/git/commits/:hash`

Détail d'un commit (informations + fichiers modifiés).

**Authentification :** Oui

---

### `POST /api/git/commit`

Crée un commit avec tous les fichiers modifiés du workspace (hors `.Leanna`).

**Authentification :** Oui

**Body :** `{ "message": "feat: add new feature" }` (max 200 caractères)

**Réponse 200 :** `{ "success": true, "output": "[main abc1234] feat: ..." }`

---

### `POST /api/git/push`

Pousse vers le remote `origin`.

**Authentification :** Oui · **Body :** vide

---

### `GET /api/git/current-repo`

Récupère owner/repo depuis le remote `origin`.

**Authentification :** Oui

**Réponse 200 :** `{ "status": "success", "owner": "user", "repo": "my-repo", "remoteUrl": "https://..." }`

---

### `GET /api/github/repos`

Liste les repos GitHub de l'utilisateur (nécessite `GITHUB_TOKEN`).

**Authentification :** Oui

---

### `GET /api/github/issues`

Liste les issues d'un repo.

**Authentification :** Oui

**Query params :** `owner` (requis) · `repo` (requis) · `state` (`open`/`closed`, défaut `open`)

---

### `GET /api/github/pulls`

Liste les pull requests d'un repo.

**Authentification :** Oui · **Query params :** mêmes que `/github/issues`

---

### `GET /api/github/notifications`

Notifications GitHub non lues.

**Authentification :** Oui

---

### `GET /api/github/search`

Recherche de repos GitHub.

**Authentification :** Oui · **Query params :** `query` (string, requis)

---

## Profil & Tokens

### `GET /api/profile`

Récupère le profil IA courant (nom, voix, langue, style de réponse…).

**Authentification :** Oui

**Réponse 200 :**
```json
{
  "aiName": "Leanna",
  "aiVoice": "Aoede",
  "userName": "Dev",
  "language": "fr",
  "responseStyle": "balanced",
  "reasoningEnabled": true
}
```

---

### `POST /api/profile`

Met à jour le profil (merge avec l'existant).

**Authentification :** Oui

**Body :** Tout champ du profil (partiel accepté).

---

### `GET /api/tokens`

Liste les clés API configurées avec leur statut de validité (validé en temps réel).

**Authentification :** Oui

**Réponse 200 :**
```json
{
  "tokens": [
    {
      "key": "GEMINI_API_KEY",
      "label": "Gemini API Key",
      "configured": true,
      "valid": true,
      "preview": "AIza••••••••"
    }
  ]
}
```

---

### `POST /api/tokens`

Enregistre ou met à jour une clé API dans `.env` (chiffrée au repos).

**Authentification :** Oui

**Body :** `{ "key": "GEMINI_API_KEY", "value": "AIza..." }`

Clés autorisées : `GEMINI_API_KEY` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `OPENROUTER_API_KEY` · `GITHUB_TOKEN`

---

### `GET /api/gemini-keys`

Liste les clés du pool Gemini (rotation automatique sur 429).

**Authentification :** Oui

---

### `POST /api/gemini-keys` · `DELETE /api/gemini-keys/:id`

Ajoute ou supprime une clé du pool Gemini.

**Authentification :** Oui

---

## Optimisation des tokens

### `GET /api/tokens/optimization`

Retourne l'estimation de consommation de tokens et le budget par modèle.

**Authentification :** Oui

---

### `POST /api/tokens/summarize-context`

Résume un transcript de conversation en conservant les derniers tours, pour réduire l'empreinte contextuelle.

**Authentification :** Oui

**Body :** `{ "transcript": [...], "keepTurns": 8 }`

---

## OpenRouter

Proxy vers l'API OpenRouter (modèles alternatifs). Monté sur `/api/openrouter`.

### `POST /api/openrouter/test`

Teste la validité d'une clé OpenRouter.

**Authentification :** Oui · **Body :** `{ "apiKey", "model?" }`

---

### `POST /api/openrouter/chat`

Complétion de chat via OpenRouter.

**Authentification :** Oui · **Body :** `{ "apiKey", "model", "messages", "temperature?", "topP?", "maxTokens?" }`

---

### `GET /api/openrouter/models`

Liste les modèles OpenRouter disponibles.

**Authentification :** Oui · **Query params :** `apiKey` (optionnel, sinon `OPENROUTER_API_KEY`)

---

## Notebooks (RAG)

### `GET /api/notebooks`

Liste tous les notebooks.

**Authentification :** Oui

---

### `POST /api/notebooks`

Crée un nouveau notebook.

**Authentification :** Oui · **Body :** `{ "title": "Mon notebook", "description": "..." }`

---

### `GET /api/notebooks/:id`

Détail d'un notebook (sources, metadata).

**Authentification :** Oui

---

### `DELETE /api/notebooks/:id`

Supprime un notebook et ses sources.

**Authentification :** Oui

---

### `POST /api/notebooks/:id/sources/upload`

Upload un document source (PDF, texte…) pour ingestion RAG. Rate-limité.

**Authentification :** Oui · **Content-Type :** `multipart/form-data`

**Form fields :** `file` (binaire)

---

### `POST /api/notebooks/:id/chat`

Chat contextuel sur le notebook (RAG). Rate-limité.

**Authentification :** Oui

**Body :** `{ "message": "Résume les points clés" }`

**Réponse 200 :** `{ "answer": "...", "sources": [{ "title": "...", "chunk": "..." }] }`

---

### `POST /api/notebooks/:id/embeddings/reindex`

Relance l'indexation vectorielle des sources. Rate-limité.

**Authentification :** Oui

---

## Documents

### `POST /api/upload-document`

Upload un document (PDF, DOCX…) et l'indexe dans le workspace.

**Authentification :** Oui · **Content-Type :** `multipart/form-data`

**Form fields :** `file` (binaire)

---

### `GET /api/documents`

Liste les documents indexés.

**Authentification :** Oui

---

### `DELETE /api/documents/:id`

Supprime un document indexé.

**Authentification :** Oui

---

## Automatisation

### `GET /api/automation`

Liste les tâches d'automatisation planifiées.

**Authentification :** Oui

---

### `POST /api/automation`

Crée une tâche planifiée.

**Authentification :** Oui

**Body :**

| Champ | Type | Requis | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Nom de la tâche |
| `action_name` | `string` | ✅ | Nom du skill à exécuter |
| `args` | `object` | ❌ | Arguments du skill |
| `interval_expression` | `string` | ✅ | Intervalle (ex: `"24h"`, `"10m"`) |
| `enabled` | `boolean` | ❌ | Actif par défaut (`true`) |

---

### `POST /api/automation/:id/toggle` · `DELETE /api/automation/:id`

Active/désactive ou supprime une tâche planifiée.

**Authentification :** Oui

---

## Terminal

### `GET /api/terminal`

Récupère l'état du terminal.

**Authentification :** Oui

> Le terminal interactif est accessible via **WebSocket** (`/terminal`). Voir section [WebSockets](#websockets).

### Exécution de commandes par skill

Le skill `run_project_command` n'est pas un terminal shell généraliste. Il accepte uniquement les préfixes `npm`, `npx` et `node`, applique une allowlist de sous-commandes et bloque les métacaractères shell dangereux.

| Catégorie | Exemples | Confirmation |
|---|---|---|
| Lecture seule | `npm ls`, `npm list`, `npm outdated` | Aucune |
| Known-safe project execution | `npm test`, `npm run build`, `npm run typecheck` | Standard, car `package.json` reste configurable |
| Script arbitraire | `npm run <autre-script>` | Renforcée : commande réelle du script affichée, risque `high` |
| Installation/modification | `npm install`, `npm uninstall`, `npm update`, `npm ci` | Standard ou renforcée selon la commande |

Une confirmation interactive indisponible entraîne un refus sûr. Le script réellement associé est lu dans `package.json` avant la demande de confirmation lorsque cela est possible.

### Navigation web intégrée

Les outils `browser_*` utilisent le panneau Electron visible. Les liens extraits sont normalisés, filtrés, classés par pertinence puis dédupliqués avant sélection. Les domaines sponsorisés, de navigation et les destinations non publiques sont exclus des recherches automatiques.

La policy réseau est `PUBLIC_WEB_AND_LOCALHOST` : `localhost` et les sous-domaines `*.localhost` sont autorisés pour les serveurs de développement. Les IP loopback (`127.0.0.1`, `::1`), réseaux privés RFC1918, link-local (`169.254.0.0/16`) et domaines internes restent refusés. Les recherches multi-sources renvoient les sources, domaines, fiabilité, fraîcheur, faits, preuves, consensus, contradictions et confiance globale.

---

## Navigateur intégré

Le routeur `/api/browser` relaie les actions du navigateur Electron intégré (outils `browser_*`). Les requêtes de contenu et d'action sont résolues de manière asynchrone via des promesses côté serveur, puis renvoyées à l'appelant.

**Authentification :** Oui

> Le comportement fonctionnel (normalisation des liens, filtrage, classement, policy `PUBLIC_WEB_AND_LOCALHOST`) est décrit dans la section [Navigation web intégrée](#navigation-web-intégrée) ci-dessus.

---

## TTS (synthèse vocale)

Synthèse vocale via Gemini TTS avec cache. Montée sur `/api/tts`.

### `POST /api/tts/speak`

Synthétise un texte en audio.

**Authentification :** Oui

**Réponse 200 :** `{ "audio": "<base64 PCM>", "cached": false }`

---

### `POST /api/tts/speak-stream`

Synthèse en streaming (Server-Sent Events, chunks audio).

**Authentification :** Oui

---

### `GET /api/tts/stats`

Métriques du cache / de la file / du provider TTS.

**Authentification :** Oui

---

### `POST /api/tts/cache/clear`

Vide le cache TTS.

**Authentification :** Oui · **Réponse 200 :** `{ "status": "ok", "message": "Cache TTS vidé." }`

---

## Knowledge Graph

### `GET /api/knowledge/status`

Statut de l'indexation du Knowledge Graph.

**Authentification :** Oui

---

### `POST /api/knowledge/scan`

Lance une re-indexation complète du workspace.

**Authentification :** Oui

---

### `GET /api/knowledge/impact`

Analyse l'impact d'une modification sur le graphe de dépendances.

**Authentification :** Oui

---

### `GET /api/knowledge/understanding`

Retourne la compréhension contextuelle d'un fichier ou d'un symbole.

**Authentification :** Oui

---

## Tools Registry

Diagnostic unifié du registre d'outils (runtime V2 + SkillManager + MCP). Monté sur `/api/tools`.

### `GET /api/tools/registry`

Retourne l'inventaire complet des outils enregistrés avec leur source.

**Authentification :** Oui

---

### `GET /api/tools/count`

Nombre d'outils enregistrés par source.

**Authentification :** Oui

---

## Observabilité & coûts

Télémétrie OpenTelemetry, statistiques d'usage et budgets par mission. Montée sur `/api/observability`.

### `GET /api/observability/dashboard`

Statistiques agrégées pour le tableau de bord (fenêtre : jour).

**Authentification :** Oui

---

### `GET /api/observability/usage`

Usage détaillé (tokens, coûts).

**Authentification :** Oui · **Query params :** `missionId`, `agentRole`, `provider`, `limit`

---

### `GET /api/observability/budget/:missionId` · `POST /api/observability/budget/:missionId` · `DELETE /api/observability/budget/:missionId`

Consulte, définit ou supprime les garde-fous de budget d'une mission.

**Authentification :** Oui · **Body (POST) :** `{ "maxTokens?", "maxCostUsd?" }`

---

### `GET /api/observability/stats/day` · `GET /api/observability/stats/hour`

Statistiques agrégées sur les dernières 24 h ou la dernière heure.

**Authentification :** Oui

---

### `GET /api/observability/health` · `POST /api/observability/flush`

État du service de télémétrie · déclenche un flush vers Supabase.

**Authentification :** Oui

---

## Audit

### `GET /api/audit`

Retourne le log d'audit des opérations sur les fichiers.

**Authentification :** Oui

**Réponse 200 :**
```json
{
  "events": [
    {
      "action": "write_file",
      "target": "src/app.ts",
      "actor": "user",
      "details": "updated via IDE",
      "timestamp": "2026-09-04T10:00:00.000Z"
    }
  ]
}
```

---

## Sauvegardes (Checkpoint & Safeguards)

Deux routeurs gèrent les points de restauration Git et les garde-fous de build.

### `POST /api/checkpoint/create`

Crée un checkpoint (point de restauration).

**Authentification :** Oui · **Body :** `{ "reason?": "checkpoint manuel" }`

---

### `POST /api/checkpoint/rollback`

Restaure le workspace à un checkpoint donné.

**Authentification :** Oui · **Body :** `{ "hash": "abc123" }`

---

### `GET /api/checkpoint/list`

Liste les checkpoints disponibles.

**Authentification :** Oui

---

### `POST /api/checkpoint/validate`

Valide le build courant.

**Authentification :** Oui

---

### `GET /api/safeguards/config` · `POST /api/safeguards/config`

Lit ou met à jour la configuration des garde-fous (`.Leanna/safeguards.json`).

**Authentification :** Oui

---

### `GET /api/safeguards/checkpoints` · `POST /api/safeguards/validate` · `POST /api/safeguards/rollback`

Liste les checkpoints, valide le build, ou effectue un rollback via les garde-fous.

**Authentification :** Oui

---

## Workspace & Self-Root

Gestion du workspace actif et de l'historique des dépôts (`SELF_ROOT`).

### `GET /api/self-root/status`

État du workspace racine courant.

**Authentification :** Oui

---

### `GET /api/self-root/workspaces`

Liste tous les dépôts enregistrés dans l'historique.

**Authentification :** Oui

---

### `POST /api/self-root/workspaces/validate`

Pré-valide un chemin avant ouverture.

**Authentification :** Oui

---

### `PATCH /api/self-root/workspaces/:id` · `DELETE /api/self-root/workspaces/:id`

Met à jour (nom, siteUrl) ou retire un workspace de l'historique (sans supprimer les fichiers sur disque).

**Authentification :** Oui

---

### `POST /api/self-root/change`

Change le workspace actif.

**Authentification :** Oui

---

### `POST /api/self-root/new`

Crée un projet vierge et l'active.

**Authentification :** Oui

---

### `POST /api/self-root/clear`

Efface le projet persisté (pour re-sélection).

**Authentification :** Oui

---

### `POST /api/self-root/scaffold` · `POST /api/self-root/clone`

Échafaude un nouveau projet (framework au choix) ou clone un dépôt distant. Les deux **streament** leur progression via Server-Sent Events.

**Authentification :** Oui

---

### `PATCH /api/self-root/site-url`

Met à jour uniquement l'URL du site du workspace.

**Authentification :** Oui

---

## Listes

Listes intelligentes simples (nom → items). Montées sur `/api/lists`.

### `GET /api/lists` · `POST /api/lists`

Liste toutes les listes · crée une liste.

**Authentification :** Oui · **Body (POST) :** `{ "name", "items?": [] }`

---

### `GET /api/lists/:name`

Récupère une liste par son nom.

**Authentification :** Oui

---

### `POST /api/lists/:name/items` · `DELETE /api/lists/:name/items`

Ajoute ou retire des items d'une liste.

**Authentification :** Oui

---

### `DELETE /api/lists/:name`

Supprime une liste entière.

**Authentification :** Oui

---

## Telegram

Intégration bot Telegram (notifications, envoi de fichiers). Montée sur `/api/telegram`.

### `GET /api/telegram/status` · `GET /api/telegram/config` · `POST /api/telegram/config`

État du bot · lecture / mise à jour de la configuration (token, utilisateurs autorisés, auto-start…).

**Authentification :** Oui

---

### `POST /api/telegram/start` · `POST /api/telegram/stop`

Démarre ou arrête le bot.

**Authentification :** Oui

---

### `POST /api/telegram/test`

Envoie un message de test.

**Authentification :** Oui · **Body :** `{ "chatId" }`

---

### `POST /api/telegram/send` · `POST /api/telegram/photo` · `POST /api/telegram/document`

Envoie un message texte, une photo ou un document.

**Authentification :** Oui

---

### `POST /api/telegram/broadcast`

Diffuse un message à tous les utilisateurs autorisés.

**Authentification :** Oui · **Body :** `{ "message", "parseMode?", "onlyNumericIds?" }`

---

### `GET /api/telegram/users` · `POST /api/telegram/chat-info`

Liste les utilisateurs autorisés · récupère les informations d'un chat.

**Authentification :** Oui

---

### `POST /api/telegram/send-from-workspace`

Envoie un fichier du workspace projet.

**Authentification :** Oui · **Body :** `{ "chatId", "path", "caption?", "parseMode?" }`

---

## PM2

Contrôle du gestionnaire de processus PM2 (déploiements en production). Monté sur `/api/pm2`.

### `GET /api/pm2/status`

État des processus PM2 (`pm2 jlist`).

**Authentification :** Oui

---

### `POST /api/pm2/:name/restart` · `POST /api/pm2/:name/stop`

Redémarre ou arrête un processus par nom.

**Authentification :** Oui

---

### `POST /api/pm2/reload` · `POST /api/pm2/flush`

Recharge (`?file=ecosystem.config.cjs`) ou vide les logs.

**Authentification :** Oui

---

### `GET /api/pm2/logs/:name`

Récupère les logs d'un processus.

**Authentification :** Oui · **Query params :** `lines` (défaut 50), `type` (`out`/`err`/`all`)

---

## MCP

### `GET /api/mcp/status`

Statut des serveurs MCP connectés.

**Authentification :** Oui

---

### `POST /api/mcp/call`

Appelle un outil sur un serveur MCP.

**Authentification :** Oui

**Body :** `{ "server": "server-name", "tool": "tool-name", "args": { ... } }`

---

## Export

### `POST /api/export`

Exporte des données (conversations, mémoires…) dans différents formats.

**Authentification :** Oui

---

## FTP

### `POST /api/ftp/connect`

Établit une connexion FTP.

**Authentification :** Oui

**Body :** `{ "host": "ftp.example.com", "user": "user", "password": "pass", "port": 21 }`

> Par défaut, les IPs privées (RFC 1918) sont bloquées. Définir `ALLOW_FTP_PRIVATE_IPS=true` pour les autoriser.

---

### `GET /api/ftp/list`

Liste les fichiers d'un répertoire FTP.

**Authentification :** Oui · **Query params :** `path` (string)

---

## Marketplace

### `GET /api/marketplace`

Liste les agents et skills disponibles dans le catalogue marketplace.

**Authentification :** Oui

---

### `POST /api/marketplace/install`

Installe un item du marketplace.

**Authentification :** Oui · **Body :** `{ "id": "item-id" }`

---

## WebSockets

### `WS /live`

Session Gemini Live bidirectionnelle. Gère le texte, l'audio, la vidéo et les tool calls.

**Auth :** Cookie `Leanna_token` (posé par le premier appel REST authentifié)

**Messages entrants (client → serveur) :**

```json
{ "type": "text", "text": "Explique ce code" }
{ "type": "audio_chunk", "data": "<base64>" }
{ "type": "video_frame", "data": "<base64>" }
{ "type": "tool_result", "callId": "uuid", "result": { ... } }
```

**Messages sortants (serveur → client) :**

```json
{ "type": "text_chunk", "text": "Bien sûr..." }
{ "type": "audio_chunk", "data": "<base64>" }
{ "type": "tool_call", "callId": "uuid", "name": "read_file", "args": { ... } }
{ "type": "knowledge_progress", "phase": "indexing", "current": 42, "total": 100 }
{ "type": "agent_event", "event": "task_started", "taskId": "uuid", "role": "coder" }
{ "type": "mission_event", "event": "step_completed", ... }
```

---

### `WS /sandbox-watch`

Notifications temps réel des changements dans le sandbox.

**Auth :** Cookie `Leanna_token`

**Messages sortants :**
```json
{ "type": "file_changed", "path": "src/app.ts", "action": "modified" }
{ "type": "file_created", "path": "src/new.ts" }
{ "type": "file_deleted", "path": "src/old.ts" }
```

---

### `WS /terminal`

Terminal PTY interactif.

**Auth :** Token via cookie ou query param

**Messages entrants :** Commandes shell en texte brut ou JSON `{ "type": "resize", "cols": 80, "rows": 24 }`

**Messages sortants :** Sortie du terminal en texte brut (stdout + stderr du PTY)


---

## Tests d'intégration

Tous les endpoints REST disposent de tests d'intégration dans `server/routes/*.test.ts`.

**Couverture actuelle : 103 tests d'intégration répartis sur 19 fichiers**

### Tests par routeur

| Routeur | Fichier de test | Nombre de tests | Couverture |
|---|---|---|---|
| Agents | `agents.test.ts` | 15 | Statut, tâches, rôles, flotte, bus, collaboration, persistance, mapping |
| Marketplace | `marketplace.test.ts` | 13 | Recherche, featured, installation, publication, sécurité |
| Conversations | `conversations.test.ts` | 7 | Liste, recherche, messages, CRUD |
| Skills | `skills.test.ts` | 7 | Liste, propriétés, core skills, statut Supabase |
| Workflows | `workflows.test.ts` | 7 | CRUD, exécution, toggle |
| Browser | `browser.test.ts` | 6 | Content requests, actions, promesses |
| Upload Document | `upload-document.test.ts` | 6 | Validation fichiers, types supportés, rate limiting |
| Profile | `profile.test.ts` | 6 | GET/POST profile, GET/POST tokens |
| Terminal | `terminal.test.ts` | 5 | Configuration, sessions, authentification |
| Sandbox | `sandbox.test.ts` | 5 | Statut, init/activate, validation, diff |
| Self-Root | `self-root.test.ts` | 4 | Statut, workspaces, validation, changement |
| Export | `export.test.ts` | 3 | Formats d'export, validation |
| GitHub | `github.test.ts` | 5 | Repos, issues, PRs, recherche |
| IDE | `ide.test.ts` | 3 | Arbre, lecture/écriture fichiers |
| Memories | `memories.test.ts` | 3 | GET, DELETE (Supabase) |
| Telegram | `telegram.test.ts` | 3 | Statut, configuration, envoi |
| Workspace | `workspace.test.ts` | 3 | GET info, POST interdit |
| Mémoire hiérarchique | `hierarchicalMemory.test.ts` | 1 | Endpoint stats |
| Health | `health.test.ts` | 1 | Health check |

### Exécuter les tests d'intégration

```bash
# Tous les tests d'intégration des routes
npm test -- server/routes/*.test.ts

# Un routeur spécifique
npm test -- server/routes/agents.test.ts

# Voir les résultats détaillés
npm test 2>&1 | grep -E "(✔|✖)"
```

### Ajouter des tests pour une nouvelle route

Voir le guide complet dans [CONTRIBUTING.md](CONTRIBUTING.md#ajouter-une-route-api).

Template minimal :

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import myRouter from './my-route.js';

test('GET /my-endpoint returns 200', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/my-route', myRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/my-route/my-endpoint`);
    assert.equal(res.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
```
