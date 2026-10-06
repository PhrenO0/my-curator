# neural-flow 설치 (Windows)
# PowerShell 에서 한 줄로:
#   irm https://raw.githubusercontent.com/PhrenO0/my-curator/main/neural-flow/desktop/scripts/install.ps1 | iex
#
# GitHub Releases 에서 가장 최신 'desktop-v*' 설치 파일을 받아 조용히 설치한다.
# 서명되지 않은 앱이라 처음 실행 때 SmartScreen 이 뜨면 [추가 정보] → [실행].

$ErrorActionPreference = 'Stop'
$repo = 'PhrenO0/my-curator'
Write-Host '🌊 neural-flow 설치를 시작합니다' -ForegroundColor Cyan

$releases = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=20" -Headers @{ 'User-Agent' = 'neural-flow-installer' }
$release = $releases | Where-Object { $_.tag_name -like 'desktop-v*' -and -not $_.draft } | Select-Object -First 1
if (-not $release) { throw '아직 배포된 설치 파일이 없어요. GitHub Actions 의 desktop-release 워크플로를 확인하세요.' }

$asset = $release.assets | Where-Object { $_.name -like '*win*x64*.exe' } | Select-Object -First 1
if (-not $asset) { throw "$($release.tag_name) 에 Windows 설치 파일이 없어요." }

$out = Join-Path $env:TEMP $asset.name
Write-Host "⬇️  $($release.tag_name) · $($asset.name) 받는 중..."
Invoke-WebRequest $asset.browser_download_url -OutFile $out -UseBasicParsing
Unblock-File $out

Write-Host '📦 설치 중...'
Start-Process -FilePath $out -ArgumentList '/S' -Wait
Remove-Item $out -ErrorAction SilentlyContinue

$exe = Join-Path $env:LOCALAPPDATA 'Programs\neural-flow\neural-flow.exe'
if (Test-Path $exe) {
  Start-Process $exe
  Write-Host '✅ 설치 완료! 트레이(시계 옆)에 물결 아이콘이 생겼어요. 처음엔 본인 구글 계정으로 로그인하세요.' -ForegroundColor Green
} else {
  Write-Host '✅ 설치 완료! 시작 메뉴에서 neural-flow 를 실행하세요.' -ForegroundColor Green
}
