# Misst Installation, Aktualisierung und Deinstallation des Programmfensters unter Windows (#517), mit dem
# Echtzeitschutz von Windows Defender. Aufruf aus release.yml (Job „Installer messen“):
#
#   pwsh desktop/build/installer-messung.ps1 -Setup paket\Mietfuchs-Setup-x.exe -Variante tasklist -Out messung
#
# Je Lauf: frisch installieren, dieselbe Fassung darüber installieren (Aktualisierung: der Installer ruft das
# Deinstallationsprogramm der vorigen Fassung auf), deinstallieren. Danach einmal installieren, während Mietfuchs
# läuft. Quellen der Zeiten:
#   - das Protokoll des Installers (%TEMP%\mietfuchs-installation.log, desktop/build/installer.nsh), Phasen je Haken
#   - ein FileSystemWatcher auf %LOCALAPPDATA% (darin %TEMP%): wann welche Datei geschrieben wurde
#   - die Leistungsaufzeichnung von Defender (wpr mit dem Profil hinter New-MpPerformanceRecording) und
#     Get-MpPerformanceReport: welche Dateien Defender wie lange geprüft hat
#   - das Ereignisprotokoll von Defender im Zeitraum der Messung
# Nur lesen: Eingeschaltet wird allein der Echtzeitschutz, Ausnahmen werden keine eingetragen.
param(
  [Parameter(Mandatory)] [string] $Setup,
  [Parameter(Mandatory)] [string] $Variante,
  [string] $Out = 'installer-messung',
  [int] $Runs = 3
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$Setup = (Resolve-Path $Setup).Path
$log = Join-Path $env:TEMP 'mietfuchs-installation.log'
$dir = Join-Path $env:LOCALAPPDATA 'Programs\mietfuchs'
$exe = Join-Path $dir 'Mietfuchs.exe'
$uninst = Join-Path $dir 'Uninstall Mietfuchs.exe'
$report = [System.Collections.Generic.List[string]]::new()
function Note([string] $s) { $report.Add($s); Write-Host $s }
$messStart = Get-Date

Note "## Installer messen: $Variante auf $env:RUNNER_NAME ($env:PROCESSOR_ARCHITECTURE)"
Note ''
Note "Installer: $(Split-Path $Setup -Leaf), $([math]::Round((Get-Item $Setup).Length / 1MB, 1)) MB"

# --- Defender: Stand belegen, Echtzeitschutz einschalten ---------------------------------------------------------
Note ''
Note '```'
try {
  $vorher = (Get-MpComputerStatus).RealTimeProtectionEnabled
  if (-not $vorher) {
    try { Set-MpPreference -DisableRealtimeMonitoring $false } catch { Note "Echtzeitschutz nicht einschaltbar: $($_.Exception.Message)" }
  }
  $st = Get-MpComputerStatus
  $pr = Get-MpPreference
  Note "Echtzeitschutz: vorher $vorher, jetzt $($st.RealTimeProtectionEnabled); Zugriffsschutz $($st.OnAccessProtectionEnabled), Downloads (IOAV) $($st.IoavProtectionEnabled), Verhalten $($st.BehaviorMonitorEnabled), Modus $($st.AMRunningMode), Manipulationsschutz $($st.IsTamperProtected)"
  Note "Defender: Plattform $($st.AMProductVersion), Engine $($st.AMEngineVersion), Signaturen $($st.AntivirusSignatureVersion)"
  Note "Cloud-Schutz MAPSReporting $($pr.MAPSReporting) (0 aus, 1 einfach, 2 erweitert), SubmitSamplesConsent $($pr.SubmitSamplesConsent), DisableBlockAtFirstSeen $($pr.DisableBlockAtFirstSeen), CloudBlockLevel $($pr.CloudBlockLevel), CloudExtendedTimeout $($pr.CloudExtendedTimeout) s"
  Note "DisableIOAVProtection $($pr.DisableIOAVProtection), DisableScriptScanning $($pr.DisableScriptScanning), EnableFileHashComputation $($pr.EnableFileHashComputation), ScanAvgCPULoadFactor $($pr.ScanAvgCPULoadFactor)"
  Note "Ausnahmen: Pfade [$(@($pr.ExclusionPath) -join '; ')], Prozesse [$(@($pr.ExclusionProcess) -join '; ')], Endungen [$(@($pr.ExclusionExtension) -join '; ')]"
} catch {
  Note "Defender nicht lesbar: $($_.Exception.Message)"
}
Note '```'

# --- Leistungsaufzeichnung von Defender ----------------------------------------------------------------------------
# New-MpPerformanceRecording wartet auf eine Taste; deshalb wpr mit demselben Profil unmittelbar
$etl = Join-Path $Out 'defender.etl'
$wprRunning = $false
try {
  # Das Defender-Modul liegt bei Windows PowerShell; pwsh listet es nicht unbedingt
  # New-MpPerformanceRecording steht im Modul ConfigDefenderPerformance, das Profil liegt daneben
  $roots = @("$env:SystemRoot\System32\WindowsPowerShell\v1.0\Modules\ConfigDefenderPerformance", "$env:SystemRoot\System32\WindowsPowerShell\v1.0\Modules\Defender", "$env:ProgramFiles\Windows Defender")
  $roots += @(Get-Module -ListAvailable ConfigDefenderPerformance, Defender -SkipEditionCheck -ErrorAction SilentlyContinue | ForEach-Object { Split-Path $_.Path })
  $roots = @($roots | Where-Object { $_ -and (Test-Path $_) })
  $wprp = $roots | ForEach-Object { Get-ChildItem $_ -Filter *.wprp -Recurse -ErrorAction SilentlyContinue } | Select-Object -First 1
  if (-not $wprp) { throw "kein .wprp in $($roots -join ', ')" }
  Write-Host "Profil: $($wprp.FullName)"
  $hint = Get-ChildItem (Split-Path $wprp.FullName) -Filter *.psm1 -Recurse | Select-String -Pattern 'wpr' -SimpleMatch | Select-Object -First 8
  $hint | ForEach-Object { Write-Host "  $($_.Filename):$($_.LineNumber): $($_.Line.Trim())" }
  $profiles = ([xml](Get-Content $wprp.FullName)).WindowsPerformanceRecorder.Profiles.Profile
  $candidates = @()
  foreach ($p in $profiles) {
    if ($p.LoggingMode -ne 'File') { continue }
    $candidates += "$($p.Name).$($p.DetailLevel)"
    if ($p.Id) { $candidates += $p.Id }
  }
  foreach ($c in ($candidates | Select-Object -Unique | Sort-Object { if ($_ -match 'Light') { 0 } else { 1 } })) {
    & wpr.exe -cancel -instancename MfDefender 2>$null | Out-Null
    & wpr.exe -start "$($wprp.FullName)!$c" -filemode -instancename MfDefender 2>&1 | Out-Host
    if ($LASTEXITCODE -eq 0) { $wprRunning = $true; Write-Host "Defender-Aufzeichnung läuft mit $c"; break }
  }
  if (-not $wprRunning) { throw "wpr startete mit keinem Profil ($($candidates -join ', '))" }
} catch {
  Note "Keine Leistungsaufzeichnung von Defender: $($_.Exception.Message)"
}

# --- Dateien beobachten --------------------------------------------------------------------------------------------
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Concurrent;
using System.Collections.Generic;
public class MfWatch {
  readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
  readonly FileSystemWatcher watcher;
  public MfWatch(string path) {
    watcher = new FileSystemWatcher(path);
    watcher.IncludeSubdirectories = true;
    watcher.InternalBufferSize = 65536;
    watcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size;
    watcher.Created += (s, e) => Add("C", e.FullPath);
    watcher.Changed += (s, e) => Add("W", e.FullPath);
    watcher.Deleted += (s, e) => Add("D", e.FullPath);
    watcher.Renamed += (s, e) => Add("R", e.FullPath);
    watcher.Error += (s, e) => Add("E", e.GetException().Message);
    watcher.EnableRaisingEvents = true;
  }
  void Add(string kind, string path) { queue.Enqueue(DateTime.Now.ToString("o") + "\t" + kind + "\t" + path); }
  public string[] Drain() {
    var list = new List<string>();
    string item;
    while (queue.TryDequeue(out item)) list.Add(item);
    return list.ToArray();
  }
}
'@
$watch = [MfWatch]::new($env:LOCALAPPDATA)
$relevant = '\\ns[^\\]*\.tmp\\|\\~nsu|\\Programs\\mietfuchs|\\mietfuchs-updater'

function Read-InstallerLog {
  if (-not (Test-Path $log)) { return @() }
  foreach ($line in Get-Content $log) {
    if ($line -match '^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\s+\+\S+ s\s+(\S+)\s+\[([^\]]+)\]\s*(.*)$') {
      [pscustomobject]@{ Time = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss.fff', $null); Run = $Matches[2]; Mark = $Matches[3]; Text = $Matches[4] }
    }
  }
}

function Seconds($from, $to) {
  if ($null -eq $from -or $null -eq $to) { return '' }
  return ('{0:0.0}' -f ($to - $from).TotalSeconds)
}

# Zeit einer Marke im Protokoll (erste Fundstelle des Laufs)
function MarkTime($entries, [string] $run, [string] $mark) {
  ($entries | Where-Object { $_.Run -eq $run -and $_.Mark -eq $mark } | Select-Object -First 1).Time
}

# "angelegt 2026-…, zuletzt geschrieben 2026-…" aus einer [datei]-Zeile
function FileTimes($entries, [string] $label) {
  $e = $entries | Where-Object { $_.Mark -eq 'datei' -and $_.Text.StartsWith("${label}:") } | Select-Object -First 1
  $ts = '(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})'
  if ($e -and $e.Text -match "angelegt $ts, zuletzt geschrieben $ts") {
    return @([datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss.fff', $null), [datetime]::ParseExact($Matches[2], 'yyyy-MM-dd HH:mm:ss.fff', $null))
  }
  return @($null, $null)
}

$rows = [System.Collections.Generic.List[object]]::new()

function Invoke-Measured([string] $kind, [int] $run, [string] $file, [string[]] $arguments) {
  Remove-Item $log -ErrorAction SilentlyContinue
  $null = $watch.Drain()
  $t0 = Get-Date
  $p = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru
  $t1 = Get-Date
  # Das Deinstallationsprogramm kopiert sich nach %TEMP%\~nsu*.tmp\Un_A.exe, startet sich von dort und endet sofort;
  # auf die Kopie warten
  if ($kind -eq 'Deinstallation') {
    Start-Sleep -Milliseconds 200
    for ($i = 0; $i -lt 600 -and (Get-Process Un_A -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 100 }
    $t1 = Get-Date
  }
  Start-Sleep -Milliseconds 300
  $events = $watch.Drain() | ForEach-Object {
    $f = $_ -split "`t", 3
    [pscustomobject]@{ Time = [datetime]::Parse($f[0]); Kind = $f[1]; Path = $f[2] }
  } | Where-Object { $_.Path -match $relevant -or $_.Kind -eq 'E' }
  $entries = @(Read-InstallerLog)
  $name = "$run-$kind"
  if (Test-Path $log) { Copy-Item $log (Join-Path $Out "$name.log") }
  $events | ForEach-Object { "$($_.Time.ToString('HH:mm:ss.fff'))`t$($_.Kind)`t$($_.Path)" } | Set-Content (Join-Path $Out "$name-dateien.txt")

  $row = [ordered]@{ Lauf = "$run $kind"; Code = $p.ExitCode; Gesamt = Seconds $t0 $t1 }
  if ($kind -ne 'Deinstallation') {
    $start = MarkTime $entries 'Installation' 'start'
    $cb = MarkTime $entries 'Installation' 'pruefung-beginn'
    $ce = MarkTime $entries 'Installation' 'pruefung-ende'
    $old = MarkTime $entries 'Installation' 'alte-fassung'
    $ext = MarkTime $entries 'Installation' 'ausgepackt'
    $end = MarkTime $entries 'Installation' 'ende'
    # NSIS übernimmt beim Schreiben die Zeitstempel aus dem Bau; echt sind die Anlage der Kopien und der Ordner 7z-out
    $unpack = FileTimes $entries 'Ausgepackt'
    $copyEvents = @($events | Where-Object { $_.Path -match '\\mietfuchs-updater\\installer\.exe' -and $_.Kind -ne 'D' })
    $pkgEvents = @($events | Where-Object { $_.Path -match '\\ns[^\\]*\.tmp\\app-' })
    $unPruef = Seconds (MarkTime $entries 'Deinstallation' 'pruefung-beginn') (MarkTime $entries 'Deinstallation' 'pruefung-ende')
    $row['Bis Start'] = Seconds $t0 $start
    $row['Prüfung'] = Seconds $cb $ce
    $row['Alte Fassung entfernen'] = Seconds $ce $old
    $row['davon Prüfung im alten Deinstallationsprogramm'] = $unPruef
    if ($pkgEvents.Count) { $row['Paket nach $PLUGINSDIR'] = Seconds $old $unpack[0] }
    $row['Auspacken nach 7z-out'] = Seconds $unpack[0] $unpack[1]
    $row['Kopieren nach $INSTDIR'] = Seconds $unpack[1] $ext
    $row['Danach bis Ende'] = Seconds $ext $end
    if ($copyEvents.Count) { $row['davon Kopie des Installers'] = Seconds $copyEvents[0].Time $copyEvents[-1].Time }
    $row['Ende bis Prozessende'] = Seconds $end $t1
  } else {
    $cb = MarkTime $entries 'Deinstallation' 'pruefung-beginn'
    $ce = MarkTime $entries 'Deinstallation' 'pruefung-ende'
    $rm = MarkTime $entries 'Deinstallation' 'entfernen'
    $end = MarkTime $entries 'Deinstallation' 'ende'
    $row['Bis Start'] = Seconds $t0 $cb
    $row['Prüfung'] = Seconds $cb $ce
    $row['Bis Entfernen'] = Seconds $ce $rm
    $row['Entfernen'] = Seconds $rm $end
  }
  if (@($events | Where-Object Kind -eq 'E').Count) { $row['Beobachter'] = 'Überlauf' }
  $leftover = $kind -eq 'Deinstallation' -and (Test-Path $dir)
  if ($leftover) {
    Get-ChildItem $dir -Recurse | ForEach-Object { Write-Host "  übrig: $($_.FullName)" }
    $row['Übrig'] = @(Get-ChildItem $dir -Recurse -File).Count
  }
  $rows.Add([pscustomobject]$row)
  Write-Host ("{0}: {1} s (Code {2})" -f $name, $row.Gesamt, $p.ExitCode)
  if ($p.ExitCode -ne 0) { throw "${name} endete mit Code $($p.ExitCode)" }
  if ($kind -ne 'Deinstallation' -and -not (Test-Path $exe)) { throw "${name}: $exe fehlt" }
  if ($leftover) {
    # Die Vorlage übergeht eine gerade geöffnete Datei still; dort ist das ein Befund, kein Abbruch der Messung
    if ($Variante -ne 'vorlage') { throw "${name}: $dir noch da" }
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (Test-Path $uninst) { Start-Process $uninst -ArgumentList '/S' -Wait }
for ($i = 1; $i -le $Runs; $i++) {
  Invoke-Measured 'Installation' $i $Setup @('/S')
  Invoke-Measured 'Aktualisierung' $i $Setup @('/S')
  Invoke-Measured 'Deinstallation' $i $uninst @('/S')
}

# Installieren, während Mietfuchs läuft: Der Installer muss es schließen und durchlaufen
Invoke-Measured 'Installation' 0 $Setup @('/S')
$data = Join-Path $env:RUNNER_TEMP 'mietfuchs-daten-messung'
$env:CI = '1'; $env:NKA_DATA_DIR = $data; $env:NKA_UPDATE_URL = 'http://127.0.0.1:9/kein-internet-im-test'
Start-Process $exe | Out-Null
# Das Fenster startet Hilfsprozesse und den Server (utilityProcess), alle als Mietfuchs.exe
for ($i = 0; $i -lt 60 -and @(Get-Process Mietfuchs -ErrorAction SilentlyContinue).Count -lt 3; $i++) { Start-Sleep -Milliseconds 500 }
Start-Sleep -Seconds 3
$before = @(Get-Process Mietfuchs -ErrorAction SilentlyContinue).Count
Invoke-Measured 'Aktualisierung bei laufendem Mietfuchs' 0 $Setup @('/S')
$after = @(Get-Process Mietfuchs -ErrorAction SilentlyContinue).Count
Note ''
Note "Bei laufendem Mietfuchs: vorher $before Prozesse, nachher $after"
Get-Process Mietfuchs -ErrorAction SilentlyContinue | Stop-Process -Force
if ($before -eq 0) { throw 'Mietfuchs lief vor der Aktualisierung nicht' }
if ($after -ne 0) { throw 'Mietfuchs läuft nach der Aktualisierung weiter' }
Invoke-Measured 'Deinstallation' 0 $uninst @('/S')

# --- Ergebnisse ----------------------------------------------------------------------------------------------------
$columns = @()
foreach ($r in $rows) { foreach ($n in $r.PSObject.Properties.Name) { if ($columns -notcontains $n) { $columns += $n } } }
Note ''
Note "### Phasen in Sekunden ($Variante)"
Note ''
foreach ($kind in 'Installation', 'Aktualisierung', 'Deinstallation') {
  $sel = @($rows | Where-Object { $_.Lauf -like "* $kind*" })
  if (-not $sel.Count) { continue }
  $cols = @($columns | Where-Object { $c = $_; @($sel | Where-Object { $_.$c -ne $null -and "$($_.$c)" -ne '' }).Count })
  Note "| $($cols -join ' | ') |"
  Note "|$(($cols | ForEach-Object { ' --- ' }) -join '|')|"
  foreach ($r in $sel) { Note "| $(($cols | ForEach-Object { "$($r.$_)" }) -join ' | ') |" }
  Note ''
}
$rows | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $Out 'phasen.json')

if ($wprRunning) {
  & wpr.exe -stop $etl -instancename MfDefender 2>&1 | Out-Host
  try {
    $perf = Get-MpPerformanceReport -Path $etl -TopFiles 20 -TopExtensions 10 -TopProcesses 10 -TopScans 20 | Out-String -Width 300
    $perf | Set-Content (Join-Path $Out 'defender-leistung.txt')
    Note '<details><summary>Defender: längste Prüfungen (Get-MpPerformanceReport)</summary>'
    Note ''
    Note '```'
    Note $perf.Trim()
    Note '```'
    Note '</details>'
  } catch {
    Note "Get-MpPerformanceReport: $($_.Exception.Message)"
  }
}

try {
  $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; StartTime = $messStart } -ErrorAction Stop |
    Sort-Object TimeCreated | ForEach-Object { "$($_.TimeCreated.ToString('HH:mm:ss.fff')) $($_.Id) $(($_.Message -split "`n")[0].Trim())" }
} catch {
  $ev = @("keine Ereignisse ($($_.Exception.Message))")
}
$ev | Set-Content (Join-Path $Out 'defender-ereignisse.txt')
Note ''
Note "<details><summary>Defender-Ereignisprotokoll seit Beginn der Messung ($(@($ev).Count) Einträge)</summary>"
Note ''
Note '```'
@($ev) | Select-Object -First 60 | ForEach-Object { Note $_ }
Note '```'
Note '</details>'

$report | Set-Content (Join-Path $Out 'bericht.md')
if ($env:GITHUB_STEP_SUMMARY) { $report | Add-Content $env:GITHUB_STEP_SUMMARY }
