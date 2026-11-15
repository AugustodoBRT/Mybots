# Vigia de janelas de console no Windows: descobre qual processo do MyBots abre uma janela preta (cmd, PowerShell, tar…) que pisca.
# Rode dentro do Windows (ver scripts/windows-vm.sh) enquanto usa o MyBots; para parar, apague C:\watch\parar.txt ou feche o PowerShell.
#   powershell -NoProfile -ExecutionPolicy Bypass -File windows-watch.ps1 [-Pasta C:\watch]
# Gera, na pasta:
#   processos.csv  cada processo novo: hora, pid, pai, nome, linha de comando, quem é o pai (cadeia até 4 níveis)
#   janelas.csv    cada janela de console VISÍVEL que apareceu: hora, classe, título, pid do dono, dono (nome + linha de comando)
param([string]$Pasta = 'C:\watch')
New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
Set-Content -Path (Join-Path $Pasta 'parar.txt') -Value 'apague este arquivo para parar'
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Janelas {
  delegate bool Enum(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Enum f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  // Janelas de console (conhost clássico e Windows Terminal) que estão visíveis agora: "handle|classe|título|pid".
  public static List<string> Consoles() {
    var lista = new List<string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      var cls = c.ToString();
      if (cls != "ConsoleWindowClass" && cls != "CASCADIA_HOSTING_WINDOW_CLASS" && cls != "PseudoConsoleWindow") return true;
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      lista.Add(h.ToInt64() + "|" + cls + "|" + t + "|" + pid);
      return true;
    }, IntPtr.Zero);
    return lista;
  }
}
'@
$proc = Join-Path $Pasta 'processos.csv'; $jan = Join-Path $Pasta 'janelas.csv'
Set-Content $proc 'hora;pid;pai;nome;comando;cadeia' -Encoding UTF8
Set-Content $jan 'hora;classe;titulo;pid_dono;dono' -Encoding UTF8
function Info($id) { try { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop; if ($p) { return $p } } catch {} return $null }
function Cadeia($ppid) {
  $out = @()
  for ($i = 0; $i -lt 4 -and $ppid; $i++) {
    $p = Info $ppid; if (-not $p) { break }
    $out += ('{0}({1})' -f $p.Name, $p.ProcessId); $ppid = $p.ParentProcessId
  }
  return ($out -join ' <- ')
}
# Cada processo novo, no instante em que nasce (assim não se perde o que dura milissegundos).
Register-CimIndicationEvent -Query 'SELECT * FROM Win32_ProcessStartTrace' -SourceIdentifier ComecoProcesso | Out-Null
$vistas = @{}
try {
  while (Test-Path (Join-Path $Pasta 'parar.txt')) {
    foreach ($e in @(Get-Event -SourceIdentifier ComecoProcesso -ErrorAction SilentlyContinue)) {
      $n = $e.SourceEventArgs.NewEvent
      $p = Info $n.ProcessID
      $linha = if ($p) { ($p.CommandLine -replace ';', ',' -replace '[\r\n]+', ' ') } else { '' }
      ('{0};{1};{2};{3};{4};{5}' -f $e.TimeGenerated.ToString('HH:mm:ss.fff'), $n.ProcessID, $n.ParentProcessID, $n.ProcessName, $linha, (Cadeia $n.ParentProcessID)) | Add-Content $proc -Encoding UTF8
      Remove-Event -EventIdentifier $e.EventIdentifier
    }
    foreach ($w in [Janelas]::Consoles()) {
      $parte = $w.Split('|'); $chave = $parte[0] + '|' + $parte[3]
      if ($vistas.ContainsKey($chave)) { continue }
      $vistas[$chave] = $true
      $dono = Info ([int]$parte[3])
      ('{0};{1};{2};{3};{4}' -f (Get-Date).ToString('HH:mm:ss.fff'), $parte[1], ($parte[2] -replace ';', ','), $parte[3], $(if ($dono) { $dono.Name + ' ' + ($dono.CommandLine -replace ';', ',') } else { '?' })) | Add-Content $jan -Encoding UTF8
    }
    Start-Sleep -Milliseconds 30
  }
} finally { Unregister-Event -SourceIdentifier ComecoProcesso -ErrorAction SilentlyContinue }
