create table if not exists public.math_race_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_normalized text not null unique,
  password_hash text not null,
  role text not null check (role in ('teacher', 'student', 'admin')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_login_at timestamptz
);

create table if not exists public.math_race_user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.math_race_users(id) on delete cascade,
  session_token_hash text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists math_race_users_role_idx
  on public.math_race_users (role);

create index if not exists math_race_user_sessions_user_idx
  on public.math_race_user_sessions (user_id, expires_at desc);

create index if not exists math_race_user_sessions_active_idx
  on public.math_race_user_sessions (expires_at)
  where revoked_at is null;

alter table public.math_race_users enable row level security;
alter table public.math_race_user_sessions enable row level security;
