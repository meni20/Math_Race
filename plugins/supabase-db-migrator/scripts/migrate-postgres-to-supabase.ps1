[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDbUrl,

    [Parameter(Mandatory = $true)]
    [string]$TargetDbUrl,

    [string[]]$Tables = @(),

    [string]$ArtifactRoot = (Join-Path $env:TEMP "supabase-db-migrator"),

    [switch]$DropExistingObjects,

    [switch]$SkipRestore,

    [switch]$SkipVerify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[supabase-db-migrator] $Message"
}

function Resolve-CommandPath {
    param([string]$Name)

    $resolved = Get-Command $Name -ErrorAction SilentlyContinue
    if ($resolved) {
        return $resolved.Source
    }

    $executableName = if ($Name.EndsWith(".exe")) { $Name } else { "$Name.exe" }
    $candidateDirectories = @(
        (Join-Path ${env:ProgramFiles} "PostgreSQL"),
        (Join-Path ${env:ProgramFiles(x86)} "PostgreSQL")
    ) | Where-Object { $_ -and (Test-Path $_) }

    $matches = foreach ($directory in $candidateDirectories) {
        Get-ChildItem -Path $directory -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object {
                $candidate = Join-Path $_.FullName "bin\$executableName"
                if (Test-Path $candidate) {
                    $candidate
                }
            }
    }

    if ($matches) {
        return $matches[0]
    }

    throw "Required command '$Name' was not found on PATH or in the standard PostgreSQL install directories."
}

function Invoke-Checked {
    param(
        [string]$Executable,
        [string[]]$Arguments,
        [string]$Label
    )

    Write-Step $Label
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

function ConvertTo-QualifiedTable {
    param([string]$TableName)

    if ([string]::IsNullOrWhiteSpace($TableName)) {
        throw "Table names must not be empty."
    }

    $parts = $TableName.Split(".", 2, [System.StringSplitOptions]::RemoveEmptyEntries)
    if ($parts.Count -eq 1) {
        return [PSCustomObject]@{
            Schema = "public"
            Table = $parts[0].Trim()
        }
    }

    return [PSCustomObject]@{
        Schema = $parts[0].Trim()
        Table = $parts[1].Trim()
    }
}

function ConvertTo-SqlLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Build-CountQuery {
    param([object[]]$QualifiedTables)

    if ($QualifiedTables.Count -gt 0) {
        $tableRows = foreach ($table in $QualifiedTables) {
            "SELECT {0} AS table_schema, {1} AS table_name" -f (ConvertTo-SqlLiteral $table.Schema), (ConvertTo-SqlLiteral $table.Table)
        }

        $candidateTables = [string]::Join(" UNION ALL ", $tableRows)
    }
    else {
        $candidateTables = @"
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN (
    'pg_catalog',
    'information_schema',
    'pg_toast',
    'auth',
    'extensions',
    'graphql',
    'graphql_public',
    'pgbouncer',
    'realtime',
    'storage',
    'supabase_functions',
    'supabase_migrations',
    'vault'
  )
  AND table_schema NOT LIKE 'pg_temp_%'
  AND table_schema NOT LIKE 'pg_toast_temp_%'
"@
    }

    return @"
WITH candidate_tables AS (
  $candidateTables
),
visible_tables AS (
  SELECT ct.table_schema, ct.table_name
  FROM candidate_tables ct
  JOIN information_schema.tables t
    ON t.table_schema = ct.table_schema
   AND t.table_name = ct.table_name
   AND t.table_type = 'BASE TABLE'
),
counts AS (
  SELECT
    table_schema,
    table_name,
    COALESCE(
      (xpath('/row/count/text()', query_to_xml(format('SELECT count(*) AS count FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint,
      0
    ) AS row_count
  FROM visible_tables
)
SELECT COALESCE(
  json_agg(
    json_build_object(
      'schema', table_schema,
      'table', table_name,
      'row_count', row_count
    )
    ORDER BY table_schema, table_name
  ),
  '[]'::json
)
FROM counts;
"@
}

function Get-TableCounts {
    param(
        [string]$DbUrl,
        [object[]]$QualifiedTables,
        [string]$PsqlExecutable
    )

    $sql = Build-CountQuery -QualifiedTables $QualifiedTables
    $result = & $PsqlExecutable "--dbname=$DbUrl" "--tuples-only" "--no-align" "--quiet" "--command=$sql"
    if ($LASTEXITCODE -ne 0) {
        throw "Row-count verification query failed."
    }

    $payload = ($result -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($payload)) {
        return @()
    }

    $parsed = $payload | ConvertFrom-Json
    if ($parsed -is [System.Array]) {
        return $parsed
    }

    return @($parsed)
}

function ConvertTo-CountMap {
    param([object[]]$Counts)

    $map = @{}
    foreach ($entry in $Counts) {
        $key = "$($entry.schema).$($entry.table)"
        $map[$key] = [long]$entry.row_count
    }

    return $map
}

function Save-Json {
    param(
        [string]$Path,
        [object]$Value
    )

    $Value | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $Path
}

$pgDump = Resolve-CommandPath "pg_dump"
$pgRestore = Resolve-CommandPath "pg_restore"
$psql = Resolve-CommandPath "psql"

$qualifiedTables = @()
foreach ($table in $Tables) {
    $qualifiedTables += ConvertTo-QualifiedTable -TableName $table
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifactDirectory = Join-Path $ArtifactRoot $timestamp
$dumpPath = Join-Path $artifactDirectory "source.dump"
$sourceCountsPath = Join-Path $artifactDirectory "source-counts.json"
$targetCountsPath = Join-Path $artifactDirectory "target-counts.json"
$reportPath = Join-Path $artifactDirectory "migration-report.json"

New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null

$sourceCounts = Get-TableCounts -DbUrl $SourceDbUrl -QualifiedTables $qualifiedTables -PsqlExecutable $psql
Save-Json -Path $sourceCountsPath -Value $sourceCounts

$dumpArguments = @(
    "--dbname=$SourceDbUrl",
    "--format=custom",
    "--file=$dumpPath",
    "--no-owner",
    "--no-privileges",
    "--no-subscriptions",
    "--verbose"
)

foreach ($table in $Tables) {
    $dumpArguments += "--table=$table"
}

Invoke-Checked -Executable $pgDump -Arguments $dumpArguments -Label "Creating source dump"

if (-not $SkipRestore) {
    $restoreArguments = @(
        "--dbname=$TargetDbUrl",
        "--no-owner",
        "--no-privileges",
        "--single-transaction",
        "--exit-on-error",
        "--verbose",
        $dumpPath
    )

    if ($DropExistingObjects) {
        $restoreArguments = @(
            "--dbname=$TargetDbUrl",
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
            "--single-transaction",
            "--exit-on-error",
            "--verbose",
            $dumpPath
        )
    }

    Invoke-Checked -Executable $pgRestore -Arguments $restoreArguments -Label "Restoring dump into Supabase"
}

$verificationStatus = "skipped"
$mismatches = @()
$targetCounts = @()

if (-not $SkipVerify) {
    $targetCounts = Get-TableCounts -DbUrl $TargetDbUrl -QualifiedTables $qualifiedTables -PsqlExecutable $psql
    Save-Json -Path $targetCountsPath -Value $targetCounts

    $sourceMap = ConvertTo-CountMap -Counts $sourceCounts
    $targetMap = ConvertTo-CountMap -Counts $targetCounts
    $allKeys = @($sourceMap.Keys + $targetMap.Keys | Sort-Object -Unique)

    foreach ($key in $allKeys) {
        $sourceValue = $null
        $targetValue = $null

        if ($sourceMap.ContainsKey($key)) {
            $sourceValue = $sourceMap[$key]
        }

        if ($targetMap.ContainsKey($key)) {
            $targetValue = $targetMap[$key]
        }

        if ($sourceValue -ne $targetValue) {
            $mismatches += [PSCustomObject]@{
                table = $key
                source_row_count = $sourceValue
                target_row_count = $targetValue
            }
        }
    }

    if ($mismatches.Count -eq 0) {
        $verificationStatus = "passed"
        Write-Step "Row-count verification passed."
    }
    else {
        $verificationStatus = "failed"
    }
}

$report = [PSCustomObject]@{
    generated_at = (Get-Date).ToString("o")
    dump_path = $dumpPath
    source_counts_path = $sourceCountsPath
    target_counts_path = $(if ($SkipVerify) { $null } else { $targetCountsPath })
    verification_status = $verificationStatus
    verified_tables = @($sourceCounts | ForEach-Object { "$($_.schema).$($_.table)" })
    mismatches = $mismatches
}

Save-Json -Path $reportPath -Value $report
Write-Step "Migration report written to $reportPath"

if ($verificationStatus -eq "failed") {
    throw "Row-count verification failed. Review $reportPath before switching the application to Supabase."
}
