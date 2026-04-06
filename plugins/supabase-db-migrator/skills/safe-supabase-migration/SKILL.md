---
name: safe-supabase-migration
description: Connect this repo to Supabase and migrate its PostgreSQL data with dump, restore, and verification.
---

# Safe Supabase Migration

Use this skill when the user wants to connect this project to Supabase or move the current PostgreSQL data into a Supabase project.

## Repo-specific context

- Backend path: `server/`
- Spring profile for Postgres: `db`
- Connection variables: `DB_URL` or `DB_HOST` + `DB_PORT` + `DB_NAME`, plus `DB_USER` and `DB_PASS`
- Current persisted application tables:
  - `public.user_profiles`
  - `public.race_history`

## Workflow

1. Use the plugin's Supabase MCP server for documentation lookup and safe project inspection.
2. Prefer `scripts/migrate-postgres-to-supabase.ps1` for actual data movement.
3. Ask the user to pause writes or stop the backend before the final migration if they want the cleanest no-drift cutover.
4. Restore into a fresh Supabase project or disposable branch first.
5. Verify the generated row-count report before claiming the migration is complete.
6. After verification, update the backend environment to use the Supabase connection string.
7. Remind the user to review extensions, roles, and RLS after import.

## Commands

Example migration command:

```powershell
.\plugins\supabase-db-migrator\scripts\migrate-postgres-to-supabase.ps1 `
  -SourceDbUrl "postgresql://postgres:postgres@localhost:5432/asphalt8" `
  -TargetDbUrl "postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" `
  -Tables "public.user_profiles","public.race_history"
```

## Safety rules

- Do not claim zero data loss if the source database was still accepting writes during the dump.
- Do not use Supabase MCP write access against production data unless the user explicitly asks for it.
- Prefer targeted verification over assumption: row counts first, then application smoke tests.
