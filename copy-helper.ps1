# ============================================================
#  DownloadsDock — copy-helper (one-shot, STA)
#  Reads file/dir paths from stdin (one per line) and copies them
#  to the clipboard as CF_HDROP so the user can paste elsewhere.
#  Spawned by main.js, paths are written to stdin (avoids
#  PowerShell -File array-argument binding issues).
# ============================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$paths = @()
while ($line = [Console]::In.ReadLine()) {
    if ($line) { $paths += $line }
}

$sc = New-Object System.Collections.Specialized.StringCollection
foreach ($p in $paths) {
    if (Test-Path -LiteralPath $p) { [void]$sc.Add($p) }
}
if ($sc.Count -gt 0) {
    [System.Windows.Forms.Clipboard]::SetFileDropList($sc)
}
