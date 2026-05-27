alter table public.room_participants
  add column if not exists timeout_answers integer not null default 0,
  add column if not exists score integer not null default 0,
  add column if not exists connection_status text not null default 'CONNECTED',
  add column if not exists last_seen_at timestamptz,
  add column if not exists player_session_id text;

alter table public.classroom_rooms
  add column if not exists target_score integer not null default 500;

create unique index if not exists room_participants_room_player_session_idx
  on public.room_participants (room_id, player_session_id)
  where player_session_id is not null;
