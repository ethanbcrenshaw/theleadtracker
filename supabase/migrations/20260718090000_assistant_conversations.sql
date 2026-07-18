-- Assistant page redesign: chat history becomes multiple conversations.
-- Each message row carries a conversation_id (text uuid, client-generated).
-- Old rows keep NULL and are shown as one "earlier conversation" thread.
alter table public.assistant_messages
  add column if not exists conversation_id text;

create index if not exists assistant_messages_conversation_idx
  on public.assistant_messages (conversation_id, created_at);
