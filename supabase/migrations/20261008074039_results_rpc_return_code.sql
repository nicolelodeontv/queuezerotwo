create or replace function public.publish_pickle_results_v2(
  p_live_code text,
  p_host_key text,
  p_results_code text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path to ''
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

  if p_payload is null then
    raise exception 'Payload is required.';
  end if;

  if octet_length(p_payload::text) > 200000 then
    raise exception 'Payload too large.';
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