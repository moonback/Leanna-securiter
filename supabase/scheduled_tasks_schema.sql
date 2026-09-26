-- Création de la table scheduled_tasks pour stocker les tâches d'automatisation
create table if not exists public.scheduled_tasks (
    id uuid default gen_random_uuid() primary key,
    name text not null,
    description text,
    action_name text not null,
    args jsonb default '{}'::jsonb,
    interval_expression text not null, -- ex: "24h", "10m"
    enabled boolean default true,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.scheduled_tasks enable row level security;

create policy "Le backend a un accès total aux tâches planifiées"
on public.scheduled_tasks
for all
to service_role
using (true)
with check (true);
