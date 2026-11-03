-- Prevent delayed Live View retries from replacing a newer sequenced snapshot.
--
-- Compatibility contract:
--   * Legacy payloads without seq may continue updating legacy rows that have no
--     numeric seq yet.
--   * The first valid sequenced payload upgrades a legacy row.
--   * Once a numeric seq exists, unsequenced legacy writes are successful no-ops.
--   * Sequenced updates replace the row only when incoming seq >= stored seq.
--     Equal-sequence retries remain idempotently successful.
--
-- PostgreSQL's ON CONFLICT row lock makes the comparison atomic against the
-- current conflicting row, including when concurrent writers arrive out of order.

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
  v_incoming_seq numeric := null;
  v_rows bigint := 0;
  v_owned_active boolean := false;
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

  if p_payload ? 'seq' then
    if jsonb_typeof(p_payload->'seq') is distinct from 'number' then
      raise exception 'Invalid Live View sequence.';
    end if;

    v_incoming_seq := (p_payload->>'seq')::numeric;
    if v_incoming_seq < 0
       or trunc(v_incoming_seq) <> v_incoming_seq
       or v_incoming_seq > 9007199254740991::numeric then
      raise exception 'Invalid Live View sequence.';
    end if;
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
    and public.live_sessions.expires_at > now()
    and (
      (
        v_incoming_seq is null
        and jsonb_typeof(public.live_sessions.data->'seq') is distinct from 'number'
      )
      or
      (
        v_incoming_seq is not null
        and (
          jsonb_typeof(public.live_sessions.data->'seq') is distinct from 'number'
          or v_incoming_seq >= (public.live_sessions.data->>'seq')::numeric
        )
      )
    );

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- A valid owner may retry a stale or legacy payload. Report success so the
    -- client drops that obsolete queue item; do not emit a database update or
    -- Broadcast. Invalid keys and expired sessions must still fail as before.
    select exists (
      select 1
        from public.live_sessions
       where code = p_code
         and host_key = v_host_key_hash
         and expires_at > now()
    )
    into v_owned_active;

    if v_owned_active then
      return true;
    end if;

    raise exception 'Invalid host key or expired session.';
  end if;

  return true;
end;
$function$;

revoke execute on function public.publish_pickle_session(text, text, jsonb) from public;
revoke execute on function public.publish_pickle_session(text, text, jsonb) from authenticated;
grant execute on function public.publish_pickle_session(text, text, jsonb) to anon;
