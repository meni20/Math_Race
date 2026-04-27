create table if not exists public.game_room_presence (
  room_id text not null,
  player_id text not null,
  session_id text not null,
  last_seen_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (room_id, player_id)
);

create index if not exists idx_game_room_presence_updated_at
  on public.game_room_presence (updated_at desc);

alter table public.game_room_presence enable row level security;
