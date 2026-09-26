-- Activation de l'extension pgvector pour la future recherche sémantique (RAG)
create extension if not exists vector;

-- Activation de l'extension pg_trgm pour la recherche textuelle (gin_trgm_ops)
create extension if not exists pg_trgm;

-- Création de la table memories
create table if not exists public.memories (
    id uuid default gen_random_uuid() primary key,
    content text not null,
    tags text[] default '{}'::text[],
    
    -- Colonne pour les embeddings (activée pour la phase RAG)
    -- dimension 768 recommandée pour les modèles d'embedding standards (ex: Google GenAI)
    embedding vector(768),

    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamptz not null default now()
);

-- Trigger auto-update pour updated_at (idempotent)
create or replace function public.update_memories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_memories_updated_at on public.memories;

create trigger trg_memories_updated_at
  before update on public.memories
  for each row
  execute function public.update_memories_updated_at();

-- Sécurité au niveau des lignes (RLS)
alter table public.memories enable row level security;

-- Seul le backend (avec la clé SERVICE_ROLE) peut lire et écrire
create policy "Le backend a un accès total aux mémoires"
on public.memories
for all
to service_role
using (true)
with check (true);

-- Index pour accélérer la recherche textuelle (optionnel mais utile)
create index if not exists memories_content_idx on public.memories using gin (content gin_trgm_ops);

-- Création de la table lists pour stocker les listes de l'utilisateur dans Supabase
create table if not exists public.lists (
    id uuid default gen_random_uuid() primary key,
    name text not null,
    name_lower text not null,
    items jsonb not null default '[]'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists lists_name_lower_unique on public.lists(name_lower);

alter table public.lists enable row level security;

create policy "Le backend a un accès total aux listes"
on public.lists
for all
to service_role
using (true)
with check (true);

create index if not exists lists_updated_at_idx on public.lists(updated_at desc);

-- Fonction pour la recherche par similarité (RAG)
create or replace function match_memories (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    memories.id,
    memories.content,
    1 - (memories.embedding <=> query_embedding) as similarity
  from memories
  where 1 - (memories.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;
