#!/usr/bin/env bash
# neural-flow 설치 (macOS)
# 터미널에서 한 줄로:
#   curl -fsSL https://raw.githubusercontent.com/PhrenO0/my-curator/main/neural-flow/desktop/scripts/install.sh | bash
#
# GitHub Releases 에서 가장 최신 'desktop-v*' dmg(내 Mac 칩에 맞는 것)를 받아 /Applications 에 복사한다.
# 서명되지 않은 앱이라 다운로드 격리 표시(quarantine)를 지워야 열린다 — 아래에서 자동으로 한다.
set -euo pipefail

REPO="PhrenO0/my-curator"
ARCH="$(uname -m)" # arm64 | x86_64
[ "$ARCH" = "x86_64" ] && ARCH="x64"

echo "🌊 neural-flow 설치를 시작합니다 ($ARCH)"
URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=20" \
  | /usr/bin/python3 -c "
import json, sys
arch = sys.argv[1]
for r in json.load(sys.stdin):
    if r['tag_name'].startswith('desktop-v') and not r['draft']:
        for a in r['assets']:
            if a['name'].endswith('.dmg') and ('-' + arch + '.dmg') in a['name']:
                print(a['browser_download_url']); sys.exit(0)
sys.exit(1)
" "$ARCH")" || { echo "아직 배포된 macOS 설치 파일이 없어요."; exit 1; }

TMP="$(mktemp -d)"
trap 'hdiutil detach "$TMP/mnt" -quiet 2>/dev/null || true; rm -rf "$TMP"' EXIT
echo "⬇️  $(basename "$URL") 받는 중..."
curl -fL --progress-bar "$URL" -o "$TMP/nf.dmg"

hdiutil attach "$TMP/nf.dmg" -nobrowse -quiet -mountpoint "$TMP/mnt"
rm -rf "/Applications/neural-flow.app"
cp -R "$TMP/mnt/neural-flow.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/neural-flow.app" 2>/dev/null || true

open "/Applications/neural-flow.app"
echo "✅ 설치 완료! 메뉴 막대에 물결 아이콘이 생겼어요. 처음엔 본인 구글 계정으로 로그인하세요."
