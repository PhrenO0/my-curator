# ⚙️ neural-flow 에이전트 켜기 (5분)

매일 07:00 / 일요일 20:00(KST)에 멘토링 브리핑을 이메일로 받기.

---

## Lv.1 — 지금 바로 (새 시크릿 0개)

curator 가 이미 쓰는 시크릿을 그대로 쓴다. GitHub repo → **Settings → Secrets and variables → Actions** 에 이미 있는지 확인:

- `GOOGLE_API_KEY` ✅ (Gemini)
- `SENDER_EMAIL` ✅ (Gmail 주소)
- `SENDER_PASSWORD` ✅ (Gmail 앱 비밀번호)
- `RECEIVER_EMAIL` (선택, 없으면 SENDER_EMAIL 로 받음)

→ 위가 있으면 **이미 준비 끝.** 워크플로는 push 되는 순간 cron 등록된다.

**바로 테스트:** repo → **Actions → "neural-flow mentoring agent" → Run workflow**
→ mode `daily` 로 실행 → 메일함 확인.

로컬 테스트:
```bash
pip install -r requirements.txt
GOOGLE_API_KEY=... SENDER_EMAIL=... SENDER_PASSWORD=... python neural-flow/agent.py
# 키 없이 돌리면 neural-flow/brief_preview.html 로 미리보기만 저장됨
```

---

## Lv.2 — Notion 라이브 연결 (선택, +5분)

에이전트가 활동 DB 를 실시간으로 읽고, 허브에 '오늘의 단 하나'를 기록하게 하려면:

1. https://www.notion.so/my-integrations → **New integration** 생성 → **Internal Integration Token** 복사.
2. Notion 에서 **🌊 neural-flow 허브 페이지** 열기 → 우상단 ··· → **Connections → 방금 만든 integration 연결**
   (하위 활동 DB 까지 권한이 상속된다).
3. GitHub Secrets 에 `NOTION_TOKEN` = 복사한 토큰 추가.

→ 끝. 다음 실행부터 `[SENSE] Notion 라이브 활동 N개 로드` 가 보이고,
허브 페이지에 매일 '오늘의 단 하나' 체크박스가 쌓인다.

---

## Lv.3 — 캘린더 자동 입력 (선택, 나중)

주간 추천을 실제 시간블록으로 자동 입력하려면 Google Calendar API 자격증명(OAuth refresh token)이 필요하다.
**지금은 안 해도 된다** — 주간 설계는 Claude + Calendar MCP 세션에서
`prompts/mentor-prompt.md` "주간 추천"으로 돌리면 무설정으로 된다.

---

## Lv.4 — 헤르메스 양방향 추적 (텔레그램, "그거 했어?")

진짜 '철저한 관리'. 매일 저녁 에이전트가 먼저 **"오늘의 단 하나 했어?"** 라고 묻고, 답을 노션에 기록한다.

**방법 A — 텔레그램 봇 푸시 (지금 코드로 됨):**
1. 텔레그램 `@BotFather` → `/newbot` → `TELEGRAM_BOT_TOKEN` 받기.
2. 만든 봇과 대화 시작 후 `@userinfobot` 에게 말 걸어 내 chat id 확인 → `TELEGRAM_CHAT_ID`.
3. GitHub Secrets 에 둘 다 추가.
→ 매일 07:00 '단 하나' / 22:00 '했어?' 가 텔레그램으로 온다 (`tg.py`).

**방법 B — 헤르메스 스킬/cron (대화형 기록까지):**
`prompts/hermes-tracking.md` 의 cron 3개(아침·저녁·주간)를 헤르메스에 등록.
헤르메스가 너의 '했어/못했어' 답을 받아 **노션 상태를 자동 갱신**한다 → REMEMBER 루프 완성.

> 푸시만 = A. 받아서 기록까지 = B(헤르메스). 같이 써도 된다.

---

## cron 시간 메모
- `0 22 * * *` (UTC) = **매일 07:00 KST** 데일리 브리핑
- `0 13 * * *` (UTC) = **매일 22:00 KST** 저녁 양방향 체크인
- `0 11 * * 0` (UTC) = **일요일 20:00 KST** 주간 추천+회고
