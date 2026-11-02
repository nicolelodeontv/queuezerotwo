-- Reject malformed Live View and archived-results payloads before they can be stored.
-- The browser still escapes/coerces values at render time as defense in depth.

create or replace function public.publish_pickle_session(
  p_code text,
  p_host_key text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_host_key_hash text;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{4,10}$' then
    raise exception 'Invalid session code.';
  end if;

  if p_host_key is null or p_host_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid host key.';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Payload must be a JSON object.';
  end if;

  if octet_length(p_payload::text) > 200000 then
    raise exception 'Payload too large.';
  end if;

  if jsonb_typeof(p_payload->'t') is distinct from 'number'
     or jsonb_typeof(p_payload->'courts') is distinct from 'array'
     or jsonb_typeof(p_payload->'q') is distinct from 'array'
     or jsonb_typeof(p_payload->'nx') is distinct from 'array'
     or jsonb_typeof(p_payload->'lb') is distinct from 'array' then
    raise exception 'Invalid Live View payload shape.';
  end if;

  if p_payload ? 'wb' and jsonb_typeof(p_payload->'wb') is distinct from 'number' then
    raise exception 'Invalid Live View payload shape.';
  end if;

  if p_payload ? 'up' and jsonb_typeof(p_payload->'up') is distinct from 'array' then
    raise exception 'Invalid Live View payload shape.';
  end if;

  if p_payload ? 'tm'
     and p_payload->'tm' <> 'null'::jsonb
     and jsonb_typeof(p_payload->'tm') is distinct from 'object' then
    raise exception 'Invalid Live View payload shape.';
  end if;

  if jsonb_typeof(p_payload->'tm') = 'object'
     and p_payload->'tm' ? 'a'
     and jsonb_typeof(p_payload->'tm'->'a') is distinct from 'number' then
    raise exception 'Invalid Live View payload shape.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload->'courts') as court(value)
     where jsonb_typeof(court.value) is distinct from 'object'
        or jsonb_typeof(court.value->'n') is distinct from 'string'
        or jsonb_typeof(court.value->'a') is distinct from 'boolean'
        or jsonb_typeof(court.value->'p') is distinct from 'array'
        or jsonb_typeof(court.value->'s') is distinct from 'array'
  ) then
    raise exception 'Invalid Live View payload shape.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload->'courts') as court(value)
      cross join lateral jsonb_array_elements(court.value->'p') as player(value)
     where jsonb_typeof(player.value) is distinct from 'string'
  ) or exists (
    select 1
      from jsonb_array_elements(p_payload->'courts') as court(value)
      cross join lateral jsonb_array_elements(court.value->'s') as score(value)
     where jsonb_typeof(score.value) is distinct from 'number'
  ) then
    raise exception 'Invalid Live View payload values.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload->'q') as player(value)
     where jsonb_typeof(player.value) is distinct from 'string'
  ) or exists (
    select 1
      from jsonb_array_elements(p_payload->'nx') as player(value)
     where jsonb_typeof(player.value) is distinct from 'string'
  ) then
    raise exception 'Invalid Live View payload values.';
  end if;

  if p_payload ? 'up' and exists (
    select 1
      from jsonb_array_elements(p_payload->'up') as next_player(value)
     where jsonb_typeof(next_player.value) is distinct from 'object'
        or jsonb_typeof(next_player.value->'n') is distinct from 'string'
        or jsonb_typeof(next_player.value->'p') is distinct from 'number'
  ) then
    raise exception 'Invalid Live View payload shape.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload->'lb') as player(value)
     where jsonb_typeof(player.value) is distinct from 'object'
        or jsonb_typeof(player.value->'n') is distinct from 'string'
        or jsonb_typeof(player.value->'w') is distinct from 'number'
        or jsonb_typeof(player.value->'l') is distinct from 'number'
        or jsonb_typeof(player.value->'d') is distinct from 'number'
  ) then
    raise exception 'Invalid Live View leaderboard.';
  end if;

  v_host_key_hash := encode(
    extensions.digest(p_host_key, 'sha256'),
    'hex'
  );

  insert into public.live_sessions (
    code,
    host_key,
    data,
    updated_at,
    expires_at
  )
  values (
    p_code,
    v_host_key_hash,
    p_payload,
    now(),
    now() + interval '7 days'
  )
  on conflict (code) do update
  set
    data = excluded.data,
    updated_at = excluded.updated_at,
    expires_at = excluded.expires_at
  where public.live_sessions.host_key = excluded.host_key
    and public.live_sessions.expires_at > now();

  if not found then
    raise exception 'Invalid host key or expired session.';
  end if;

  return true;
end;
$function$;

revoke execute on function public.publish_pickle_session(text, text, jsonb) from public;
revoke execute on function public.publish_pickle_session(text, text, jsonb) from authenticated;
grant execute on function public.publish_pickle_session(text, text, jsonb) to anon;


create or replace function public.publish_pickle_results_v2(
  p_live_code text,
  p_host_key text,
  p_results_code text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_host_key_hash text;
  v_existing_code text;
begin
  if p_live_code is null or p_live_code !~ '^[A-Za-z0-9]{4,10}$' then
    raise exception 'Invalid session code.';
  end if;

  if p_host_key is null or p_host_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid host key.';
  end if;

  if p_results_code is null or p_results_code !~ '^[A-Za-z0-9]{10}$' then
    raise exception 'Invalid results code.';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Payload must be a JSON object.';
  end if;

  if octet_length(p_payload::text) > 200000 then
    raise exception 'Payload too large.';
  end if;

  if jsonb_typeof(p_payload->'v') is distinct from 'number'
     or jsonb_typeof(p_payload->'totals') is distinct from 'object'
     or jsonb_typeof(p_payload->'leaderboard') is distinct from 'array'
     or jsonb_typeof(p_payload->'matches') is distinct from 'array' then
    raise exception 'Invalid results payload shape.';
  end if;

  if p_payload ? 'name' and jsonb_typeof(p_payload->'name') is distinct from 'string' then
    raise exception 'Invalid results payload shape.';
  end if;

  if exists (
    select 1
      from jsonb_each(p_payload->'totals') as total(key, value)
     where total.key in ('players','games','courts','playTo','winBy')
       and jsonb_typeof(total.value) is distinct from 'number'
  ) then
    raise exception 'Invalid results totals.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload->'leaderboard') as player(value)
     where jsonb_typeof(player.value) is distinct from 'object'
        or jsonb_typeof(player.value->'n') is distinct from 'string'
        or jsonb_typeof(player.value->'w') is distinct from 'number'
        or jsonb_typeof(player.value->'l') is distinct from 'number'
        or jsonb_typeof(player.value->'d') is distinct from 'number'
  ) then
    raise exception 'Invalid results leaderboard.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload->'matches') as match(value)
     where jsonb_typeof(match.value) is distinct from 'object'
        or jsonb_typeof(match.value->'c') is distinct from 'string'
        or jsonb_typeof(match.value->'p') is distinct from 'array'
        or jsonb_typeof(match.value->'s') is distinct from 'array'
        or jsonb_typeof(match.value->'w') is distinct from 'number'
        or (match.value ? 'tg' and jsonb_typeof(match.value->'tg') is distinct from 'number')
        or (match.value ? 't' and jsonb_typeof(match.value->'t') is distinct from 'number')
        or (match.value ? 'd' and jsonb_typeof(match.value->'d') is distinct from 'number')
  ) then
    raise exception 'Invalid results match shape.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_payload->'matches') as match(value)
      cross join lateral jsonb_array_elements(match.value->'p') as player(value)
     where jsonb_typeof(player.value) is distinct from 'string'
  ) or exists (
    select 1
      from jsonb_array_elements(p_payload->'matches') as match(value)
      cross join lateral jsonb_array_elements(match.value->'s') as score(value)
     where jsonb_typeof(score.value) is distinct from 'number'
  ) then
    raise exception 'Invalid results match values.';
  end if;

  v_host_key_hash := encode(
    extensions.digest(p_host_key, 'sha256'),
    'hex'
  );

  if not exists (
    select 1
      from public.live_sessions
     where code = p_live_code
       and host_key = v_host_key_hash
       and expires_at > now()
  ) then
    raise exception 'Invalid host key or expired session.';
  end if;

  insert into public.pickle_results (
    live_code,
    code,
    data,
    created_at,
    expires_at
  )
  values (
    p_live_code,
    p_results_code,
    p_payload,
    now(),
    now() + interval '30 days'
  )
  on conflict (live_code) do nothing;

  select code
    into v_existing_code
    from public.pickle_results
   where live_code = p_live_code;

  if v_existing_code is null then
    raise exception 'Unable to publish results.';
  end if;

  return v_existing_code;
end;
$function$;

revoke all on function public.publish_pickle_results_v2(text,text,text,jsonb) from public;
revoke execute on function public.publish_pickle_results_v2(text,text,text,jsonb) from authenticated;
grant execute on function public.publish_pickle_results_v2(text,text,text,jsonb) to anon;

revoke execute on function public.publish_pickle_results(text,text,text,jsonb) from anon, authenticated;
