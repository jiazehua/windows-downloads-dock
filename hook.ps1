# ============================================================
#  DownloadsDock — Alt+Shift+D global hotkey hook (low-level keyboard hook)
#  Intercepts Alt+Shift+D globally and prints "toggle" to stdout
#  to notify the Electron main process.
#  Spawned by main.js as: powershell -NoProfile -ExecutionPolicy Bypass -File hook.ps1
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
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_D = 0x44;
    private const int VK_MENU = 0x12;   // Alt
    private const int VK_SHIFT = 0x10;  // Shift

    private static IntPtr _hook = IntPtr.Zero;
    private static HookProc _proc = null;

    private static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
            {
                KBDLLHOOKSTRUCT kb = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                if (kb.vkCode == VK_D)
                {
                    bool altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
                    bool shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                    if (altDown && shiftDown)
                    {
                        Console.WriteLine("toggle");
                        Console.Out.Flush();
                        return (IntPtr)1; // swallow the key so other apps never see Alt+Shift+D
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
