-- Création de la table conversations pour stocker les sessions de conversation
create table if not exists public.conversations (
    id uuid default gen_random_uuid() primary key,
    title text,
    summary text,
    started_at timestamp with time zone default timezone('utc'::text, now()) not null,
    ended_at timestamp with time zone,
    message_count integer default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.conversations enable row level security;

create policy "Service role full access on conversations"
on public.conversations for all to service_role
using (true) with check (true);

-- Création de la table conversation_messages pour stocker les messages individuels
create table if not exists public.conversation_messages (
    id uuid default gen_random_uuid() primary key,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.conversation_messages enable row level security;

create policy "Service role full access on conversation_messages"
on public.conversation_messages for all to service_role
using (true) with check (true);

-- Index pour accélérer les requêtes par conversation
create index if not exists idx_conversation_messages_conversation_id
on public.conversation_messages(conversation_id);

-- Index pour la recherche full-text dans les messages
create index if not exists idx_conversation_messages_content_search
on public.conversation_messages using gin(to_tsvector('french', content));

-- Fonction de recherche full-text dans l'historique
create or replace function search_conversations(
    search_query text,
    result_limit int default 20
)
returns table (
    message_id uuid,
    conversation_id uuid,
    conversation_title text,
    role text,
    content text,
    created_at timestamptz,
    rank real
)
language plpgsql
as $$
begin
    return query
    select
        cm.id as message_id,
        cm.conversation_id,
        c.title as conversation_title,
        cm.role,
        cm.content,
        cm.created_at,
        ts_rank(to_tsvector('french', cm.content), plainto_tsquery('french', search_query)) as rank
    from conversation_messages cm
    join conversations c on c.id = cm.conversation_id
    where to_tsvector('french', cm.content) @@ plainto_tsquery('french', search_query)
    order by rank desc, cm.created_at desc
    limit result_limit;
end;
$$;
