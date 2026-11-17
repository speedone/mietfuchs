# Bestätigt den Druckdialog (klassisch oder Windows 11) über UI Automation, vorher ein Bildschirmfoto.
# Aufruf: confirm.ps1 <bild.png>
param([string]$Shot)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
$root = [System.Windows.Automation.AutomationElement]::RootElement
$deadline = (Get-Date).AddSeconds(40)
$button = $null
while (-not $button -and (Get-Date) -lt $deadline) {
  Start-Sleep 2
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
  foreach ($b in $buttons) { if ($b.Current.Name -in @('Print', 'Drucken')) { $button = $b; break } }
}
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($Shot)
if (-not $button) { 'kein Knopf „Print“ gefunden'; exit 1 }
# Fenster und Felder des Dialogs nennen (Papierformat, Skalierung …)
$win = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($button)
while ($win -and $win.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) { $win = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($win) }
if ($win) {
  "Dialog: $($win.Current.Name) ($($win.Current.ClassName))"
  foreach ($e in $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    $n = $e.Current.Name; if ($n) { "  $($e.Current.ControlType.ProgrammaticName): $n" }
  }
}
$pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$pattern.Invoke()
'bestätigt'
