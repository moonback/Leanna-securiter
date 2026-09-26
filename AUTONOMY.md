# Runtime autonome événementiel Leanna

Ce document décrit la couche d’autonomie livrée par Leanna, son exploitation 24/7 et ses limites actuelles. Elle complète les systèmes existants ; elle ne les remplace pas.

## Objectif et périmètre

Le runtime autonome réagit aux événements intéressants et reste en veille quand aucun travail n’est nécessaire. Il ne contient pas de boucle LLM et ne contourne jamais les contrôles existants.

```text
Runtime EventBus
  → PerceptionEngine (déterministe)
  → TaskManager (borné, priorisé, dédupliqué)
  → handler sûr (observation/mémoire)
  → EventBus / métriques

HeartbeatService surveille l’état local et choisit ACTIVE, IDLE ou SLEEP.
```

Les composants réutilisés sont `AgentRuntime`, `EventBus`, `Mission`/`Executor`, `ToolRegistry`, `PermissionPolicy`, `DryRunController`, `AutonomyPolicy`, `Memory`, `Observability` et le graceful shutdown existant. L’audit détaillé est disponible dans [AUTONOMY_AUDIT.md](AUTONOMY_AUDIT.md).

## Cycle de vie

### Démarrage

1. `server-bootstrap.ts` charge et valide la configuration.
2. `bootstrapRuntimeSync()` initialise le runtime existant et le registre d’outils.
3. `server.ts` crée et démarre `LeannaCore`.
4. Le cœur s’abonne au `Runtime EventBus`, initialise le heartbeat et passe en `watching`.
5. Les missions interrompues continuent d’utiliser leur mécanisme existant de reprise Supabase.

### Réveil et décision

Lorsqu’un événement runtime normal arrive, `LeannaCore` met à jour `lastWakeAt`, réveille immédiatement le heartbeat et transmet l’événement au `PerceptionEngine`. La perception ne fait appel à aucun modèle : elle classe notamment les échecs de tâches, refus de permissions et échecs de workflows avec des règles locales.

Une perception qui nécessite une attention crée au plus une tâche `maintenance` ou `reactive`. Le fingerprint est fondé sur le type d’événement et les ressources affectées ; les doublons sont refusés pendant le TTL de déduplication. Les événements `autonomy:*` sont ignorés comme entrées pour empêcher une boucle de rétroaction.

### Exécution et retour au repos

Le `TaskManager` exécute les tâches dans la limite de concurrence configurée. L’état passe successivement par `pending`, `running`, puis `completed`, `dead_letter` ou `cancelled`. Après une tâche terminée, le cœur revient à `watching`. À l’inactivité, le heartbeat fait évoluer l’état exposé vers `idle` puis `sleeping`.

Dans cette incrémentation, le handler intégré enregistre un fait compact en mémoire de session, avec TTL de 24 heures. Il ne lance pas automatiquement de mission ou d’outil à effet de bord. Cela garantit que toute extension future devra explicitement traverser les politiques de mission, permissions, sandbox, dry-run et approbation déjà en place.

## Événements et timeline

| Événement | Producteur | Signification |
|---|---|---|
| `autonomy:heartbeat` | `HeartbeatService` | État local ACTIVE/IDLE/SLEEP et raison du tick. |
| `autonomy:stateChanged` | `LeannaCore` | Transition de l’état global observable. |
| `autonomy:health` | `LeannaCore` | Santé `healthy` ou `degraded`. |
| `autonomy:taskCreated` | `LeannaCore` | Tâche autonome acceptée dans la queue. |
| `autonomy:taskStateChanged` | `TaskManager` via `LeannaCore` | Transition de cycle de vie et erreur terminale éventuelle. |

Les événements restent **in-process** côté EventBus. Ils sont adaptés au réveil immédiat et à l’observabilité d’une instance ; ils ne constituent pas encore un journal durable ni un bus multi-processus.

### Timeline temps réel (WebSocket)

En plus des métriques HTTP, les cinq événements `autonomy:*` sont diffusés en temps réel sur un **canal WebSocket dédié `/autonomy`**, en lecture seule et sans session Gemini (contrairement à `/live`). Ce canal suit le même modèle `noServer` que `/sandbox-watch` et `/terminal`, exige le même jeton (`Leanna_token` en cookie) et n’accepte aucune commande entrante. `LeannaCore` accepte un broadcaster optionnel (`options.broadcaster` ou `setBroadcaster()`) ; sans broadcaster, le comportement est inchangé.

À la connexion, le client reçoit d’abord un snapshot pour ne pas démarrer vide :

```json
{
  "type": "autonomy_snapshot",
  "timestamp": "2026-09-20T12:00:00.000Z",
  "state": { "status": "watching", "activeTasks": 0, "health": "healthy", "recentFailures": [] },
  "tasks": []
}
```

Puis chaque événement suit une enveloppe uniforme, cohérente avec les canaux existants :

```json
{
  "type": "autonomy_event",
  "event": "autonomy:taskStateChanged",
  "timestamp": "2026-09-20T12:00:00.000Z",
  "payload": { "taskId": "…", "taskType": "reactive", "from": "running", "to": "completed" }
}
```

Le champ `event` reprend le type d’origine (`autonomy:heartbeat`, `autonomy:stateChanged`, `autonomy:health`, `autonomy:taskCreated`, `autonomy:taskStateChanged`) et `payload` contient les champs de l’événement sans le champ `type` dupliqué. La diffusion est best-effort : une erreur d’envoi n’affecte jamais le runtime.

Côté frontend, le hook `useAutonomyTimeline` (dans `src/hooks/`) maintient la connexion `/autonomy` avec reconnexion à backoff exponentiel et un tampon d’événements borné, et expose `{ state, tasks, events, connection }`. Le composant `AutonomyTimeline` (dans `src/components/`) affiche une timeline vivante de l’état, de la santé, des tâches en cours et des derniers échecs, sans polling. Ce panneau est purement observationnel : il ne déclenche aucune action.

La vue est accessible dans l’UI via la route `/autonomy` (vue `AutonomyView`), atteignable depuis la navigation globale de la sidebar (entrée « Autonomie »).

## File, protection contre les boucles et récupération

- **Concurrence** : le nombre de tâches autonomes en cours est limité globalement.
- **Backpressure** : une tâche est refusée lorsque la queue est pleine ; aucun travail accepté n’est évincé.
- **Priorité et aging** : `critical > high > medium > low`, avec un bonus d’âge pour prévenir la starvation.
- **Déduplication** : un fingerprint est conservé pendant le TTL configuré.
- **Retry** : les retries sont exponentiels et bornés par `LEANNA_AUTONOMY_MAX_RETRIES`.
- **Timeout** : une exécution lente est arrêtée côté orchestration et passe dans le chemin d’échec.
- **Circuit breaker** : après le seuil d’échecs du type de tâche, les nouvelles tâches de ce type sont refusées jusqu’à la fin du cooldown.
- **Dead-letter** : une tâche terminalement échouée est visible dans `/api/v2/metrics/autonomy`; les 20 derniers échecs sont conservés dans l’état du core.
- **Shutdown** : les nouveaux travaux et retries sont refusés/annulés, puis le runtime partagé est arrêté par le lifecycle existant.

## Sécurité et modes d’autonomie

Le runtime autonome n’accorde aucune permission. Les protections suivantes restent obligatoires pour toute action réelle :

1. `PermissionPolicy` vérifie les permissions déclarées par outil.
2. `DryRunController` intercepte les effets `write`, `exec` et `network` quand le dry-run est actif.
3. `AutonomyPolicy` applique les modes `suggest`, `ask` et `auto`, ainsi que `.leannaignore`.
4. Le sandbox, les confirmations et les checkpoints existants restent sur le chemin des écritures.

Pour démarrer prudemment, conserver :

```env
Leanna_PERMISSION_MODE="enforce"
Leanna_DRY_RUN="true"
LEANNA_AUTONOMY_MAX_CONCURRENCY="1"
```

Ne mettez `Leanna_DRY_RUN="false"` qu’après avoir vérifié les permissions accordées et le comportement des missions. Le mode `auto` d’`AutonomyPolicy` ne doit pas être considéré comme une permission globale : les permissions runtime et les protections de chemins restent applicables.

## Configuration

Toutes les durées sont en millisecondes.

| Variable | Défaut | Rôle |
|---|---:|---|
| `LEANNA_HEARTBEAT_ACTIVE_MS` | 15000 | Tick lorsque l’activité ou la santé requiert l’attention. |
| `LEANNA_HEARTBEAT_IDLE_MS` | 60000 | Tick après une première période d’inactivité. |
| `LEANNA_HEARTBEAT_SLEEP_MS` | 300000 | Tick minimal en veille. Les événements réveillent immédiatement. |
| `LEANNA_HEARTBEAT_IDLE_AFTER_MS` | 300000 | Seuil avant le passage idle, puis sleep. |
| `LEANNA_AUTONOMY_MAX_CONCURRENCY` | 2 | Tâches autonomes exécutées simultanément. |
| `LEANNA_AUTONOMY_MAX_QUEUE_SIZE` | 100 | Maximum de tâches en attente ; au-delà, backpressure. |
| `LEANNA_AUTONOMY_DEDUPE_TTL_MS` | 300000 | Fenêtre de déduplication par fingerprint. |
| `LEANNA_AUTONOMY_RETRY_DELAY_MS` | 1000 | Délai de base pour les retries exponentiels. |
| `LEANNA_AUTONOMY_MAX_RETRIES` | 3 | Tentatives maximales par tâche. |
| `LEANNA_AUTONOMY_TASK_TIMEOUT_MS` | 60000 | Timeout d’une tentative. |
| `LEANNA_AUTONOMY_CIRCUIT_BREAKER_THRESHOLD` | 5 | Échecs avant ouverture du circuit. |
| `LEANNA_AUTONOMY_CIRCUIT_BREAKER_COOLDOWN_MS` | 300000 | Temps de refroidissement du circuit. |

Les valeurs invalides ou non positives reviennent au défaut sûr du code.

## Lancer et superviser 24/7

### Développement

```bash
npm install
cp .env.example .env
npm run dev
```

### Production avec PM2

```bash
npm run build
pm2 start ecosystem.config.cjs --only leanna-server
pm2 status
pm2 logs leanna-server
pm2 save
pm2 startup
```

La configuration PM2 existante utilise une seule instance, un redémarrage automatique, un backoff de redémarrage, une limite mémoire de 1 Go et un délai d’arrêt gracieux. Une seule instance est importante : le `EventBus` et le `TaskManager` autonomes actuels sont locaux au processus. Pour coordonner un travail sensible entre plusieurs instances, un verrou distribué optionnel est désormais disponible (voir « Verrou distribué (multi-instance) »).

### Vérifier l’état

Toutes les routes suivantes, sauf `/api/health`, requièrent `x-leanna-token` :

```bash
curl http://127.0.0.1:4000/api/health
curl -H "x-leanna-token: $Leanna_API_TOKEN" \
  http://127.0.0.1:4000/api/v2/metrics/autonomy
curl -H "x-leanna-token: $Leanna_API_TOKEN" \
  http://127.0.0.1:4000/api/v2/metrics/health
```

Le premier endpoint retourne l’état, les tâches récentes (maximum 100) et les erreurs terminales. Les logs PM2 complètent les métriques runtime.

### Test de charge et soak

Un test dédié valide le `TaskManager` sous charge soutenue : débit, backpressure, borne du cache de déduplication, retries + circuit breaker + timeout sous charge, et arrêt propre sans timer résiduel. Il vit dans `server/autonomy/TaskManager.soak.test.ts`.

```bash
# Variante rapide (borne réduite, incluse dans `npm test`)
node --import tsx --test server/autonomy/TaskManager.soak.test.ts

# Variante soak lourde (charge soutenue prolongée)
npm run test:soak
```

La variante soak (`LEANNA_SOAK=1`) soumet le travail par vagues successives — comme le fait la charge réelle, où les événements arrivent en flux plutôt qu’en un seul burst massif. Elle affiche le débit soutenu mesuré (de l’ordre de plusieurs milliers de tâches/s en mémoire) et vérifie qu’aucune tâche acceptée n’est perdue ni exécutée deux fois. À noter : la file de priorité est re-triée à chaque défilement, donc un burst unique très volumineux est un pire cas plutôt qu’un régime nominal ; l’usage réel (petites vagues d’événements) reste efficace.

### Verrou distribué (multi-instance)

Un verrou mutuel optionnellement distribué (`server/utils/DistributedLock.ts`) permet de garantir qu’un travail sensible au multi-instance (par ex. un scheduler ou une reprise de tâches) ne s’exécute que sur un seul processus à la fois. C’est la brique nécessaire pour lever à terme la contrainte « une seule instance PM2 ».

- **Backend Redis** (quand `REDIS_URL` ou `LEANNA_LOCK_REDIS_URL` est défini) : acquisition atomique via `SET key token NX PX ttl`, libération via un script Lua compare-and-delete qui ne supprime la clé que si le token nous appartient — jamais le verrou d’un autre détenteur après expiration ou renouvellement.
- **Repli in-process** (sans Redis) : le verrou reste correct au sein d’un même processus, comme les autres intégrations optionnelles (Supabase, cache).
- **Anti-deadlock** : chaque verrou porte un TTL qui l’auto-expire si le détenteur crashe ; `renew()` prolonge le TTL tant que le verrou est détenu.

```ts
import { distributedLock } from "./server/utils/DistributedLock.js";

const outcome = await distributedLock.withLock(
  "leanna:autonomy:scheduler",
  async () => { /* section critique mono-instance */ },
  { ttlMs: 30_000, waitMs: 0 }, // waitMs: 0 = non bloquant
);
if (!outcome.acquired) {
  // Une autre instance détient déjà le verrou : ne rien faire ici.
}
```

Le verrou seul ne rend pas l’`EventBus`/`TaskManager` multi-processus ; il fournit la primitive de coordination. Le transport d’événements multi-processus est traité par le pont Redis Streams ci-dessous.

### Bus d’événements multi-processus (Redis Streams)

Un pont optionnel (`server/runtime/RedisEventBridge.ts`) rend l’`EventBus` in-process effectivement multi-processus et durable, **sans réécrire son cœur ni changer son comportement local**. Le pont :

1. publie chaque événement local sur un Redis Stream (`XADD`, avec trim `MAXLEN ~`) ;
2. consomme le stream en tâche de fond (`XREAD BLOCK`) et ré-émet localement les événements provenant des **autres** instances.

Sans `REDIS_URL` (ou `LEANNA_EVENTBUS_REDIS_URL`), `start()` est un no-op : le bus reste strictement in-process, exactement comme avant.

- **Prévention des boucles** : chaque instance porte un `instanceId` unique ; le consommateur ignore ses propres entrées, et les événements ré-émis par le pont sont marqués (WeakSet) pour ne jamais être republiés. Sans ce garde, un événement étranger ré-émis serait aussitôt republié → boucle infinie.
- **Connexions dédiées** : une connexion pour publier, une connexion dupliquée pour la lecture bloquante (`XREAD BLOCK`), afin que la consommation ne bloque pas les publications.
- **Arrêt propre** : le lifecycle appelle `stop()` (arrêt de la consommation + fermeture des connexions) avant l’arrêt du runtime partagé.

Variables : `LEANNA_EVENTBUS_REDIS_URL`, `LEANNA_EVENTBUS_STREAM` (défaut `leanna:eventbus`), `LEANNA_EVENTBUS_MAXLEN` (défaut 10000). Combiné au verrou distribué (pour n’exécuter le travail mono-instance qu’une fois) et au task store durable, ce pont ouvre la voie à un déploiement multi-instance ; un durcissement (groupes de consommateurs `XREADGROUP`, accusés de réception, tests d’intégration multi-instance) reste à mener avant un usage à grande échelle.

### Arrêter proprement et récupérer

```bash
pm2 stop leanna-server
# ou, sans PM2 : Ctrl+C / SIGTERM sur npm start
```

Le lifecycle arrête d’abord LeannaCore, ses timers et sa queue, puis AgentRuntime, les services externes et le serveur HTTP. Après redémarrage, les missions déjà persistées peuvent être reprises seulement si Supabase et la table `missions` sont configurés.

### Task store durable et reprise des tâches autonomes

Les tâches génériques du `TaskManager` sont désormais persistées quand Supabase est configuré, via `AutonomyPersistence` (table `autonomy_tasks`). La persistance suit le même contrat optionnel qu’`AgentPersistence` :

- **Écritures best-effort** : chaque tâche est enregistrée à la création puis à chaque transition d’état. Les erreurs Supabase sont journalisées et n’interrompent jamais la queue en mémoire.
- **Mode dégradé silencieux** : sans `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`, le runtime reste strictement en mémoire, comme auparavant.
- **Reprise au démarrage** : `LeannaCore.start()` recharge les tâches `pending` et `running` non terminées et les re-soumet au `TaskManager`. Une tâche `running` interrompue par un crash repart en `pending`.
- **Bornes réappliquées** : les tâches reprises repassent par la déduplication, les retries, le timeout et le circuit breaker existants. La reprise n’accorde aucune permission et ne contourne aucune politique.

Créer la table une fois via `AutonomyPersistence.getMigrationSQL()` (dashboard Supabase ou migration) :

```sql
CREATE TABLE IF NOT EXISTS autonomy_tasks (
  id              UUID PRIMARY KEY,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'medium',
  source_event_id TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  timeout_ms      INTEGER NOT NULL DEFAULT 60000,
  metadata        JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Limites connues et prochaines étapes

Le task store durable et la reprise des tâches autonomes génériques sont désormais disponibles quand Supabase est configuré (voir « Task store durable et reprise des tâches autonomes »). La persistance reste in-process côté file : elle assure la reprise après crash mais ne coordonne pas plusieurs processus.

La timeline temps réel des événements `autonomy:*` est désormais diffusée sur un canal WebSocket dédié `/autonomy` et consommée par un composant frontend (`useAutonomyTimeline` + `AutonomyTimeline`). Voir « Timeline temps réel (WebSocket) ».

Le fallback inter-providers pour la génération de texte est désormais disponible : `generateText` (dans `server/utils/textGeneration.ts`) bascule automatiquement vers l’autre provider (Gemini ↔ OpenRouter) en cas d’échec du provider principal, avec un disjoncteur par provider pour éviter d’ajouter de la latence pendant une panne prolongée. Il est piloté par `LEANNA_PROVIDER_FALLBACK`, `LEANNA_PROVIDER_BREAKER_THRESHOLD` et `LEANNA_PROVIDER_BREAKER_COOLDOWN_MS`. La rotation de clés Gemini (`withGeminiRetry`) reste en place sous cette couche ; un appel forçant explicitement un provider (`forceProvider`) reste sans fallback (par ex. la critique indépendante du module de raisonnement).

Un test de charge/soak du `TaskManager` est désormais disponible (voir « Test de charge et soak »).

Un verrou distribué optionnel (Redis, avec repli in-process) est désormais disponible pour coordonner un travail mono-instance entre plusieurs processus (voir « Verrou distribué (multi-instance) »).

Un bus d’événements durable multi-processus (Redis Streams) est désormais disponible via un pont optionnel qui dégrade proprement vers l’in-process sans Redis (voir « Bus d’événements multi-processus (Redis Streams) »).

Les briques initialement listées comme prochaines étapes (task store durable, checkpoint/reprise, fallbacks de providers, timeline WebSocket + frontend, test de charge/soak, verrou distribué, Redis Streams) sont désormais en place, chacune optionnelle et à dégradation propre. Le durcissement pour un usage multi-instance à grande échelle reste recommandé : groupes de consommateurs Redis avec accusés de réception, et tests d’intégration multi-instance de bout en bout. Aucune de ces couches ne contourne les politiques de permissions, dry-run, sandbox ou approbation existantes.

## Boucle d'apprentissage inter-missions (StrategyMemory)

Depuis l'itération d'autonomie documentée dans
[`docs/LEANNA_AUTONOMY_MASTER_AUDIT.md`](docs/LEANNA_AUTONOMY_MASTER_AUDIT.md) et
[`docs/LEANNA_AUTONOMY_IMPLEMENTATION_REPORT.md`](docs/LEANNA_AUTONOMY_IMPLEMENTATION_REPORT.md),
la fiabilité des outils est mémorisée durablement et **réutilisée** par la planification.

- `server/knowledge/StrategyMemory.ts` enregistre, par outil, un signal compact
  (succès/échec, durée) dans `.Leanna-strategy.json` (par workspace, écriture atomique,
  dégradation propre en mémoire seule). Aucun secret ni payload n'y est stocké.
- Au démarrage d'une mission, `SkillScorer.seedFromReliability()` amorce l'historique de
  scoring : un outil historiquement défaillant est déprioritisé **dès la première
  planification**, sans attendre un échec re-observé. Les observations vivantes de la mission
  courante restent prioritaires.
- Le `Planner` reçoit un avertissement listant les outils peu fiables et, lors d'une
  replanification, écarte les outils durablement défaillants tout en garantissant qu'au moins
  un outil reste disponible.
- `AutonomousExecutive.decide()` consulte l'historique d'échecs d'une même classe d'objectif :
  après plusieurs échecs, l'objectif est escaladé au lieu d'être ré-tenté indéfiniment.
- Observabilité : `GET /api/v2/metrics/reliability` expose ce signal (outils défaillants +
  statistiques), ce qui rend la décision de déprioriser un outil explicable.

Le contrat d'autonomie complet est décrit dans
[`docs/AUTONOMY_CONTRACT.md`](docs/AUTONOMY_CONTRACT.md).
