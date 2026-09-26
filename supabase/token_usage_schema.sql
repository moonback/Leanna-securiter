-- ═══════════════════════════════════════════════════════════════════════════
-- token_usage — Suivi des coûts et tokens (Observabilité V1.1)
-- ═══════════════════════════════════════════════════════════════════════════
-- Persiste chaque appel modèle (Gemini / OpenRouter) avec sa consommation de
-- tokens et son coût estimé. Alimenté par TelemetryService (flush périodique).
-- Sert de source au tableau de bord Coûts & Tokens (/api/observability).

create table if not exists public.token_usage (
    -- id est fourni par TelemetryService (chaîne unique), pas un uuid Postgres.
    id text primary key,
    mission_id text,
    task_id text,
    agent_role text,
    tool_name text,
    provider text not null,            -- 'gemini' | 'openrouter'
    model text not null,               -- ex: 'gemini-2.5-flash'
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    total_tokens integer not null default 0,
    cost_usd double precision not null default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ── Index pour les agrégations du tableau de bord ──────────────────────────
create index if not exists token_usage_created_at_idx
    on public.token_usage (created_at desc);

create index if not exists token_usage_mission_id_idx
    on public.token_usage (mission_id);

create index if not exists token_usage_agent_role_idx
    on public.token_usage (agent_role);

create index if not exists token_usage_model_idx
    on public.token_usage (model);

-- ── Row Level Security : seul le backend (service_role) a accès ────────────
alter table public.token_usage enable row level security;

-- Idempotent : on supprime la policy si elle existe déjà avant de la recréer
-- (CREATE POLICY n'accepte pas IF NOT EXISTS en Postgres).
drop policy if exists "Le backend a un accès total à token_usage" on public.token_usage;

create policy "Le backend a un accès total à token_usage"
on public.token_usage
for all
to service_role
using (true)
with check (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Vues d'agrégation (facultatives) — utiles pour des requêtes directes
-- ═══════════════════════════════════════════════════════════════════════════

-- Coût quotidien par modèle
create or replace view public.token_usage_daily_by_model as
select
    date_trunc('day', created_at) as day,
    model,
    provider,
    count(*)              as calls,
    sum(total_tokens)     as tokens,
    sum(cost_usd)         as cost_usd
from public.token_usage
group by 1, 2, 3
order by 1 desc, 6 desc;

-- Coût par mission
create or replace view public.token_usage_by_mission as
select
    mission_id,
    count(*)              as calls,
    sum(total_tokens)     as tokens,
    sum(cost_usd)         as cost_usd,
    min(created_at)       as first_call,
    max(created_at)       as last_call
from public.token_usage
where mission_id is not null
group by 1
order by 4 desc;
