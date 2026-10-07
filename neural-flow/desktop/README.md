# 🌊 neural-flow desktop

바탕화면에 붙어 있는 **반투명 캘린더 위젯** + **구글 캘린더 연동 일정 관리** + **언제든 입력** +
**아침 브리핑 / 최신 정보 / 영어 회화**를 PC 안에서 알아서 돌리는 개인 비서 앱.
`neural-flow`의 파이썬 에이전트(`agent.py`) 루프를 데스크탑으로 옮겼다.

```
SENSE    구글 캘린더 · 앱 일정 · 활동 보드 · RSS 뉴스 · state.json(비전)
THINK    노트북의 Claude Code(내 구독) 또는 Gemini — 없으면 규칙 기반
ACT      바탕화면 위젯 · 빠른 입력 · 시스템 알림 · 구글 캘린더에 일정 쓰기
REMEMBER 로컬 JSON (단 하나 실행 기록 → 다음 추천 보정)
```

## 노트북에 설치

main 에 데스크탑 앱 변경이 머지되면 GitHub Actions 가 설치 파일을 만들어
[Releases](https://github.com/PhrenO0/my-curator/releases) 의 `desktop-v*` 에 올린다.

**Windows** (PowerShell)
```powershell
irm https://raw.githubusercontent.com/PhrenO0/my-curator/main/neural-flow/desktop/scripts/install.ps1 | iex
```

**macOS** (터미널)
```bash
curl -fsSL https://raw.githubusercontent.com/PhrenO0/my-curator/main/neural-flow/desktop/scripts/install.sh | bash
```

- 코드 서명 인증서가 없는 개인용 빌드다. Windows 는 처음 실행 때 SmartScreen 이 뜨면 **추가 정보 → 실행**.
  macOS 스크립트는 다운로드 격리 표시를 지워서 바로 열리게 한다.
- 설치 후 로그인 시 자동 실행 (설정 → 자동 비서 스케줄에서 끌 수 있음).

**소스에서 바로 실행** (개발용, Node.js 22 이상)
```bash
cd neural-flow/desktop
npm install
npm start          # 위젯 + 트레이
npm run dist       # 이 PC 용 설치 파일을 dist/ 에 만들기
```

## 처음 시작: 두 가지 중 하나

**간편 모드 (설정 없음)** — 잠금 화면에 구글 캘린더의 'iCal 비공개 주소'만 붙여넣으면 바로 시작한다.
로그인 없이 일정을 읽기만 하고, 빠른 입력은 앱 안에 저장된다.

**구글 로그인 (일정 쓰기까지)** — 아래 클라이언트를 한 번만 만들어 GitHub 저장소 비밀값
`NF_GOOGLE_CLIENT_ID` · `NF_GOOGLE_CLIENT_SECRET` 에 넣어 두면, 다음 릴리스부터 설치 파일에 구워져서
모든 기기에서 'Google 계정으로 로그인' 버튼만 누르면 된다.
(데스크톱 앱 유형의 클라이언트 비밀은 구글 기준으로도 기밀이 아니라서 공개 설치 파일에 들어가도 되지만,
OAuth 동의 화면의 테스트 사용자를 본인만 두면 다른 사람은 로그인 자체가 안 된다.)

## 구글 로그인 클라이언트 만들기 (한 번만)

앱은 **허용된 구글 계정으로 로그인해야** 열린다. 허용 계정 기본값은 `neural-flow/config.json` 의
`userEmail`. 다른 계정으로 로그인하면 거부하고 토큰을 즉시 폐기한다.
로그인한 계정의 구글 캘린더를 그대로 읽고 쓴다.

1. [Google Cloud 콘솔](https://console.cloud.google.com/) → 프로젝트 선택 (기존 Gmail OAuth 프로젝트가 있으면 재사용 가능)
2. API 및 서비스 → 라이브러리 → **Google Calendar API** 사용 설정
3. OAuth 동의 화면 → 외부 · **테스트 사용자에 본인 이메일 추가**
4. 사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 유형 **데스크톱 앱**
5. 앱 잠금 화면에 클라이언트 ID·보안 비밀을 붙여넣고 **Google 계정으로 로그인**

- 보안 비밀·리프레시 토큰은 OS 키체인(Windows DPAPI · macOS 키체인)으로 암호화해 저장한다.
- 잠겨 있는 동안 위젯은 시계만 보여주고, 일정·활동 같은 개인 데이터는 화면에 보내지 않는다.
- 이건 **앱 잠금**이다. 데이터 파일 자체를 암호화하지는 않는다 (같은 PC 계정의 다른 프로그램은 파일을 읽을 수 있음).

## 언제든 입력

| 어디서 | 방법 |
|--------|------|
| 어디서든 | `Ctrl+Shift+Space` (macOS `⌘⇧Space`) → Spotlight 같은 입력창 |
| 위젯 | 시계 옆 `＋` 버튼 |
| 관리 창 | 모든 화면 맨 위 입력 바 |

한 줄을 적고 **Enter → 미리보기 → Enter → 추가**. 확인 없이 바로 넣지 않는다.

| 입력 예 | 결과 |
|---------|------|
| `내일 오후 3시 커피챗 강남 2시간` | 구글 캘린더 일정 (10/7 15:00–17:00) |
| `다음주 수요일 저녁 7시 반 스터디` | 구글 캘린더 일정 |
| `포트폴리오 케이스 정리` | 활동 보드 (승인됨) |
| `!자소서 1문항 끝내기` | 오늘의 단 하나 |
| `메모: 위젯 아이디어` | 메모 |

AI 엔진이 있으면 AI 가 해석하고, 없거나 실패하면 한국어 규칙 파서가 날짜·시각·기간을 읽는다.

## AI 엔진 — "이 세션을 엔진으로 쓸 수 있나?"

| 엔진 | 방식 | 비용 |
|------|------|------|
| **Claude Code** (자동 우선) | 노트북에 설치된 `claude` CLI 를 헤드리스(`claude -p`)로 호출 | 내 Claude 구독 사용량 |
| Gemini | `GOOGLE_API_KEY` (기존 neural-flow 와 같은 키) | Gemini API |
| 규칙 | 호출 없음 | 0 |

- 클라우드에서 돌던 Claude Code 세션을 앱이 실시간 엔진으로 직접 부를 수는 없다.
  대신 **같은 Claude Code 를 노트북에 설치해 로그인해 두면**, 앱이 그것을 엔진으로 쓴다.
  설치: [Claude Code 문서](https://code.claude.com/docs) → 터미널에서 `claude` 한 번 실행해 로그인.
- 앱은 빈 임시 폴더에서 `--permission-mode dontAsk` 로 부르고 JSON 결과만 받는다.
- 설정 → AI 엔진에서 자동 / Claude Code / Gemini / 끄기 를 고른다.

## 바탕화면 고정 · Win+D

| OS | 방식 |
|----|------|
| **Windows** | 위젯은 포커스를 받지 않아 클릭해도 다른 창 위로 올라오지 않는다. **Win+D 대응**: 위젯의 소유자를 바탕화면 창(Progman)으로 지정하고, 바탕화면이 앞으로 나오면 위젯을 활성화 없이 다시 띄우는 감시를 함께 돌린다 (koffi 로 user32 호출). |
| **macOS / Linux** | `type:'desktop'` 으로 바탕화면 레벨에 고정 (Electron 문서상 마우스 입력은 받지 않음 → 편집 모드 `⌘⌥N` 나 관리 창에서 조작). macOS '데스크탑 보기'에서도 남을 것으로 예상하지만 실기기로 확인하지는 못했다. |

- 편집 모드 `Ctrl+Alt+N` / `⌘⌥N`: 위젯을 끌어서 옮기기. 클릭 통과 모드: 트레이 메뉴.
- 관리 창 `Ctrl+Alt+M` / `⌘⌥M`.

## 화면

| 화면 | 내용 |
|------|------|
| 바탕화면 위젯 | 시계 · D-day · 오늘의 단 하나 · 월 달력(캘린더 색 점) + 선택한 날 일정 · English/뉴스 |
| 오늘 | 단 하나, 멘토 브리핑, 7일 실행 스트릭, 오늘 일정(구글 포함), 다가오는 마감 |
| 캘린더 | 월 그리드, 구글 일정(클릭 → 구글 캘린더에서 열기), 새 일정 저장 위치 선택(구글/앱) |
| 활동 보드 | 제안됨→승인됨→예정됨→진행중→완료/보류 칸반 |
| 브리핑 | RSS 뉴스 + AI 요약, 오늘의 영어 표현 + 발음 |
| 설정 | 계정(허용 계정·표시할 캘린더·저장 캘린더) · AI 엔진 · 뉴스 · 위젯 · 스케줄 |

디자인: 토스(TDS) 그레이 스케일 + 토스 블루, iOS 스위치·세그먼트, 테두리 없는 큰 라운드 카드.
폰트는 한글 Pretendard, macOS 에서는 숫자·영문에 SF Pro.

## 테스트

```bash
npm test            # 단위 테스트 (일정 계산·입력 파서·엔진·구글 API 매핑·저장소·스케줄러)
npm run test:e2e    # 실제 Electron 앱을 띄워 로그인→캘린더→입력→엔진→위젯까지 검증
NF_SHOT_DIR=./shots npm run test:e2e   # 화면 캡처도 저장
```

E2E 는 가짜 구글(OAuth·캘린더)·Gemini·RSS 서버와 가짜 `claude` CLI 를 로컬에 띄워 네트워크 없이 돈다.
PR 마다 `.github/workflows/desktop-ci.yml` 이 **Ubuntu · Windows · macOS** 에서 돌리고
(Windows 에서는 실제 '바탕화면 보기'를 일으켜 위젯이 남는지 확인), 설치 파일 빌드도 시험한다.

## 파일 구조

```
desktop/
├── main/
│   ├── main.js          ← 창·트레이·IPC·잠금·작업(Job)
│   ├── google.js        ← 구글 로그인(PKCE 루프백) + 캘린더 읽기·쓰기
│   ├── input.js         ← 언제든 입력: 한국어 규칙 파서 + AI 해석
│   ├── llm.js           ← 엔진: Claude Code CLI / Gemini / 끄기
│   ├── win-desktop.js   ← Windows Win+D 대응 (koffi → user32)
│   ├── brain.js         ← 브리핑·영어·뉴스 요약 (agent.py 포팅)
│   ├── store.js         ← 로컬 JSON 저장소 + state.json 시드
│   ├── calendar.js · news.js · scheduler.js · english-fallback.js
├── preload.js           ← 화면에 노출하는 최소 API (contextIsolation + sandbox)
├── renderer/{shared,widget,app,quick}
├── scripts/install.ps1 · install.sh
└── test/                ← 단위 + e2e
```

데이터 파일: Electron `userData` 폴더의 `neural-flow.json`
(Windows `%APPDATA%/neural-flow-desktop`, macOS `~/Library/Application Support/neural-flow-desktop`).

## 참고한 오픈소스 (UI/UX)

- **Übersicht** (macOS HTML 데스크탑 위젯) · **Rainmeter** (Windows 스킨: 고정·클릭 통과·편집 모드)
- **shadcn/ui · Radix Colors** (토큰 구조), **Lucide** 아이콘(ISC), **Pretendard** 폰트(OFL)
