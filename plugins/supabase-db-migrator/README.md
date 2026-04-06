# Supabase DB Migrator

This local Codex plugin connects Codex to the hosted Supabase MCP server and adds a safe Postgres-to-Supabase migration script for this repo.

## What it bundles

- Read-only Supabase MCP access through `.mcp.json`
- A repo-aware migration skill in `skills/safe-supabase-migration/SKILL.md`
- A PowerShell migration script in `scripts/migrate-postgres-to-supabase.ps1`

## Repo-specific context

The backend already uses PostgreSQL. Based on the current Spring entities, the persisted application tables are:

- `public.user_profiles`
- `public.race_history`

Because the source database is already Postgres, moving to Supabase does not require a database engine conversion. The safest path is dump, restore, and verify.

## Prerequisites

- PostgreSQL client tools installed and on `PATH`: `pg_dump`, `pg_restore`, `psql`
- A Supabase project and connection string
- A maintenance window or paused writes for the final cutover if you need a no-drift migration

## Example

```powershell
.\plugins\supabase-db-migrator\scripts\migrate-postgres-to-supabase.ps1 `
  -SourceDbUrl "postgresql://postgres:postgres@localhost:5432/asphalt8" `
  -TargetDbUrl "postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" `
  -Tables "public.user_profiles","public.race_history"
```

The script writes a timestamped dump and JSON verification report under `%TEMP%\supabase-db-migrator\`.

## Notes

- The MCP server is read-only by default on purpose. Use the migration script for bulk data movement.
- For a single-project setup, update `.mcp.json` to append `project_ref=<your-project-ref>` to the Supabase MCP URL.
- Supabase platform objects such as roles, managed schemas, and RLS state still need review after restore.
