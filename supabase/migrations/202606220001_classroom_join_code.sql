create or replace function public.classroom_join_code(room_code text)
returns text
language plpgsql
immutable
strict
as $$
declare
  normalized text := upper(trim(room_code));
  hash_value numeric := 0;
  character_index integer;
begin
  for character_index in 1..char_length(normalized) loop
    hash_value := mod((hash_value * 31) + ascii(substr(normalized, character_index, 1)), 4294967296);
  end loop;
  return (mod(hash_value, 900000) + 100000)::bigint::text;
end;
$$;

alter table public.classroom_rooms
  add column if not exists join_code text;

update public.classroom_rooms
set join_code = public.classroom_join_code(room_code)
where join_code is null or join_code = '';

alter table public.classroom_rooms
  alter column join_code set not null;

create unique index if not exists classroom_rooms_join_code_key
  on public.classroom_rooms (join_code);
