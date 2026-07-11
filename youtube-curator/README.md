# 🗂️ youtube-curator — 유튜브 → 옵시디언 → 노션(GTD)

유튜브 링크를 수집해서 **옵시디언 노트**로 만들고 **노션 GTD 대시보드**에 자동 등록하는 시스템.
neural-flow 와 같은 에이전트 루프(SENSE → THINK → ACT → REMEMBER)로 돈다.

```
┌─ 크롬 확장 (유튜브에서 원클릭) ─┐
├─ 헤르메스 워치리스트 (채널 RSS 자동) ─┼─▶ agent.py ─▶ vault/YouTube/*.md (옵시디언)
└─ inbox.json / 수동 실행 ─────────┘       │
                                           └─▶ 노션 📺 YouTube Curator DB (GTD 페이지)
```

- 📺 노션 대시보드: https://app.notion.com/p/9f6d921ba2664c2e8a9f737903c2c8d9 (GTD 페이지 하위에 생성됨)
- 옵시디언 노트: 이 저장소의 `vault/YouTube/` 폴더에 커밋됨

---

## 1. 크롬 확장프로그램 설치 (2분)

1. 크롬에서 `chrome://extensions` → 우측 상단 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드합니다** → 이 저장소의 `youtube-curator/extension` 폴더 선택
3. 확장 아이콘 → **⚙️ 설정**:
   - **옵시디언 볼트 이름**: 본인 볼트 이름 (좌측 하단에 표시되는 것과 동일하게)
   - **GitHub 토큰**: [Fine-grained PAT 발급](https://github.com/settings/personal-access-tokens/new)
     — 이 저장소만, `Contents: Read and write` 권한만

이후 **유튜브를 열면 우하단에 🗂️ 저장 버튼이 자동으로 뜬다.**
클릭 한 번으로: 옵시디언에 즉시 노트 생성 + GitHub 파이프라인 트리거(제목·채널 수집, 노션 등록).
링크에서 우클릭 → "🗂️ My Curator에 저장"도 된다. 팝업에서 링크 여러 개 붙여넣기도 가능.

## 2. GitHub Secrets (노션·Gemini 연동)

저장소 Settings → Secrets and variables → Actions:

| Secret | 용도 | 필수 |
|---|---|---|
| `NOTION_TOKEN` | 노션 DB 동기화 ([발급](https://www.notion.so/my-integrations) 후 GTD 페이지에 통합 연결) | 권장 |
| `GOOGLE_API_KEY` | Gemini 로 9개 영역 자동 분류 + 한줄요약 | 선택 |

없어도 죽지 않는다 — 해당 단계만 조용히 스킵한다 (neural-flow 원칙).

## 3. 헤르메스 자동 수집

`config.json` 의 `hermes.watchlist` 에 채널을 추가하면 매일 06:00/21:00 KST 에 자동 수집:

```json
{ "name": "채널이름", "channel_id": "UCxxxxxxxxxxxxxxxxxxxxxx", "keywords": ["AI"], "enabled": true }
```

- `channel_id` 는 채널 페이지 소스에서 `channel_id=` 검색, 또는 채널 → 공유 → ID 복사
- `keywords` 를 두면 제목에 해당 단어가 있는 영상만 수집 (비우면 전부)
- API 키 불필요 (유튜브 공식 RSS 사용)
- 텔레그램 대화형 저장/주간 소화 체크는 `prompts/hermes-youtube.md` 를 헤르메스에 주입

## 4. 옵시디언 볼트 동기화

파이프라인이 만든 노트(`vault/YouTube/*.md`)를 내 볼트로 가져오는 두 가지 방법:

- **A. obsidian-git 플러그인(권장)**: 볼트에서 커뮤니티 플러그인 `Git` 설치 → 이 저장소를 볼트(또는 볼트 하위 폴더)로 클론 → 자동 pull 설정. 파이프라인이 커밋할 때마다 노트가 볼트에 나타난다.
- **B. 확장프로그램 직접 저장만 사용**: 설정에서 저장 방식을 "옵시디언만"으로 — 로컬에 즉시 생성되지만 노션 동기화·자동 분류는 빠진다.

노트 형식 (frontmatter 에 영역·태그·상태가 있어 Dataview 쿼리 가능):

```markdown
---
title: "영상 제목"
channel: "채널명"
url: https://www.youtube.com/watch?v=...
domain: "📚 지성·성장"
tags: [youtube, AI]
status: inbox
---
```

## 5. 수동 실행

```bash
python youtube-curator/agent.py                 # inbox + 워치리스트 처리
YT_URLS="https://youtu.be/..." python youtube-curator/agent.py
python youtube-curator/agent.py --backfill      # 노션의 '(제목 수집 대기)' 행 채우기
```

또는 GitHub → Actions → **YouTube Curator** → Run workflow (URL 직접 입력 가능).

## 상태 흐름 (노션)

📥 수집됨 → 👀 볼 것 → ✅ 시청완료 → 📝 노트작성

수집만 하고 안 보면 지식이 아니다 — 헤르메스 주간 체크(스킬 3)가 방치된 영상을 물어본다.
