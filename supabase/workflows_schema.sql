-- Création de la table workflows pour stocker les chaînes d'actions (pipelines)
create table if not exists public.workflows (
    id uuid default gen_random_uuid() primary key,
    name text not null,
    description text default '',
    steps jsonb not null default '[]'::jsonb,
    schedule text, -- expression d'intervalle (ex: "24h", "30m"), null = pas de planification
    enabled boolean default true,
    last_run_at timestamp with time zone,
    last_run_status text, -- 'success', 'partial', 'failed'
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.workflows enable row level security;

create policy "Le backend a un accès total aux workflows"
on public.workflows
for all
to service_role
using (true)
with check (true);

-- Index pour filtrer rapidement les workflows actifs planifiés
create index if not exists idx_workflows_enabled_schedule 
on public.workflows (enabled) 
where schedule is not null;
