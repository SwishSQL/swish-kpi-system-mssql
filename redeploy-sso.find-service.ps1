# Prints the name of the NSSM Windows service whose AppDirectory is this folder
# (exact match first, then a service running a sub-folder, then a parent folder).
# Used by redeploy-sso.bat. Reads the registry only; changes nothing.
$here = $PSScriptRoot.TrimEnd('\')
$best = $null; $bestScore = 99
Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Services' -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Get-ItemProperty -Path (Join-Path $_.PSPath 'Parameters') -Name AppDirectory -ErrorAction SilentlyContinue
  if ($p -and $p.AppDirectory) {
    $d = ([string]$p.AppDirectory).Trim().TrimEnd('\')
    $score = 99
    if ($d -ieq $here) { $score = 0 }
    elseif ($d.Length -gt $here.Length -and $d.Substring(0, $here.Length + 1) -ieq ($here + '\')) { $score = 1 }
    elseif ($here.Length -gt $d.Length -and $here.Substring(0, $d.Length + 1) -ieq ($d + '\')) { $score = 2 }
    if ($score -lt $bestScore) { $bestScore = $score; $best = $_.PSChildName }
  }
}
if ($best) { Write-Output $best; exit 0 }
exit 1
