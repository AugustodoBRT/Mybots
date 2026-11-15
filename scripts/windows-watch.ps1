# Vigia de janelas de console no Windows: descobre qual processo do MyBots abre uma janela preta (cmd, PowerShell, tar…) que pisca.
# Rode dentro do Windows (ver scripts/windows-vm.sh) enquanto usa o MyBots; para parar, apague C:\watch\parar.txt ou feche o PowerShell.
#   powershell -NoProfile -ExecutionPolicy Bypass -File windows-watch.ps1 [-Pasta C:\watch]
# Gera, na pasta:
#   processos.csv  cada processo novo: hora, pid, pai, nome, linha de comando, quem é o pai (cadeia até 5 níveis)
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
# Fotos da lista de processos (sem precisar de administrador): cada processo novo é registrado com quem o abriu.
$tabela = @{}        # pid -> processo da última foto
$conhecidos = @{}    # pid + hora de criação, para não registrar duas vezes
function Foto {
  $nova = @{}
  foreach ($p in Get-CimInstance Win32_Process) { $nova[[int]$p.ProcessId] = $p }
  $script:tabela = $nova
  foreach ($p in $nova.Values) {
    $chave = '{0}|{1}' -f $p.ProcessId, $p.CreationDate.Ticks
    if ($conhecidos.ContainsKey($chave)) { continue }
    $conhecidos[$chave] = $true
    if ($script:primeira) { continue }   # o que já existia ao começar não interessa
    $linha = ($p.CommandLine -replace ';', ',' -replace '[\r\n]+', ' ')
    ('{0};{1};{2};{3};{4};{5}' -f (Get-Date).ToString('HH:mm:ss.fff'), $p.ProcessId, $p.ParentProcessId, $p.Name, $linha, (Cadeia $p.ParentProcessId)) | Add-Content $proc -Encoding UTF8
  }
  $script:primeira = $false
}
function Cadeia($ppid) {
  $out = @()
  for ($i = 0; $i -lt 5 -and $ppid; $i++) {
    $p = $script:tabela[[int]$ppid]; if (-not $p) { break }
    $out += ('{0}({1})' -f $p.Name, $p.ProcessId); $ppid = $p.ParentProcessId
  }
  return ($out -join ' <- ')
}
$script:primeira = $true
Foto
$vistas = @{}; $volta = 0
while (Test-Path (Join-Path $Pasta 'parar.txt')) {
  $achou = $false
  foreach ($w in [Janelas]::Consoles()) {
    $parte = $w.Split('|'); $chave = $parte[0] + '|' + $parte[3]
    if ($vistas.ContainsKey($chave)) { continue }
    $vistas[$chave] = $true; $achou = $true
    Foto   # foto na hora: o dono da janela e quem o abriu ainda estão vivos
    $dono = $tabela[[int]$parte[3]]
    ('{0};{1};{2};{3};{4}' -f (Get-Date).ToString('HH:mm:ss.fff'), $parte[1], ($parte[2] -replace ';', ','), $parte[3],
      $(if ($dono) { $dono.Name + ' ' + ($dono.CommandLine -replace ';', ',') + '  <-  ' + (Cadeia $dono.ParentProcessId) } else { '? (já saiu)' })) | Add-Content $jan -Encoding UTF8
  }
  $volta++
  if (-not $achou -and ($volta % 3 -eq 0)) { Foto }
  Start-Sleep -Milliseconds 30
}
