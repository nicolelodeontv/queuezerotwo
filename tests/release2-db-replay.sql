\set ON_ERROR_STOP on

begin;

do $$
declare
  v_rls boolean;
  v_policies integer;
  v_secdef boolean;
begin
  select c.relrowsecurity
    into v_rls
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='pickle_results';

  if not v_rls then
    raise exception 'pickle_results RLS is not enabled';
  end if;

  select count(*)
    into v_policies
    from pg_policies
   where schemaname='public'
     and tablename='pickle_results'
     and cmd='SELECT';

  if v_policies <> 1 then
    raise exception 'expected exactly one SELECT policy, found %', v_policies;
  end if;

  select p.prosecdef
    into v_secdef
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname='publish_pickle_results';

  if not v_secdef then
    raise exception 'publish_pickle_results is not SECURITY DEFINER';
  end if;

  select p.prosecdef
    into v_secdef
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname='publish_pickle_results_v2';

  if not v_secdef then
    raise exception 'publish_pickle_results_v2 is not SECURITY DEFINER';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      cross join unnest(coalesce(p.proconfig, array[]::text[])) cfg
     where n.nspname='public'
       and p.proname='publish_pickle_results'
       and replace(cfg, '"', '') = 'search_path='
  ) then
    raise exception 'publish_pickle_results does not pin search_path to empty';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      cross join unnest(coalesce(p.proconfig, array[]::text[])) cfg
     where n.nspname='public'
       and p.proname='publish_pickle_results_v2'
       and replace(cfg, '"', '') = 'search_path='
  ) then
    raise exception 'publish_pickle_results_v2 does not pin search_path to empty';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
     where table_schema='public' and table_name='pickle_results'
       and grantee='anon' and privilege_type='SELECT'
  ) then raise exception 'anon SELECT grant missing'; end if;

  if not exists (
    select 1 from information_schema.role_table_grants
     where table_schema='public' and table_name='pickle_results'
       and grantee='authenticated' and privilege_type='SELECT'
  ) then raise exception 'authenticated SELECT grant missing'; end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema='public' and table_name='pickle_results'
       and grantee in ('anon','authenticated')
       and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then raise exception 'direct write grant exists on pickle_results'; end if;

  if not exists (
    select 1 from information_schema.routine_privileges
     where specific_schema='public' and routine_name='publish_pickle_results_v2'
       and grantee='anon' and privilege_type='EXECUTE'
  ) then raise exception 'anon EXECUTE grant missing for v2'; end if;

  if exists (
    select 1 from information_schema.routine_privileges
     where specific_schema='public' and routine_name='publish_pickle_results'
       and grantee='anon' and privilege_type='EXECUTE'
  ) then raise exception 'legacy publish_pickle_results must not be callable by anon'; end if;

  if exists (
    select 1 from information_schema.routine_privileges
     where specific_schema='public' and routine_name='publish_pickle_results_v2'
       and grantee='authenticated' and privilege_type='EXECUTE'
  ) then raise exception 'authenticated EXECUTE grant must not exist for v2'; end if;
end
$$;

do $$
declare v_msg text; v_count integer;
begin
  begin
    perform public.publish_pickle_results_v2(
      'R2DB001', repeat('b',64), 'R2BADKEY01',
      '{"v":1,"totals":{"players":0,"games":0},"leaderboard":[],"matches":[]}'::jsonb
    );
    raise exception 'wrong host key was accepted';
  exception when others then
    v_msg:=sqlerrm;
    if v_msg <> 'Invalid host key or expired session.' then
      raise exception 'wrong host key unexpected error: %',v_msg;
    end if;
  end;

  begin
    perform public.publish_pickle_results_v2(
      'R2DB001', null, 'R2BADKEY02',
      '{"v":1,"totals":{"players":0,"games":0},"leaderboard":[],"matches":[]}'::jsonb
    );
    raise exception 'null host key was accepted';
  exception when others then
    v_msg:=sqlerrm;
    if v_msg <> 'Invalid host key.' then
      raise exception 'null host key unexpected error: %',v_msg;
    end if;
  end;

  select count(*) into v_count
    from public.pickle_results where code in ('R2BADKEY01','R2BADKEY02');
  if v_count<>0 then raise exception 'bad-key calls wrote % rows',v_count; end if;
end
$$;

select public.publish_pickle_session(
  'R2DB001',
  repeat('a',64),
  '{"t":11,"courts":[],"nx":[],"q":["A","B","C","D"],"lb":[]}'::jsonb
);

select public.publish_pickle_session(
  'R2DB001',
  repeat('a',64),
  '{"t":11,"courts":[],"nx":[],"q":["A","B","C","D"],"lb":[],"up":[{"n":"A","p":1}],"tm":{"a":240000}}'::jsonb
);

do $payload_validation$
declare
  v_msg text;
  v_count integer;
begin
  begin
    perform public.publish_pickle_session(
      'R2BAD01', repeat('a',64), '[]'::jsonb
    );
    raise exception 'non-object session payload was accepted';
  exception when others then
    v_msg:=sqlerrm;
    if v_msg <> 'Payload must be a JSON object.' then
      raise exception 'non-object session payload unexpected error: %',v_msg;
    end if;
  end;

  begin
    perform public.publish_pickle_session(
      'R2BAD02', repeat('a',64),
      '{"t":11,"courts":[],"nx":[],"q":[5],"lb":[]}'::jsonb
    );
    raise exception 'non-string queue entry was accepted';
  exception when others then
    v_msg:=sqlerrm;
    if v_msg <> 'Invalid Live View payload values.' then
      raise exception 'invalid session item unexpected error: %',v_msg;
    end if;
  end;

  select count(*) into v_count
    from public.live_sessions
   where code in ('R2BAD01','R2BAD02');
  if v_count<>0 then
    raise exception 'invalid Live View payloads wrote % rows',v_count;
  end if;

  begin
    perform public.publish_pickle_results_v2(
      'R2DB001', repeat('a',64), 'R2BADRES01', '[]'::jsonb
    );
    raise exception 'non-object results payload was accepted';
  exception when others then
    v_msg:=sqlerrm;
    if v_msg <> 'Payload must be a JSON object.' then
      raise exception 'non-object results payload unexpected error: %',v_msg;
    end if;
  end;

  begin
    perform public.publish_pickle_results_v2(
      'R2DB001', repeat('a',64), 'R2BADRES02',
      '{"v":1,"totals":{"players":1,"games":1},"leaderboard":[],"matches":[{"c":"Court 1","p":["A","B","C","D"],"s":["<img>",9],"w":0}]}'::jsonb
    );
    raise exception 'non-numeric results score was accepted';
  exception when others then
    v_msg:=sqlerrm;
    if v_msg <> 'Invalid results match values.' then
      raise exception 'invalid results score unexpected error: %',v_msg;
    end if;
  end;

  select count(*) into v_count
    from public.pickle_results
   where live_code='R2DB001';
  if v_count<>0 then
    raise exception 'invalid archived-results payloads wrote % rows',v_count;
  end if;
end
$payload_validation$;

do $client_payload_contract$
declare
  v_payload jsonb;
  v_bytes integer;
begin
  -- Matches sdata(): null timing metadata, empty next-up arrays, idle courts
  -- with empty player arrays, plus unicode and pipe characters in names.
  perform public.publish_pickle_session(
    'R2SHAPE1', repeat('a',64),
    jsonb_build_object(
      't',11,'wb',2,
      'courts',jsonb_build_array(
        jsonb_build_object('n','Court 1','a',false,'p','[]'::jsonb,'s','[0,0]'::jsonb),
        jsonb_build_object('n','Court 2','a',false,'p','[]'::jsonb,'s','[0,0]'::jsonb),
        jsonb_build_object('n','Court 3','a',false,'p','[]'::jsonb,'s','[0,0]'::jsonb),
        jsonb_build_object('n','Court 4','a',false,'p','[]'::jsonb,'s','[0,0]'::jsonb)
      ),
      'nx','[]'::jsonb,'up','[]'::jsonb,'tm',null,
      'q',jsonb_build_array('Ari | 東京 🌱','Mika Café|星','Noah | 🥒','Zoë 北'),
      'lb','[]'::jsonb
    )
  );

  -- Build the upper supported client snapshot sizes to verify the 200 KB ceiling.
  perform public.publish_pickle_session(
    'R2BIG001', repeat('a',64),
    '{"t":11,"wb":2,"courts":[],"nx":[],"up":[],"tm":null,"q":[],"lb":[]}'::jsonb
  );

  with names as (
    select i, lpad(i::text,3,'0')||'|東京🌱' as n
      from generate_series(1,200) i
  ),
  leaderboard as (
    select jsonb_agg(jsonb_build_object('n',n,'w',25,'l',10,'d',150) order by i) as data
      from names
  ),
  matches as (
    select jsonb_agg(
      jsonb_build_object(
        'c','Court '||(((g-1)%8)+1),
        'p',jsonb_build_array(
          lpad((((g-1)*4+0)%200+1)::text,3,'0')||'|東京🌱',
          lpad((((g-1)*4+1)%200+1)::text,3,'0')||'|東京🌱',
          lpad((((g-1)*4+2)%200+1)::text,3,'0')||'|東京🌱',
          lpad((((g-1)*4+3)%200+1)::text,3,'0')||'|東京🌱'
        ),
        's',jsonb_build_array(11,9),'w',0,'tg',11,'t',1760000000000+g,'d',600000
      ) order by g
    ) as data
      from generate_series(1,500) g
  )
  select jsonb_build_object(
    'v',1,'name','Open play | 終','totals',jsonb_build_object(
      'players',200,'games',500,'courts',8,'playTo',11,'winBy',2
    ),
    'leaderboard',leaderboard.data,'matches',matches.data
  )
    into v_payload
    from leaderboard,matches;

  v_bytes:=octet_length(v_payload::text);
  if jsonb_array_length(v_payload->'leaderboard')<>200
     or jsonb_array_length(v_payload->'matches')<>500
     or v_bytes>=200000 then
    raise exception '200-player / 500-match result payload shape or size is invalid: % bytes',v_bytes;
  end if;

  perform public.publish_pickle_results_v2(
    'R2BIG001', repeat('a',64), 'R2BIGRES01', v_payload
  );

  if not exists (
    select 1 from public.pickle_results
     where live_code='R2BIG001' and code='R2BIGRES01'
  ) then
    raise exception 'full-size client results payload was not stored';
  end if;
end
$client_payload_contract$;

-- A completed early match publishes the manually selected winner through sdata().lb.
-- Both winner orientations must satisfy the real publish_pickle_session validator.
select public.publish_pickle_session(
  'R2WIN01',
  repeat('c',64),
  '{"t":11,"wb":2,"courts":[{"n":"Court 1","a":false,"p":[],"s":[0,0]}],"nx":[],"up":[],"tm":null,"q":["Gamma","Delta","Alpha","Beta"],"lb":[{"n":"Alpha","w":1,"l":0,"d":1},{"n":"Beta","w":1,"l":0,"d":1},{"n":"Gamma","w":0,"l":1,"d":-1},{"n":"Delta","w":0,"l":1,"d":-1}]}'::jsonb
);
select public.publish_pickle_session(
  'R2WIN02',
  repeat('d',64),
  '{"t":11,"wb":2,"courts":[{"n":"Court 1","a":false,"p":[],"s":[0,0]}],"nx":[],"up":[],"tm":null,"q":["Alpha","Beta","Gamma","Delta"],"lb":[{"n":"Gamma","w":1,"l":0,"d":1},{"n":"Delta","w":1,"l":0,"d":1},{"n":"Alpha","w":0,"l":1,"d":-1},{"n":"Beta","w":0,"l":1,"d":-1}]}'::jsonb
);
do $winner_live_payload$
begin
  if not exists (
    select 1 from public.live_sessions
     where code='R2WIN01'
       and data->'lb' @> '[{"n":"Alpha","w":1,"l":0,"d":1},{"n":"Beta","w":1,"l":0,"d":1}]'::jsonb
  ) then
    raise exception 'valid Team 1 early-finish Live View leaderboard did not pass the RPC guard';
  end if;
  if not exists (
    select 1 from public.live_sessions
     where code='R2WIN02'
       and data->'lb' @> '[{"n":"Gamma","w":1,"l":0,"d":1},{"n":"Delta","w":1,"l":0,"d":1}]'::jsonb
  ) then
    raise exception 'valid Team 2 early-finish Live View leaderboard did not pass the RPC guard';
  end if;
end
$winner_live_payload$;

select public.publish_pickle_results_v2(
  'R2DB001',
  repeat('a',64),
  'R2RES00001',
  '{"v":1,"session":"KEEP","totals":{"players":4,"games":1},"leaderboard":[{"n":"A","w":1,"l":0,"d":2}],"matches":[{"c":"Court 1","p":["A","B","C","D"],"s":[11,9],"w":0}]}'::jsonb
);

select public.publish_pickle_results_v2(
  'R2DB001',
  repeat('a',64),
  'R2DIFFER01',
  '{"v":1,"session":"MUST NOT REPLACE","totals":{"players":0,"games":0},"leaderboard":[],"matches":[]}'::jsonb
);

do $$
begin
  if (select data->>'session' from public.pickle_results where code='R2RES00001') <> 'KEEP' then
    raise exception 'results publish is not idempotent';
  end if;

  if coalesce((select (data->'totals'->>'players')::int from public.pickle_results where code='R2RES00001'),-1) <> 4 then
    raise exception 'stored result snapshot changed unexpectedly';
  end if;

  if not exists (
    select 1 from cron.job
     where jobname='queuezerotwo-results-expiry-cleanup'
       and active
  ) then
    raise exception 'results cleanup cron job is missing or inactive';
  end if;
end
$$;

select set_config('request.headers','{"x-picklestack-results-code":"R2RES00001"}',true);
set local role anon;
do $$
declare v_count integer;
begin
  select count(*) into v_count
    from public.pickle_results
   where code='R2RES00001';
  if v_count <> 1 then raise exception 'valid results code did not pass RLS'; end if;
end
$$;
reset role;

update public.pickle_results
   set expires_at=now()-interval '1 second'
 where code='R2RES00001';

set local role anon;
do $$
declare v_count integer;
begin
  select count(*) into v_count
    from public.pickle_results
   where code='R2RES00001';
  if v_count <> 0 then raise exception 'expired results code remained visible'; end if;
end
$$;
reset role;

do $$
declare v_bytes integer;
begin
  with names as (
    select 'Player'||g::text as n from generate_series(1,40) g
  ),
  lb as (
    select jsonb_agg(jsonb_build_object('n',n,'w',25,'l',10,'d',150)) as j from names
  ),
  ml as (
    select jsonb_agg(
      jsonb_build_object(
        'c','Court '||(((g-1)%8)+1),
        'p',jsonb_build_array(
          'Player'||(((g-1)%40)+1),
          'Player'||((g%40)+1),
          'Player'||(((g+1)%40)+1),
          'Player'||(((g+2)%40)+1)
        ),
        's',jsonb_build_array(11,9),
        'w',0,
        'tg',11,
        't',0,
        'd',600000
      )
    ) as j
    from generate_series(1,100) g
  )
  select octet_length(jsonb_build_object(
    'v',1,
    'session','40 player / 100 match replay',
    'totals',jsonb_build_object('players',40,'games',100),
    'leaderboard',lb.j,
    'matches',ml.j
  )::text)
    into v_bytes
    from lb,ml;

  if v_bytes >= 200000 then
    raise exception 'representative large results payload is % bytes',v_bytes;
  end if;
end
$$;

insert into public.pickle_results(live_code,code,data,created_at,expires_at)
values
  ('CLEANUP001','CLNEXPIRE1','{"v":1}'::jsonb,now(),now()-interval '1 day'),
  ('CLEANUP002','CLNKEEP001','{"v":1}'::jsonb,now(),now()+interval '29 days');

-- Keep the RLS-expiry fixture visible to cleanup; only the explicit expired test row
-- should be removed by the scheduled job's configured command.
update public.pickle_results
   set expires_at=now()+interval '1 day'
 where code='R2RES00001';

do $$
declare
  v_command text;
  v_rows integer;
begin
  select command into v_command
    from cron.job
   where jobname='queuezerotwo-results-expiry-cleanup'
     and active;

  if v_command is null then
    raise exception 'results cleanup cron job is missing or inactive';
  end if;

  if regexp_replace(lower(v_command), '[[:space:]]', '', 'g')
       <> 'deletefrompublic.pickle_resultswhereexpires_at<=now()' then
    raise exception 'unexpected results cleanup command: %', v_command;
  end if;

  execute v_command;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'scheduled cleanup command removed % rows; expected 1', v_rows;
  end if;
end
$$;

do $$
begin
  if exists(select 1 from public.pickle_results where code='CLNEXPIRE1') then
    raise exception 'expired result row was not deleted by the cleanup job command';
  end if;
  if not exists(select 1 from public.pickle_results where code='CLNKEEP001') then
    raise exception 'unexpired result row was deleted';
  end if;
end
$$;

select 'release2-db-replay-ok' as status;

rollback;
