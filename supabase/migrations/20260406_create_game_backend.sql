create table if not exists public.user_profiles (
  id text primary key,
  display_name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.race_history (
  id text primary key,
  room_id text not null,
  winner_player_id text not null,
  total_players integer not null,
  total_laps integer not null,
  track_length_meters double precision not null,
  finished_at timestamptz not null default timezone('utc', now()),
  result_payload_json text
);

create table if not exists public.game_rooms (
  room_id text primary key,
  version bigint not null default 1,
  state_json jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_game_rooms_updated_at
  on public.game_rooms (updated_at desc);

create index if not exists idx_race_history_finished_at
  on public.race_history (finished_at desc);

alter table public.user_profiles enable row level security;
alter table public.race_history enable row level security;
alter table public.game_rooms enable row level security;
