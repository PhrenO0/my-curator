# 🌊 neural-flow desktop

바탕화면에 붙어 있는 **반투명 캘린더 위젯** + **일정·활동 관리** + **아침 브리핑 / 최신 정보 / 영어 회화**를
PC 안에서 알아서 돌리는 로컬 비서 앱. `neural-flow`의 파이썬 에이전트(`agent.py`)와 같은 루프를
데스크탑으로 옮겼다.

```
SENSE   일정(로컬+구글 ICS) · 활동 보드 · RSS 뉴스 · state.json(비전)
THINK   Gemini — agent.py 와 같은 프롬프트, 키 없으면 규칙 기반 폴백
ACT     바탕화면 위젯 · 시스템 알림 · 관리 창
REMEMBER 로컬 JSON (단 하나 실행 기록 → 다음 추천 보정)
```

## 실행 (5분)

```bash
cd neural-flow/desktop
npm install
npm start          # 위젯 + 트레이 아이콘이 뜬다
npm run dev        # 관리 창까지 바로 열기
```

- Node.js 22 이상 필요 (node-ical 요구사항).
- 처음 실행하면 `../state.json`에서 비전·9개 영역·활동·고정일정·데일리 앵커를 가져온다.
- **Gemini 키**: 관리 창 → 설정 → AI. 기존 `GOOGLE_API_KEY` 환경변수나 repo 루트 `.env`가 있으면 자동으로 쓴다.
  키가 없어도 앱은 동작한다(규칙 기반 '단 하나' + 기본 영어 표현집 21개).
- **구글 캘린더**: 설정 → 구글 캘린더 → 'iCal 형식의 비공개 주소'를 붙여넣기 (읽기 전용, 30분마다 동기화).

## 화면

| 화면 | 내용 |
|------|------|
| **바탕화면 위젯** | 시계 · D-day 칩 · 오늘의 단 하나(체크) · 월 달력(영역 색 점) + 선택한 날 일정 · English/뉴스 탭 |
| 오늘 | 단 하나 히어로 카드, 멘토 브리핑(거룩 한 줄·코칭·트렌드), 7일 실행 스트릭, 오늘 일정, 다가오는 마감 |
| 캘린더 | 월 그리드, 날짜 선택 패널, 더블클릭으로 추가, 반복(매일/평일/매주/매월), D-day 표시 |
| 활동 보드 | 제안됨→승인됨→예정됨→진행중→완료/보류 칸반(드래그). 날짜를 정하면 '예정됨'으로 캘린더에 올라감 |
| 브리핑 | RSS 뉴스 + AI 3줄 요약/오늘 읽을 1개, 오늘의 영어 표현 + 대화문 + 발음 듣기(OS 음성) + 복습 |
| 설정 | AI 키·모델, ICS 주소, RSS 피드, 위젯 불투명도·너비·테마·카드 선택·클릭 통과, 자동 스케줄, 자동 실행 |

## 자동 비서 스케줄 (GitHub Actions cron → 로컬)

| 시각(기본) | 하는 일 |
|------|------|
| 07:00 | 브리핑 생성 → 오늘의 단 하나 + 영어 표현 → 알림. **PC가 꺼져 있었다면 켜질 때 바로 따라잡음** |
| 22:00 | 단 하나를 아직 안 끝냈으면 저녁 체크인 알림 |
| 일 20:00 | 주간 추천 → 활동 보드에 **'제안됨'으로만** 추가 (승인 게이트 유지) |
| 3시간마다 | RSS 뉴스 새로고침 (+ 키가 있으면 요약) |
| 30분마다 | 구글 캘린더 ICS 동기화 |

## 바탕화면 고정 방식 (OS별로 다름 — 중요)

| OS | 고정 모드 | 조작 |
|----|-----------|------|
| **Windows** | 포커스를 받지 않는 창(`focusable:false`) → 클릭해도 다른 창 위로 올라오지 않음 | 위젯에서 바로 체크·탭 전환 가능 |
| **macOS / Linux** | `type:'desktop'` → 바탕화면 레벨에 고정 | Electron 문서상 이 타입은 **마우스 입력을 받지 않음**. 조작은 편집 모드(⌘⌥N)나 관리 창에서 |

- **편집 모드** (`Ctrl+Alt+N` / `⌘⌥N`, 트레이 메뉴): 위젯을 끌어서 옮기고 직접 조작. 끝나면 '고정'.
- **클릭 통과** (트레이 메뉴 / 설정): 위젯이 마우스를 완전히 무시 → 순수 배경처럼.
- `Ctrl+Alt+M` / `⌘⌥M`: 관리 창 열기.

알려진 한계:
- Windows에서 **Win+D(바탕화면 보기)** 를 누르면 위젯도 함께 숨겨진다. 바탕화면 레이어(WorkerW)에 직접 박는
  방식(Lively Wallpaper 방식)은 네이티브 모듈이 필요해서 이번 버전에서는 뺐다.
- 창 배경의 '진짜' 블러(Windows 아크릴·macOS 비브런시)는 쓰지 않았다. 투명 창 + 반투명 카드로 처리.
- Windows·macOS 실기기에서는 아직 테스트하지 않았다 (개발 환경은 Linux + 가상 디스플레이).

## 참고한 오픈소스 (UI/UX)

- **Übersicht** (macOS, HTML 데스크탑 위젯) — 웹 기술로 바탕화면 위에 위젯을 얹는 구조
- **Rainmeter** (Windows 데스크탑 스킨) — '바탕화면에 고정 / 클릭 통과 / 위치 편집' 모드 구분
- **Lively Wallpaper** (Windows) — 바탕화면 레이어 고정의 한계와 향후 방향
- **shadcn/ui · Radix Colors** — 중립 팔레트, 토큰 기반 라이트/다크, 버튼·배지·세그먼트 컨트롤
- **Lucide** (ISC) — 아이콘 · **Pretendard** (OFL) — 한글 본문 폰트

## 파일 구조

```
desktop/
├── main/
│   ├── main.js        ← 창·트레이·IPC·작업(Job) — 앱의 뼈대
│   ├── store.js       ← 로컬 JSON 저장소 + state.json 시드
│   ├── brain.js       ← THINK: Gemini REST + 폴백 (agent.py 포팅), 영어·뉴스 요약
│   ├── english-fallback.js ← 키 없을 때 쓰는 커리어 영어 표현 21개
│   ├── calendar.js    ← 구글 캘린더 ICS (node-ical, 반복 일정 펼침)
│   ├── news.js        ← RSS 수집 (rss-parser)
│   └── scheduler.js   ← 30초 틱 스케줄러 (따라잡기 포함)
├── preload.js         ← 화면에 노출하는 최소 API (contextIsolation + sandbox)
├── renderer/
│   ├── shared/        ← 디자인 토큰, 일정 계산(agenda.js, 메인과 공용), 아이콘, 헬퍼
│   ├── widget/        ← 바탕화면 위젯
│   └── app/           ← 관리 창
└── assets/            ← 앱·트레이 아이콘
```

데이터 파일 위치: Electron `userData` 폴더의 `neural-flow.json`
(Windows `%APPDATA%/neural-flow-desktop`, macOS `~/Library/Application Support/neural-flow-desktop`).

## 테스트

```bash
npm test            # 단위 테스트 22개 (일정 계산·브리핑 폴백·Gemini 파싱·ICS·저장소·스케줄러)
npm run test:e2e    # 실제 Electron 앱을 띄워 IPC 경로 21개 검증 (가짜 Gemini·ICS·RSS 로컬 서버, 네트워크 불필요)
NF_SHOT_DIR=./shots npm run test:e2e   # 화면 캡처도 저장
```

Linux 에서 화면이 없으면 `xvfb-run -a npm run test:e2e`. PR 마다 `.github/workflows/desktop-ci.yml` 이 같은 순서로 돌린다.

## 배포용 설치 파일 만들기 (선택)

로그인 자동 실행은 Windows는 개발 실행(`npm start`)에서도 동작하고, macOS는 설치 파일로 패키징해야 동작한다.

```bash
npx electron-builder --win   # 또는 --mac
```
