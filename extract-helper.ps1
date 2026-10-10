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
# ============================================================
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$src  = [Console]::In.ReadLine()
$dest = [Console]::In.ReadLine()

if (-not $src -or -not $dest) { [Console]::Error.WriteLine('缺少参数'); exit 1 }
if (-not (Test-Path -LiteralPath $src)) { [Console]::Error.WriteLine('源文件不存在'); exit 1 }

Add-Type -AssemblyName System.IO.Compression.FileSystem

try {
    if (-not (Test-Path -LiteralPath $dest)) {
        [void][System.IO.Directory]::CreateDirectory($dest)
    }
    # 先试 UTF-8（大多数现代压缩包）
    try {
        [System.IO.Compression.ZipFile]::ExtractToDirectory($src, $dest, [System.Text.Encoding]::UTF8)
    } catch {
        # UTF-8 失败 → 清掉半成品，改用 GBK 重试（老工具打的中文 zip）
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue }
        [void][System.IO.Directory]::CreateDirectory($dest)
        [System.IO.Compression.ZipFile]::ExtractToDirectory($src, $dest, [System.Text.Encoding]::GetEncoding(936))
    }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 2
}
