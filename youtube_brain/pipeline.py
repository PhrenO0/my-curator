"""
youtube_brain · 오케스트레이션 — SENSE→THINK→REMEMBER→(ASK)
==========================================================
ingest_target : 링크/키워드 → 영상들 → 요약 → 지식DB 누적.
ask           : 저장된 지식에서 의미검색 → Gemini 가 '내가 모은 영상'만 근거로 답변(RAG).
"""

from .ingest import resolve_targets, ingest_video
from .summarize import summarize_video
from .knowledge_base import KnowledgeBase
from .config import get_llm, get_embedder


def ingest_target(query, max_results=5, langs=None, force=False, kb=None):
    """링크/키워드를 받아 영상들을 수집·요약·저장. 결과 dict 반환."""
    kb = kb or KnowledgeBase()
    llm = get_llm()
    embedder = get_embedder()
    ids, mode = resolve_targets(query, max_results)
    results = []
    for vid in ids:
        if not force and kb.exists(vid):
            rec = kb.get(vid)
            rec["_status"] = "이미 있음(건너뜀)"
            results.append(rec)
            print(f"  · {vid} 이미 지식DB에 있음 — 건너뜀(--force 로 재요약)")
            continue
        meta = ingest_video(vid, langs)
        card = summarize_video(meta, meta.get("transcript_text", ""), llm)
        kb.upsert(meta, card, embedder=embedder)
        rec = kb.get(vid)
        rec["_status"] = f"신규({card.get('engine', '')})"
        results.append(rec)
        tag = "자막" if meta.get("has_transcript") else "자막없음"
        print(f"  ✓ {meta.get('title', '(제목미상)')[:42]} … 저장 [{tag}]")
    return {"mode": mode, "results": results, "query": query}


def _build_context(hits):
    blocks = []
    for i, h in enumerate(hits, 1):
        kp = " / ".join((h.get("key_points") or [])[:5])
        tk = " / ".join((h.get("takeaways") or [])[:3])
        blocks.append(
            f"[{i}] {h.get('title', '')} ({h.get('url', '')})\n"
            f"요약: {h.get('summary', '')[:600]}\n핵심: {kp}\n시사점: {tk}")
    return "\n\n".join(blocks)


def ask(question, k=5, kb=None):
    """내 지식DB 에 질문 → 관련 영상 검색 + Gemini RAG 답변(출처 번호 포함)."""
    kb = kb or KnowledgeBase()
    hits = kb.search(question, k=k) or []
    if not hits:
        return {"question": question, "answer": "", "sources": [],
                "note": "지식DB가 비었거나 검색 결과가 없습니다. 먼저 영상을 ingest 하세요."}
    llm = get_llm()
    if llm is None:
        return {"question": question, "answer": "", "sources": hits,
                "note": "GOOGLE_API_KEY 없음 — 관련 지식 카드만 반환합니다."}
    prompt = f"""너는 사용자의 '제2의 뇌'다. 사용자가 직접 모아온 유튜브 영상 지식만 근거로 답한다.
분석·시사점 중심으로, 한국어로 답하라.

[질문] {question}

[근거 — 내가 저장한 영상 지식들]
{_build_context(hits)}

규칙:
- 위 근거에 있는 내용만 사용한다. 추측·외부지식 금지.
- 각 주장 끝에 [n] 형태로 출처(영상) 번호를 단다.
- 근거가 부족하면 솔직히 '모은 영상으로는 부족하다'고 말한다."""
    answer = (llm.invoke(prompt).content or "").strip()
    return {"question": question, "answer": answer, "sources": hits, "note": ""}
