"""
youtube_brain · 2단계 THINK — Gemini 로 '영상의 내용'을 지식 카드로
==================================================================
자막(긴 경우 map-reduce 로 분할요약→통합)을 받아 구조화된 '지식 카드' JSON 을 만든다.
사용자 프로필(AI·노동시장·부동산·경제/금융·반도체·주식·창업, '분석·시사점' 선호)에 맞춰
단순 받아쓰기가 아니라 핵심·시사점 중심으로 정리한다.

GOOGLE_API_KEY 가 없으면 휴리스틱(추출 요약)으로라도 카드를 만들어 **저장은 되게** 한다.
"""

import os
import re
from collections import Counter

from .config import get_llm, loads_json

CHUNK_CHARS = 9000     # map 단계 청크 크기(토큰 안전선)
MAP_TRIGGER = 12000    # 본문이 이보다 길면 map-reduce
MAX_CHUNKS = 12        # 비용 폭주 방지(초과 시 균등 샘플링)

PROFILE = (
    "[사용자 관심사] AI, 노동시장 변화, 부동산, 경제/금융, 혁신기술, AI 반도체/메모리, 주식/증권, 창업. "
    "단순 요약이 아니라 '분석과 시사점' 중심. 투자·커리어 함의가 있으면 반드시 짚는다."
)

CARD_SPEC = '''아래 JSON 스키마(키 고정, 값은 한국어)로만 출력하라. 코드펜스·설명문 금지:
{
  "one_liner": "이 영상을 한 줄로",
  "tl_dr": ["가장 중요한 핵심 3~5개(각 한 문장)"],
  "summary": "구조화된 상세 요약(2~4문단). 영상이 실제로 말한 내용에 충실히.",
  "key_points": ["구체적 사실·주장·데이터 포인트"],
  "takeaways": ["내(사용자)가 적용·행동할 시사점. 투자·커리어 함의 포함"],
  "keywords": ["검색용 태그 5~10개"],
  "entities": ["언급된 인물·기업·제품·기관·개념"],
  "category": "한 단어 분류(예: AI/경제/부동산/창업/반도체/주식/기타)",
  "quotes": ["인상적인 직접 인용 0~3개(없으면 빈 배열)"]
}'''

_LIST_KEYS = ["tl_dr", "key_points", "takeaways", "keywords", "entities", "quotes"]
_STR_KEYS = ["one_liner", "summary", "category"]
_STOP = set("그리고 그래서 하지만 그런데 그러나 이런 저런 그런 정말 너무 약간 우리 저는 제가 "
            "the and for that this with you your are was were have has".split())


def summarize_video(meta, transcript_text, llm=None):
    """영상 메타 + 자막 → 정규화된 지식 카드(dict)."""
    llm = llm if llm is not None else get_llm()
    title = meta.get("title", "")
    desc = meta.get("description", "")
    body = transcript_text or ""
    note = ""
    if not body:
        body, note = desc, "자막 없음 — 제목/설명 기반(정확도 낮음)"

    if llm is None:
        card, engine, model = _heuristic_card(title, body), "heuristic", ""
    else:
        try:
            card = _map_reduce(title, body, llm) if len(body) > MAP_TRIGGER else _summarize_once(title, desc, body, llm)
            engine, model = "gemini", os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        except Exception as e:
            print(f"[summarize] LLM 요약 실패 → 휴리스틱 폴백: {e}")
            card, engine, model = _heuristic_card(title, body), "heuristic-fallback", ""

    card = _normalize_card(card)
    card["engine"], card["model"] = engine, model
    if note:
        card["note"] = note
    return card


def _summarize_once(title, desc, body, llm):
    prompt = f"""너는 사용자의 지식 큐레이터다. 아래 유튜브 영상의 '내용'을 분석한다.
{PROFILE}

[영상 제목] {title}
[설명] {desc[:500]}
[자막/본문]
{body[:CHUNK_CHARS * 2]}

{CARD_SPEC}"""
    return loads_json((llm.invoke(prompt).content or "").strip())


def _map_reduce(title, body, llm):
    chunks = _chunk(body, CHUNK_CHARS)
    if len(chunks) > MAX_CHUNKS:  # 너무 길면 균등 샘플링(비용 한도)
        step = len(chunks) / MAX_CHUNKS
        chunks = [chunks[int(i * step)] for i in range(MAX_CHUNKS)]
        print(f"[summarize] 자막이 매우 길어 {MAX_CHUNKS}개 구간으로 샘플링")
    partials = []
    for i, ch in enumerate(chunks):
        p = (f"유튜브 영상 '{title}'의 자막 일부(파트 {i + 1}/{len(chunks)})다. "
             f"이 부분의 핵심을 한국어 불릿 5~8개로 압축하라(사실·주장·수치 위주):\n\n{ch}")
        try:
            partials.append((llm.invoke(p).content or "").strip())
        except Exception as e:
            print(f"[summarize] 청크 {i + 1} 실패: {e}")
    combined = "\n".join(partials)
    prompt = f"""너는 사용자의 지식 큐레이터다. 아래는 긴 유튜브 영상 '{title}'을
부분별로 요약한 노트다. 이를 종합해 최종 지식 카드를 만든다.
{PROFILE}

[부분 요약 노트]
{combined[:CHUNK_CHARS * 2]}

{CARD_SPEC}"""
    return loads_json((llm.invoke(prompt).content or "").strip())


def _chunk(text, size):
    words, chunks, cur, cur_len = text.split(" "), [], [], 0
    for w in words:
        cur.append(w)
        cur_len += len(w) + 1
        if cur_len >= size:
            chunks.append(" ".join(cur))
            cur, cur_len = [], 0
    if cur:
        chunks.append(" ".join(cur))
    return chunks or [text]


def _heuristic_card(title, body):
    """LLM 없이도 카드를 만든다 — 앞 문장 추출 + 단어빈도 키워드."""
    sents = [s.strip() for s in re.split(r"(?<=[.!?。])\s+|\n+", body) if len(s.strip()) > 10]
    words = re.findall(r"[가-힣]{2,}|[A-Za-z]{3,}", body.lower())
    keywords = [w for w, _ in Counter(w for w in words if w not in _STOP).most_common(10)]
    return {
        "one_liner": title or (sents[0] if sents else ""),
        "tl_dr": sents[:5],
        "summary": " ".join(sents[:8]) or "(요약할 본문이 부족합니다)",
        "key_points": sents[:5],
        "takeaways": [],
        "keywords": keywords,
        "entities": [],
        "category": "기타",
        "quotes": [],
    }


def _normalize_card(card):
    """모든 키 존재·타입 보장(리스트/문자열)."""
    card = dict(card or {})
    for k in _LIST_KEYS:
        v = card.get(k, [])
        if isinstance(v, str):
            v = [v] if v.strip() else []
        elif not isinstance(v, list):
            v = []
        card[k] = [str(x).strip() for x in v if str(x).strip()]
    for k in _STR_KEYS:
        v = card.get(k, "")
        card[k] = v if isinstance(v, str) else str(v)
    if not card.get("category"):
        card["category"] = "기타"
    return card
