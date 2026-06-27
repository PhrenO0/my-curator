# 📺 youtube_brain — 유튜브를 '내 지식'으로 만드는 파이프라인

> 유튜브 **링크나 키워드**를 주면 → 영상의 **내용을 읽어 요약**하고 →
> **SQLite 지식DB**에 쌓아, 나중에 **질문으로 다시 꺼내 쓰는(RAG)** 개인 제2의 뇌.

`curator`(뉴스 큐레이션) · `neural-flow`(삶 멘토링)와 같은 골격
(**SENSE → THINK → REMEMBER → ACT**, Python + Gemini, 키 없으면 폴백)으로 만들었다.

---

## 한눈에

```
링크/키워드 ─▶ SENSE          ─▶ THINK              ─▶ REMEMBER          ─▶ ASK
            (ingest.py)        (summarize.py)         (knowledge_base.py)   (pipeline.ask)
            메타+자막 수집      Gemini 요약(지식카드)   SQLite 저장+임베딩     의미검색→RAG 답변
```

- **입력 자유** — 단일 영상 링크 · **재생목록/채널 통째로** · 키워드 검색 모두 한 명령으로.
- **자막이 곧 영상의 내용** — `youtube-transcript-api`로 스크립트를 받아 요약하므로 "진짜 본 것"처럼 안다.
- **데이터베이스** — `knowledge.db`(SQLite, 쿼리 가능) + `knowledge.jsonl`(git 버전관리·자동복원).
- **다시 꺼내 쓰기** — `ask`로 내가 모은 영상들만 근거로 답(출처 번호 포함).

---

## 설치

```bash
pip install -r requirements.txt        # youtube-transcript-api 포함
```

## 사용법

```bash
# 1) 링크 한 개 — 키 없이도 자막만 있으면 동작(요약은 GOOGLE_API_KEY 있을 때 고품질)
python -m youtube_brain "https://youtu.be/VIDEO_ID"

# 2) 키워드 — 상위 영상들을 한꺼번에 (YOUTUBE_API_KEY 필요)
python -m youtube_brain "AI 반도체 전망" --max 3

# 2-1) 재생목록·채널 통째로 일괄 적재 (YOUTUBE_API_KEY 필요)
python -m youtube_brain "https://www.youtube.com/playlist?list=PLxxxx" --max 30
python -m youtube_brain "https://www.youtube.com/@channelhandle" --max 20

# 3) 내 지식에 묻기(RAG) — 모은 영상들만 근거로 답
python -m youtube_brain ask "HBM 투자 포인트 정리해줘"

# 4) 검색 / 목록 / 통계 / 주간 다이제스트(이메일)
python -m youtube_brain search "부동산 금리"
python -m youtube_brain list
python -m youtube_brain stats
python -m youtube_brain digest --days 7

# 5) 키·네트워크 없이 파이프라인 자가검증
python -m youtube_brain selftest
```

> 단축 실행: 저장소 루트에서 `python yt.py "키워드"` 도 동일하게 동작.

---

## 환경변수 (모두 선택 — 없으면 그만큼만 폴백)

| 변수 | 용도 | 없으면 |
|------|------|--------|
| `GOOGLE_API_KEY` | Gemini 요약 + `text-embedding-004` 의미검색·RAG | 휴리스틱 요약 + 키워드(FTS5/LIKE) 검색 |
| `YOUTUBE_API_KEY` | **키워드 검색**, 풍부한 메타(조회수·길이) | 링크 직접 입력만 가능, 메타는 oEmbed |
| `GEMINI_MODEL` | 요약 모델(기본 `gemini-2.5-flash`) | 기본값 |
| `SENDER_EMAIL`/`SENDER_PASSWORD` | `--email` 발송 | 미리보기 HTML 파일로 저장 |

기존 `curator.yml`의 시크릿을 그대로 재사용한다(새 키 0개).

---

## 지식 카드 스키마

각 영상은 아래 구조로 DB에 저장된다(검색·RAG의 단위):

`one_liner` · `tl_dr[]` · `summary` · `key_points[]` · `takeaways[]`(시사점) ·
`keywords[]` · `entities[]` · `category` · `quotes[]` · `embedding`

사용자 프로필(AI·노동시장·부동산·경제/금융·반도체·주식·창업, *분석·시사점 선호*)에 맞춰
**단순 요약이 아니라 시사점 중심**으로 정리한다.

---

## 파일 구조

```
youtube_brain/
├── config.py          # 공용: LLM·임베더·JSON파서·코사인·경로
├── ingest.py          # SENSE: 링크/키워드 → 메타 + 자막(신·구 API 모두 대응)
├── summarize.py       # THINK: Gemini map-reduce → 지식 카드 JSON (키 없으면 휴리스틱)
├── knowledge_base.py  # REMEMBER: SQLite + 임베딩 의미검색 + FTS5 + JSONL export/복원
├── pipeline.py        # 오케스트레이션 + ask()=내 지식 RAG
├── report.py          # ACT: 콘솔/마크다운/이메일 렌더
├── __main__.py        # CLI (ingest/ask/search/list/stats/selftest)
├── knowledge.jsonl    # ★ 누적된 지식(git 추적). DB가 없으면 여기서 복원
└── README.md
```

`knowledge.db`·미리보기 HTML 은 `.gitignore`. **`knowledge.jsonl` 이 정본 기록**이라
컨테이너가 새로 떠도 지식(임베딩 포함)이 복원된다.

---

## 연동된 곳 (이미 동작)

- **📊 대시보드** — `app/knowledge/page.tsx` (`/knowledge`). `knowledge.jsonl`을 읽어
  카드·카테고리 필터로 보여준다. 홈(`/`) 상단 `📺 유튜브 지식` 버튼으로 이동.
  (`next.config.ts`의 `outputFileTracingIncludes`로 Vercel 번들에 파일 포함)
- **🔎 대시보드 검색창(의미검색 + RAG)** — `/knowledge` 상단 검색창에 질문하면,
  저장된 임베딩에 질의 임베딩(Gemini REST)을 코사인 비교해 관련 영상을 찾고,
  그 근거로 한국어 답변(출처 [n] 포함)을 만든다. 키 없으면 키워드검색으로 폴백.
  (`app/knowledge/search.ts` — `GOOGLE_API_KEY`는 서버에서만 사용)
- **🤖 데일리 큐레이터 자동 적재** — `curator_bot.py`가 매일 큐레이션한 영상 중
  유튜브 링크를 자동으로 `ingest`해 지식DB를 키운다. `curator.yml`이 `knowledge.jsonl`을 커밋.
  끄려면 `YT_BRAIN_ARCHIVE=0`.
- **🕸️ 지식맵** — `app/knowledge/map/page.tsx` (`/knowledge/map`). 태그 클라우드 +
  공유 키워드로 본 영상 연결 그래프(서버 렌더 SVG).
- **📬 주간 다이제스트** — 최근 N일 새로 쌓인 지식을 카테고리별로 모아 이메일.
  `python -m youtube_brain digest --days 7` · `youtube-brain-digest.yml`이 일요일 19:00(KST) 발송.
- **📔 노션 연동** — 지식 카드를 노션 '📺 유튜브 지식' DB에 페이지로 적재(영상=한 페이지).
  `python -m youtube_brain notion [--days 7 | --all]` (`NOTION_TOKEN` 필요).
  대상 DB는 같은 제목으로 검색→없으면 자동 생성(중복 생성 방지). 부모는 기본 neural-flow 허브,
  `YT_BRAIN_NOTION_PARENT`/`YT_BRAIN_NOTION_DB` 로 지정 가능. `curator.yml`/`youtube-brain.yml`이
  토큰 있을 때 자동 동기화.

## 자동화 (GitHub Actions)

- `youtube-brain.yml` — **수동 실행**. `target`(링크/키워드)·`max` 입력 → 수집 → (노션) → 커밋.
- `youtube-brain-digest.yml` — **일요일 주간 다이제스트** 이메일(읽기 전용).
- `curator.yml` — 매일 큐레이션 영상 적재 + 노션 동기화.

---

## 다음 단계(확장 아이디어)

- **노션 양방향**: 노션에서 시청 메모를 달면 다시 지식DB로 가져오기.
- **태그 그래프 고도화**: entities/카테고리 가중치, 클러스터링.
