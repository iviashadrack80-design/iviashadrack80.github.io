-- ShadrackTrades.com — Supabase database setup
-- Run this once in Supabase SQL Editor.

create table if not exists public.journal_trades (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

create table if not exists public.journal_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.journal_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.journal_trades enable row level security;
alter table public.journal_reviews enable row level security;
alter table public.journal_settings enable row level security;

create policy "Users manage their own trades" on public.journal_trades
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their own reviews" on public.journal_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their own settings" on public.journal_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists journal_trades_user_id_idx on public.journal_trades(user_id);
create index if not exists journal_reviews_user_id_idx on public.journal_reviews(user_id);
