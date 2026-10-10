# ============================================================
#  DownloadsDock — paste-helper (one-shot, STA)
#  读出剪贴板里的文件/文件夹路径，并把「这是复制还是剪切」一起告诉主进程。
#  输出一行 JSON：{"paths":[...],"cut":true|false}
#
#  为什么要区分：主进程拿到列表后要决定用 fs.cpSync（复制）还是
#  fs.renameSync（移动）。剪贴板本身没有公开的「剪切标记」属性，
#  唯一可靠的依据就是 Preferred DropEffect 这个格式：
#    DROPEFFECT_COPY = 1   DROPEFFECT_MOVE = 2
#  资源管理器按 Ctrl+X 时写的就是 2，我们自己写的 cut-helper.ps1 也写 2。
#
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

    # 读 Preferred DropEffect；拿不到就按「复制」处理（最安全，绝不误删用户文件）
    $cut = $false
    try {
        $data = [System.Windows.Forms.Clipboard]::GetDataObject()
        if ($data -and $data.GetDataPresent('Preferred DropEffect')) {
            $eff = $data.GetData('Preferred DropEffect')
            if ($eff -is [byte[]]) {
                $val = [BitConverter]::ToInt32($eff, 0)
                if ($val -band 2) { $cut = $true }
            }
        }
    } catch {
        $cut = $false
    }

    @{ paths = $paths; cut = $cut } | ConvertTo-Json -Compress
} else {
    ''
}
