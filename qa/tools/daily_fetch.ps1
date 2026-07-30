# Chem-QA user reports: daily fetch wrapper (ASCII only, for Windows PowerShell 5.1).
# Runs fetch_reports.py; if there are new reports, appends them (with a timestamp) to reports_inbox.md.
# Appends nothing when there is no new report. Seen-state is tracked by fetch_reports.py (no duplicates).
# Scheduled via: powershell -NoProfile -ExecutionPolicy Bypass -File <this file>
$ErrorActionPreference = 'Stop'
$here   = $PSScriptRoot
$py     = 'C:\Python314\python.exe'   # python path; update here if it moves
$script = Join-Path $here 'fetch_reports.py'
$inbox  = Join-Path $here 'reports_inbox.md'

$out = (& $py $script --quiet-empty 2>&1 | Out-String)
if ($out.Trim().Length -gt 0) {
    $stamp = "`n===== fetch " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + " =====`n"
    Add-Content -Path $inbox -Value ($stamp + $out) -Encoding utf8
}
