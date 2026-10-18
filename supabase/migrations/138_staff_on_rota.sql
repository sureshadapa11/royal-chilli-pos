-- 138: a per-person "Show on rota" switch (attendance app → Employees →
-- Usual rota). Off = left off the Rota grid and "Fill from defaults", e.g. a
-- manager who isn't scheduled. Everyone starts on, so nothing changes until
-- someone is unticked. Role still decides first: HR and Supervisor are never
-- on the rota (attendance lib/roles.ts).
-- Run BEFORE merging (done 2026-10-19). Safe to re-run.
alter table staff add column if not exists on_rota boolean not null default true;
