#!/usr/bin/env bash
# 오늘(또는 지정한 날짜) 자 일기 파일을 TEMPLATE.md 기반으로 만든다.
# 사용법: ./diary/new.sh [YYYY-MM-DD]
set -euo pipefail

DIARY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE="${1:-$(date +%F)}"

if ! [[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "날짜 형식이 올바르지 않습니다: $DATE (YYYY-MM-DD)" >&2
  exit 1
fi

YEAR="${DATE:0:4}"
MONTH="${DATE:5:2}"
TARGET="$DIARY_DIR/$YEAR/$MONTH/$DATE.md"

if [[ -e "$TARGET" ]]; then
  echo "이미 있습니다: $TARGET"
  exit 0
fi

# 요일 번호(1=월 ~ 7=일). GNU date와 BSD(macOS) date 모두에서 동작하도록 분기한다.
if DOW=$(date -d "$DATE" +%u 2>/dev/null); then
  :
else
  DOW=$(date -j -f %Y-%m-%d "$DATE" +%u)
fi
DAYS=(월 화 수 목 금 토 일)
WEEKDAY="${DAYS[$((DOW - 1))]}"

mkdir -p "$(dirname "$TARGET")"
sed -e "s/{{DATE}}/$DATE/g" -e "s/{{WEEKDAY}}/$WEEKDAY/g" "$DIARY_DIR/TEMPLATE.md" > "$TARGET"

echo "$TARGET"
