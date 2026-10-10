-- QueueZeroTwo Release 2 results snapshots.
create table public.pickle_results (
  code text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  constraint pickle_results_code_check
    check (code ~ '^[A-Za-z0-9]{10}$'),
  constraint pickle_results_payload_size_check
    check (octet_length(data::text) <= 200000)
);

alter table public.pickle_results enable row level security;

revoke all on table public.pickle_results from public;
revoke all on table public.pickle_results from anon;
revoke all on table public.pickle_results from authenticated;
grant select on table public.pickle_results to anon, authenticated;

drop policy if exists "PickleStack results exact-code read" on public.pickle_results;
create policy "PickleStack results exact-code read"
on public.pickle_results
for select
to anon, authenticated
using (
  code = coalesce(
    (current_setting('request.headers', true))::jsonb ->> 'x-picklestack-results-code',
    ''
  )
  and expires_at > now()
);

create or replace function public.publish_pickle_results(
  p_live_code text,
  p_host_key text,
  p_results_code text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_host_key_hash text;
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
    code,
    data,
    created_at,
    expires_at
  )
  values (
    p_results_code,
    p_payload,
    now(),
    now() + interval '30 days'
  )
  on conflict (code) do nothing;

  return true;
end;
$function$;

revoke all on function public.publish_pickle_results(text, text, text, jsonb) from public;
revoke execute on function public.publish_pickle_results(text, text, text, jsonb) from authenticated;
grant execute on function public.publish_pickle_results(text, text, text, jsonb) to anon;

select cron.schedule(
  'queuezerotwo-results-expiry-cleanup',
  '15 * * * *',
  $$delete from public.pickle_results where expires_at <= now()$$
);