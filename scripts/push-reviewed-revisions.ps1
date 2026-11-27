param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$revisionRoot = Split-Path -Parent $PSScriptRoot
$revisionProject = 'uvxpjrzqtmaterczzvjo'
$approvedMigrations = @(
    '20261126090000_remittance_numeric_quantity_compatibility.sql',
    '20261127024853_egg_preparation_stock_mapping.sql'
)
$revisionCli = Join-Path $revisionRoot 'node_modules/supabase/dist/supabase.js'
if (-not (Test-Path -LiteralPath $revisionCli)) { throw 'Install project dependencies before pushing migrations.' }

Push-Location -LiteralPath $revisionRoot
try {
    # Verify the pending list on every run; never include older unrelated files.
    $preview = @(& node $revisionCli db push --project-ref $revisionProject --dry-run --skip-vault)
    if ($LASTEXITCODE -ne 0) { throw 'Migration preview failed. Nothing was pushed.' }
    $preview | ForEach-Object { Write-Host $_ }
    $summaryLine = $preview | Where-Object { $_ -match '^\{.*"migrations".*\}$' } | Select-Object -Last 1
    if (-not $summaryLine) { throw 'Could not verify the pending migration list. Nothing was pushed.' }
    $summary = $summaryLine | ConvertFrom-Json
    $pending = @($summary.migrations)
    if (@($summary.seeds).Count -gt 0 -or @($summary.roles).Count -gt 0) {
        throw 'Unexpected seed or role changes. Nothing was pushed.'
    }
    if ($pending.Count -eq 0) {
        Write-Host 'No pending migrations. The database is already up to date.'
        return
    }
    if (@($pending | Where-Object { $_ -notin $approvedMigrations }).Count -gt 0) {
        throw "Unexpected migrations: $($pending -join ', '). Nothing was pushed."
    }
    if ($DryRun) {
        Write-Host 'Verified: only the reviewed remittance and egg migrations would be pushed.'
        return
    }
    # Keep the CLI confirmation visible. Do not use --include-all or --yes.
    & node $revisionCli db push --project-ref $revisionProject --skip-vault
    if ($LASTEXITCODE -ne 0) { throw 'Migration push did not finish successfully. Review the CLI output.' }
} finally {
    Pop-Location
}
