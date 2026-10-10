# ============================================================
#  DownloadsDock — cut-helper (one-shot, STA)
#  把文件/文件夹以「剪切」方式写入剪贴板。
#
#  和 copy-helper.ps1 的唯一区别是：额外写入 Preferred DropEffect
#  这个剪贴板格式，值为 DROPEFFECT_MOVE (2)。
#  资源管理器 Ctrl+V 时会读这个格式，看到 2 就执行「移动」而不是「复制」——
#  这与在资源管理器里按 Ctrl+X 的行为完全一致，能直接跨程序粘贴。
#
#  只写 SetFileDropList 是「复制」；要「剪切」就必须补上 DropEffect，
#  这是 Windows 剪贴板约定，没有别的办法。
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
    # ⚠️ 必须用 [System.Windows.Forms.DataObject]::new() 显式构造。
    #    New-Object System.Windows.Forms.DataObject 在这个无交互会话里会建出 $null
    #    （随后 SetFileDropList 就报「不能对 Null 值表达式调用方法」）。
    #    另外两种格式要一次 SetDataObject 提交：先 SetFileDropList 再补 DropEffect
    #    会把前一步的内容整个冲掉（剪贴板是整体替换语义）。
    $data = [System.Windows.Forms.DataObject]::new()
    $data.SetFileDropList($sc)
    # DROPEFFECT_MOVE = 2，4 字节小端
    $data.SetData('Preferred DropEffect', [byte[]](2, 0, 0, 0))
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
}
