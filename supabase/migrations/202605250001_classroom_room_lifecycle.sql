create table if not exists public.classroom_rooms (
  id uuid primary key default gen_random_uuid(),
  teacher_id text,
  room_code text unique not null,
  race_name text not null,
  class_name text,
  status text not null default 'WAITING'
    check (status in ('DRAFT', 'CREATED', 'WAITING', 'RACING', 'FINISHED', 'CLOSED', 'DELETED')),
  max_players integer not null default 8 check (max_players between 1 and 8),
  current_players integer not null default 0 check (current_players >= 0),
  race_duration_sec integer not null default 180 check (race_duration_sec > 0),
  question_time_limit_sec integer not null default 8 check (question_time_limit_sec > 0),
  difficulty text,
  question_type jsonb,
  map_id text,
  requires_approval boolean not null default false,
  is_locked boolean not null default false,
  is_listed boolean not null default true,
  allow_mid_game_join boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  closed_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.room_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.classroom_rooms(id) on delete cascade,
  player_id text not null,
  display_name text not null,
  car_id text,
  car_name text,
  status text not null default 'JOINED'
    check (status in ('JOINED', 'WAITING_APPROVAL', 'APPROVED', 'READY', 'RACING', 'FINISHED', 'DISCONNECTED', 'KICKED')),
  progress_percent numeric not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  rank integer,
  correct_answers integer not null default 0,
  wrong_answers integer not null default 0,
  streak integer not null default 0,
  average_answer_time_ms integer,
  joined_at timestamptz not null default now(),
  approved_at timestamptz,
  ready_at timestamptz,
  finished_at timestamptz,
  kicked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (room_id, player_id)
);

create table if not exists public.room_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.classroom_rooms(id) on delete cascade,
  participant_id uuid references public.room_participants(id) on delete set null,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.race_results (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.classroom_rooms(id) on delete cascade,
  participant_id uuid not null references public.room_participants(id) on delete cascade,
  final_rank integer,
  final_progress_percent numeric,
  correct_answers integer not null default 0,
  wrong_answers integer not null default 0,
  average_answer_time_ms integer,
  created_at timestamptz not null default now(),
  unique (room_id, participant_id)
);

create index if not exists classroom_rooms_teacher_status_created_idx
  on public.classroom_rooms (teacher_id, status, created_at desc);

create index if not exists classroom_rooms_joinable_idx
  on public.classroom_rooms (status, is_listed, is_locked, deleted_at, closed_at, ended_at);

create index if not exists room_participants_room_status_idx
  on public.room_participants (room_id, status);

create index if not exists room_events_room_created_idx
  on public.room_events (room_id, created_at desc);

alter table public.classroom_rooms enable row level security;
alter table public.room_participants enable row level security;
alter table public.room_events enable row level security;
alter table public.race_results enable row level security;
