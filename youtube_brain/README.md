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

# 3) 내 지식에 묻기(RAG) — 모은 영상들만 근거로 답
python -m youtube_brain ask "HBM 투자 포인트 정리해줘"

# 4) 검색 / 목록 / 통계
python -m youtube_brain search "부동산 금리"
python -m youtube_brain list
python -m youtube_brain stats

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

## 자동화 (GitHub Actions)

`.github/workflows/youtube-brain.yml` — **Actions 탭에서 수동 실행(workflow_dispatch)**.
`target`(링크/키워드)·`max`를 입력하면 수집 후 `knowledge.jsonl`을 커밋한다.

---

## 다음 단계(확장 아이디어)

- **대시보드 연동**: Next.js `app/`에 `/knowledge` 페이지를 만들어 `knowledge.jsonl`을 렌더.
- **자동 수집**: `curator`가 매일 고른 영상을 자동으로 `ingest`해 지식DB를 키운다.
- **주간 다이제스트**: 새로 쌓인 카드만 모아 이메일/노션으로.
