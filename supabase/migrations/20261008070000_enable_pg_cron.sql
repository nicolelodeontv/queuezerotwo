-- Results cleanup uses cron.schedule in the following migration.
-- Keep this prerequisite in the checked-in chain so a fresh replay is self-contained.
create extension if not exists pg_cron with schema pg_catalog;
