-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration : ajout de la colonne updated_at à la table memories
--
-- Contexte : server/skills/memory.ts référence memories.updated_at dans les
-- .select() et .update(), mais la colonne n'existait pas à la création de la
-- table (supabase_schema.sql). Cela provoquait l'erreur :
--   42703: column memories.updated_at does not exist
-- sur list_memories / search_memory / save_memory (update path).
--
-- Idempotent : peut être rejoué sans erreur.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Ajout de la colonne updated_at (nullable au moment de l'ALTER pour ne pas
--    bloquer si la table contient déjà des lignes ; on backfill ensuite).
alter table public.memories
  add column if not exists updated_at timestamptz;

-- 2. Backfill : les lignes existantes prennent created_at comme updated_at.
update public.memories
  set updated_at = created_at
  where updated_at is null;

-- 3. Contrainte NOT NULL + défaut maintenant que le backfill est fait.
alter table public.memories
  alter column updated_at set not null,
  alter column updated_at set default now();

-- 4. Trigger auto-update (même pattern que custom_skills) : updated_at = now()
--    à chaque UPDATE, pour que le code puisse se contenter de mettre à jour le
--    contenu sans gérer updated_at côté applicatif.
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
