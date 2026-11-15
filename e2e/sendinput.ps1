# Real keystrokes through the OS, for the Windows e2e (editor #510). Playwright's keys go in through the DevTools
# protocol, and Windows' spellchecker does not mark words typed that way; it marks words typed at the keyboard. So
# a test that needs the spellchecker to see typing sends it through user32 SendInput instead, into Midst's window.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File sendinput.ps1 -Hwnd <window> -Keys <base64> -PaceMs <ms>
#
# Keys is a JSON array of strings, UTF-8 and base64-encoded (Windows PowerShell 5.1 strips the double quotes from
# a JSON argument): "Enter", "ArrowUp" and "End" are those keys, anything else is typed as text, one
# character at a time. Each keystroke goes only to Hwnd: the window is brought to the front first, and before every
# key the foreground window is checked again. If it is not Hwnd, nothing more is sent and the exit code is 3, so a
# keystroke can never land in another window.

param(
  [Parameter(Mandatory = $true)][string]$Hwnd,
  [Parameter(Mandatory = $true)][string]$Keys,
  [int]$PaceMs = 120
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class MidstKeys {
  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public INPUTUNION u; }

  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;

  [DllImport("user32.dll", SetLastError = true)]
  static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  static void Send(INPUT[] inputs) {
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) throw new Exception("SendInput sent " + sent + " of " + inputs.Length + ", error " + Marshal.GetLastWin32Error());
  }

  static INPUT Key(ushort vk, ushort scan, uint flags) {
    INPUT i = new INPUT();
    i.type = INPUT_KEYBOARD;
    i.u.ki.wVk = vk;
    i.u.ki.wScan = scan;
    i.u.ki.dwFlags = flags;
    return i;
  }

  public static void Char(char c) {
    Send(new INPUT[] { Key(0, c, KEYEVENTF_UNICODE), Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP) });
  }

  public static void Virtual(ushort vk, bool extended) {
    uint ext = extended ? KEYEVENTF_EXTENDEDKEY : 0;
    Send(new INPUT[] { Key(vk, 0, ext), Key(vk, 0, ext | KEYEVENTF_KEYUP) });
  }
}
'@

$target = [IntPtr][Int64]$Hwnd
[void][MidstKeys]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 200

function Assert-Foreground {
  $now = [MidstKeys]::GetForegroundWindow()
  if ($now -ne $target) {
    [Console]::Error.WriteLine("sendinput: the foreground window is $now, not Midst's $target; nothing more sent")
    exit 3
  }
}

$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Keys))
foreach ($k in (ConvertFrom-Json $json)) {
  switch -CaseSensitive ($k) {
    'Enter' { Assert-Foreground; [MidstKeys]::Virtual(0x0D, $false); Start-Sleep -Milliseconds $PaceMs }
    'ArrowUp' { Assert-Foreground; [MidstKeys]::Virtual(0x26, $true); Start-Sleep -Milliseconds $PaceMs }
    'End' { Assert-Foreground; [MidstKeys]::Virtual(0x23, $true); Start-Sleep -Milliseconds $PaceMs }
    default {
      foreach ($c in $k.ToCharArray()) {
        Assert-Foreground
        [MidstKeys]::Char($c)
        Start-Sleep -Milliseconds $PaceMs
      }
    }
  }
}
exit 0
