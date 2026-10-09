# ============================================================
#  DownloadsDock — paste-helper (one-shot, STA)
#  Reads file/dir paths currently on the clipboard (CF_HDROP)
#  and prints them as a JSON array on stdout.
#  Spawned by main.js as:
#    powershell -NoProfile -STA -ExecutionPolicy Bypass -File paste-helper.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$list = [System.Windows.Forms.Clipboard]::GetFileDropList()
if ($list -and $list.Count -gt 0) {
    $paths = @()
    foreach ($p in $list) { $paths += [string]$p }
    $paths | ConvertTo-Json -Compress
} else {
    ''
}
