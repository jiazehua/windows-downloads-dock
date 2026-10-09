# ============================================================
#  DownloadsDock — drag-helper (one-shot, STA)
#  Performs a native OLE file drag-out via WinForms DoDragDrop
#  (used for folder / mixed drags, which webContents.startDrag
#  cannot handle). Paths come from stdin, one per line.
#  Spawned by main.js.
# ============================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$paths = @()
while ($line = [Console]::In.ReadLine()) {
    if ($line) { $paths += $line }
}
if ($paths.Count -eq 0) { exit }

$form = New-Object System.Windows.Forms.Form
$form.ShowInTaskbar = $false
$form.Width = 1
$form.Height = 1
[void]$form.Handle

$data = New-Object System.Windows.Forms.DataObject([System.Windows.Forms.DataFormats]::FileDrop, [string[]]$paths)
[void]$form.DoDragDrop($data, [System.Windows.Forms.DragDropEffects]::Copy)
$form.Dispose()
