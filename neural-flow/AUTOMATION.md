# neural-flow — 아침 브리핑 자동화

목표: 매일 아침 "오늘의 단 하나"가 **자동으로** 도착하게 한다.
정직하게: 완전 자동화는 **항상 켜져 있는 호스트**가 필요하다. 옵션을 좋은 것부터 정리한다.

---

## ⭐ 옵션 0 — 이미 켜져 있음 (구글 캘린더 알림)

세팅하면서 만든 **🙏 아침 QT·기도(매일 07:00)** / **🌙 저녁 회개(매일 22:40)** 반복 일정이
이미 핸드폰으로 매일 푸시된다. 가장 간단한 자동화는 이미 작동 중. 추가 작업 0.

---

## ⭐ 옵션 1 — 헤르메스 텔레그램 cron (추천)

준상이 이미 쓰는 **지속 실행 에이전트**라 자동화에 가장 적합하다 (커리어 마스터플랜 5번 참고).
`prompts/daily-brief-prompt.md` 의 내용을 cron 프롬프트로 넣는다:

```bash
hermes cron add --name neural-flow-brief --schedule "0 7 * * *" \
  --prompt "neural-flow 아침 브리핑: 오늘 캘린더와 활동 백로그를 읽고 '오늘의 단 하나' 1개,
            고정일정, 마감 카운트다운, 거룩 한 줄, AI·마케팅 트렌드 한 줄을 텔레그램으로 보내줘.
            과확장 금지, 단 하나는 무조건 1개."
```

> 헤르메스가 노션/캘린더에 직접 접근 못 하면, 매주 일요일 Claude(MCP)로 '주간 추천'을 돌려
> 캘린더에 시간블록을 박아두고, 헤르메스는 그 캘린더만 읽어 매일 아침 브리핑하게 한다.

---

## 옵션 2 — Claude Code 세션에서 수동/반자동

MCP 연결된 Claude 세션에서 매일 아침 `daily-brief-prompt.md` 를 실행.
또는 `/loop` 스킬로 세션이 열려 있는 동안 주기 실행.

⚠️ **한계:** Claude Code 웹의 원격 실행 환경은 *임시 컨테이너*다. 세션이 닫히면 사라지므로
**매일 자동 발송에는 부적합**. 지속 자동화는 옵션 1(헤르메스)이나 옵션 3(Actions)으로.

---

## 옵션 3 — GitHub Actions cron (지속 호스트, 셋업 필요)

이 repo는 이미 GitHub에 있으니, 스케줄 워크플로우로 매일 돌릴 수 있다.
단, Actions는 MCP를 못 쓰므로 **Notion API 토큰 + Google Calendar API 자격증명**을 시크릿으로 넣고
작은 스크립트가 직접 API를 호출해야 한다. (간편함과는 거리가 있어 옵션 1을 먼저 권장.)

스케치:

```yaml
# .github/workflows/neural-flow-brief.yml
name: neural-flow morning brief
on:
  schedule:
    - cron: "0 22 * * *"   # UTC 22:00 = KST 07:00
  workflow_dispatch:
jobs:
  brief:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: python neural-flow/scripts/brief.py   # Notion+Calendar API 직접 호출
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          GOOGLE_SA_JSON: ${{ secrets.GOOGLE_SA_JSON }}
          TELEGRAM_TOKEN: ${{ secrets.TELEGRAM_TOKEN }}
```

`brief.py` 는 추후 필요할 때 작성. (지금은 옵션 0+1로 충분.)

---

## 추천 조합

1. **지금 당장:** 옵션 0 (캘린더 알림, 이미 켜짐).
2. **이번 주:** 옵션 1 (헤르메스 cron) 한 줄 등록.
3. **매주 일요일:** Claude(MCP)로 `mentor-prompt.md` "주간 추천" 1회 → 다음 주 시간블록 확정.
