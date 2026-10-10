# ============================================================
#  DownloadsDock — extract-helper (one-shot)
#  把 zip 解压到指定目录。stdin 两行：第 1 行源 zip，第 2 行目标目录。
#
#  为什么不用 Expand-Archive 的 -LiteralPath：
#    Expand-Archive 的 -Path **没有** -LiteralPath 参数（只有 -DestinationPath 有），
#    所以含 [ ] 等通配符的路径会被当模式解析并报错。
#    这里改用 .NET 的 ZipFile.ExtractToDirectory，天然按字面路径处理，最稳。
#
#  编码：中文文件名在 zip 里通常是 GBK 且不带 UTF-8 标志位，
#    新版 .NET 会按 UTF-8 解出乱码。所以显式指定 GBK(936) 作为回退编码。
#
#  「只有一个顶层目录」要提升（去壳）：
#    很多包的内部结构是「根下只有一个文件夹」，例如
#      Excel-单元格着色修复.zip  里只有  Excel\index.vue、Excel\mixins\...
#    如果直接解到目标目录，就会得到 目标\Excel\index.vue —— 多一层没意义的壳
#    （用户右键解压时期待的是 目标\index.vue）。
#    做法：先解到临时目录，若发现「只有 1 个条目、且是目录」，就把那个目录整体
#    改名成目标名。若有多个顶层条目（文件散在根），说明用户就是想要这些内容
#    直接铺在目标文件夹里，不动。
# ============================================================
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$src  = [Console]::In.ReadLine()
$dest = [Console]::In.ReadLine()

if (-not $src -or -not $dest) { [Console]::Error.WriteLine('缺少参数'); exit 1 }
if (-not (Test-Path -LiteralPath $src)) { [Console]::Error.WriteLine('源文件不存在'); exit 1 }

Add-Type -AssemblyName System.IO.Compression.FileSystem

# 解到临时目录（放在目标同一个父目录下，保证同盘，改名是秒级操作）
# 注意：PS 5.1 的 Split-Path **没有** -LiteralPath（只有 -Path），
#   所以要按字面取父目录只能用 .NET 的 GetDirectoryName，否则含 [ ] 的路径会炸。
$parent = [System.IO.Path]::GetDirectoryName($dest)
$tmp = Join-Path $parent ('.dd-extract-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))

function Cleanup {
    if (Test-Path -LiteralPath $tmp) {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

try {
    [void][System.IO.Directory]::CreateDirectory($tmp)

    # 先试 UTF-8（大多数现代压缩包）
    try {
        [System.IO.Compression.ZipFile]::ExtractToDirectory($src, $tmp, [System.Text.Encoding]::UTF8)
    } catch {
        # UTF-8 失败 → 清掉半成品，改用 GBK 重试（老工具打的中文 zip）
        Cleanup
        [void][System.IO.Directory]::CreateDirectory($tmp)
        [System.IO.Compression.ZipFile]::ExtractToDirectory($src, $tmp, [System.Text.Encoding]::GetEncoding(936))
    }

    $entries = @(Get-ChildItem -LiteralPath $tmp -Force)
    $inner = $null
    if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
        $inner = $entries[0].FullName
    }

    # 目标名由主进程决定（已处理好重名序号）
    if ($inner) {
        # 单顶层目录 → 去壳：把那一层直接改名为目标
        Move-Item -LiteralPath $inner -Destination $dest
        Cleanup
    } else {
        # 多个顶层条目 → 整个临时目录改名成目标（内容仍在目标文件夹内，不散落）
        Move-Item -LiteralPath $tmp -Destination $dest
    }
    exit 0
} catch {
    Cleanup
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 2
}
