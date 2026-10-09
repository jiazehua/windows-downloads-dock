# ============================================================
#  下载浮窗 × 最近图片 — Ctrl+Shift+V 全局热键钩子
#  用低级键盘钩子（WH_KEYBOARD_LL）全局拦截 Ctrl+Shift+V，
#  吞掉按键并向 stdout 打印 "toggle" 通知 Electron 主进程。
#  由 main.js 以如下方式启动：
#      powershell -NoProfile -ExecutionPolicy Bypass -File hook.ps1
#
#  ⚠️ Ctrl+Shift+V 在部分编辑器/浏览器里是「粘贴为纯文本」，这里会把它抢走。
#     若觉得冲突，把下面的 VK_V 换成别的键（例如 VK_D = 0x44）即可。
#
#  ⚠️⚠️ 下面 C# 源码块必须保持「纯 ASCII」！
#     本文件是 UTF-8，而 Windows PowerShell 5.1 在脚本没有 BOM 时按 ANSI(936)
#     解码，Add-Type -TypeDefinition 又会按 ANSI 落盘临时 .cs —— 一旦 C# 里出现
#     中文注释，这条 编码回环 就会让 C# 编译器报出莫名其妙的
#     "应输入 }"（行号还对不上），热键直接失效。故 C# 部分一律写英文注释。
#     本文件已加 UTF-8 BOM，所以上面这些中文注释可以安全阅读。
# ============================================================
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

$src = @'
using System;
using System.Runtime.InteropServices;

public static class LowKeyHook
{
    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_V = 0x56;       // main key: V
    private const int VK_CONTROL = 0x11;
    private const int VK_SHIFT = 0x10;
    private const int VK_MENU = 0x12;    // Alt

    private static IntPtr _hook = IntPtr.Zero;
    private static HookProc _proc = null;
    // The OS repeats KEYDOWN while the key is held down; only fire on the first one
    // and reset on key-up.
    private static bool _held = false;

    private static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN || msg == WM_KEYUP || msg == WM_SYSKEYUP)
            {
                KBDLLHOOKSTRUCT kb = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                if (kb.vkCode == VK_V)
                {
                    if (msg == WM_KEYUP || msg == WM_SYSKEYUP)
                    {
                        if (_held)
                        {
                            _held = false;
                            return (IntPtr)1;   // swallow the matching key-up too
                        }
                    }
                    else
                    {
                        bool ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
                        bool shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                        bool altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
                        if (ctrlDown && shiftDown && !altDown && !_held)
                        {
                            _held = true;
                            Console.WriteLine("toggle");
                            Console.Out.Flush();
                            return (IntPtr)1;   // swallow the key so other apps never see Ctrl+Shift+V
                        }
                    }
                }
            }
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public static void Install()
    {
        _proc = new HookProc(Callback);
        _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, IntPtr.Zero, 0);
    }

    public static void Uninstall()
    {
        if (_hook != IntPtr.Zero) { UnhookWindowsHookEx(_hook); _hook = IntPtr.Zero; }
    }
}
'@

Add-Type -TypeDefinition $src

[LowKeyHook]::Install()

# Keep a message pump alive so the low-level hook keeps dispatching.
$form = New-Object System.Windows.Forms.Form
$form.ShowInTaskbar = $false
$form.Opacity = 0
$form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$form.Add_FormClosing({ [LowKeyHook]::Uninstall() })
[System.Windows.Forms.Application]::Run($form)
