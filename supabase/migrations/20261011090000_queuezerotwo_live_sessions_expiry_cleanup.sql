-- QueueZeroTwo: periodically remove sessions past their existing seven-day expiry.
-- This migration schedules the cleanup; the first delete occurs on the next run
-- after the backup is verified and this migration is applied.
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'queuezerotwo-live-sessions-expiry-cleanup'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'queuezerotwo-live-sessions-expiry-cleanup',
    '45 * * * *',
    'delete from public.live_sessions where expires_at <= now()'
  );
end $$;
