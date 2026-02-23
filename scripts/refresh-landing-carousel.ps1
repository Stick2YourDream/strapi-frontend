$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot '..\public\landing-carousel'
$dest = (Resolve-Path $dest).Path
$queries = @('happy%20people','smiling%20people','laughing%20people')
$all = @()
foreach ($q in $queries) {
  $url = "https://www.pexels.com/search/$q/"
  $html = (Invoke-WebRequest -Uri $url -Headers @{ 'User-Agent'='Mozilla/5.0' }).Content
  $matches = [regex]::Matches($html, 'https://images\.pexels\.com/photos/\d+/[^"\s?]+')
  $all += ($matches.Value | Select-Object -Unique)
}
$urls = $all | Select-Object -Unique
if ($urls.Count -lt 20) {
  throw "Only found $($urls.Count) candidate images"
}
$selected = $urls | Select-Object -First 20
for ($i = 1; $i -le 20; $i++) {
  $n = '{0:D2}' -f $i
  $uri = ($selected[$i-1]).Trim()
  $out = Join-Path $dest ("happy-$n.jpg")
  Invoke-WebRequest -Uri $uri -OutFile $out -Headers @{ 'User-Agent'='Mozilla/5.0' }
}
Get-ChildItem $dest -Filter 'happy-*.jpg' | Sort-Object Name | Select-Object Name, Length
