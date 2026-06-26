"""
youtube_brain CLI
=================
  python -m youtube_brain <링크|키워드>              # 수집(기본 = ingest)
  python -m youtube_brain ingest <링크|키워드> [--max N] [--force] [--lang ko,en] [--email]
  python -m youtube_brain ask "질문" [-k 5]          # 내 지식에 묻기(RAG)
  python -m youtube_brain search "검색어" [-k 8]     # 지식DB 의미/키워드 검색
  python -m youtube_brain list [--limit 20]          # 쌓인 지식 목록
  python -m youtube_brain stats                      # 통계
  python -m youtube_brain selftest                   # 오프라인 자가검증(키/네트워크 불필요)
"""

import sys
import argparse

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from .pipeline import ingest_target, ask
from .knowledge_base import KnowledgeBase
from . import report

_COMMANDS = {"ingest", "ask", "search", "list", "stats", "selftest"}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    # 서브커맨드 없이 바로 링크/키워드를 준 경우 → ingest 로 간주
    if argv and argv[0] not in _COMMANDS and not argv[0].startswith("-"):
        argv = ["ingest"] + argv

    p = argparse.ArgumentParser(prog="youtube_brain", description="유튜브 → 요약 → 지식DB 파이프라인")
    sub = p.add_subparsers(dest="cmd")

    pi = sub.add_parser("ingest", help="링크/키워드 수집")
    pi.add_argument("target", nargs="+", help="유튜브 링크 또는 키워드")
    pi.add_argument("--max", type=int, default=5, help="키워드 검색 시 최대 영상 수")
    pi.add_argument("--force", action="store_true", help="이미 있어도 재요약")
    pi.add_argument("--lang", default="ko,en", help="자막 우선순위(쉼표 구분)")
    pi.add_argument("--email", action="store_true", help="결과를 이메일로도 발송")

    pa = sub.add_parser("ask", help="내 지식에 RAG 질의")
    pa.add_argument("question", nargs="+")
    pa.add_argument("-k", type=int, default=5)

    ps = sub.add_parser("search", help="지식DB 검색")
    ps.add_argument("query", nargs="+")
    ps.add_argument("-k", type=int, default=8)

    pl = sub.add_parser("list", help="지식 목록")
    pl.add_argument("--limit", type=int, default=20)

    sub.add_parser("stats", help="통계")
    sub.add_parser("selftest", help="오프라인 자가검증")

    args = p.parse_args(argv)
    if not args.cmd:
        p.print_help()
        return
    {"ingest": _cmd_ingest, "ask": _cmd_ask, "search": _cmd_search,
     "list": _cmd_list, "stats": _cmd_stats, "selftest": _cmd_selftest}[args.cmd](args)


def _cmd_ingest(args):
    target = " ".join(args.target)
    langs = [s.strip() for s in args.lang.split(",") if s.strip()]
    print(f"🎬 ingest: {target}")
    out = ingest_target(target, max_results=args.max, langs=langs, force=args.force)
    if not out["results"]:
        if out["mode"] == "url-no-video":
            print("⚠️ 링크에서 video_id 를 못 찾았습니다(재생목록/채널?). 단일 영상 링크를 주세요.")
        else:
            print("⚠️ 결과 없음. 키워드 검색은 YOUTUBE_API_KEY 가 필요합니다.")
        return
    for rec in out["results"]:
        print(report.render_card_console(rec))
    if args.email:
        md = report.render_cards_md(out["results"], f"유튜브 지식 — {target}")
        report.send_email(f"📺 유튜브 지식: {target}", report.md_to_html(md))
    print(f"\n✅ {len(out['results'])}개 처리 완료 · 지식DB에 누적")


def _cmd_ask(args):
    print(report.render_answer_console(ask(" ".join(args.question), k=args.k)))


def _cmd_search(args):
    q = " ".join(args.query)
    hits = KnowledgeBase().search(q, k=args.k) or []
    if not hits:
        print("검색 결과 없음.")
        return
    print(f"🔎 '{q}' — {len(hits)}건")
    for i, h in enumerate(hits, 1):
        sc = f"{h['match']} {h['score']}" if h.get("score") is not None else h.get("match", "")
        print(f"{i}. {h.get('title', '')}  ({sc})\n   {h.get('one_liner', '')}\n   {h.get('url', '')}")


def _cmd_list(args):
    recs = KnowledgeBase().all_records(limit=args.limit)
    if not recs:
        print("지식DB가 비어 있습니다. ingest 로 영상을 추가하세요.")
        return
    print(f"📚 지식 {len(recs)}개")
    for r in recs:
        print(f"• [{r.get('category', '')}] {r.get('title', '')}\n  {r.get('one_liner', '')}  ({r.get('url', '')})")


def _cmd_stats(args):
    s = KnowledgeBase().stats()
    print(f"📚 지식DB 통계\n  총 {s['total']}개 · 자막보유 {s['with_transcript']} · 임베딩 {s['embedded']}")
    for cat, n in s["categories"]:
        print(f"  - {cat or '미분류'}: {n}")


# ── 오프라인 자가검증(키/네트워크 없이 DB·검색·RAG 폴백 경로 점검) ──────────────
def _demo_records():
    return [
        ({"video_id": "DEMOai00001", "url": "https://youtu.be/DEMOai00001",
          "title": "[데모] AI 반도체 HBM 투자 전망", "channel": "테크데모",
          "duration_sec": 845, "views": 12345, "has_transcript": True,
          "transcript_lang": "ko", "transcript_text": "데모 자막"},
         {"one_liner": "HBM 수요 급증과 AI 반도체 투자 포인트 정리.",
          "tl_dr": ["HBM3E 공급 부족 지속", "메모리 3사 증설 경쟁"],
          "summary": "AI 가속기 수요로 HBM 단가가 오르고 메모리 업황이 반등한다는 분석.",
          "key_points": ["HBM 단가 상승", "엔비디아 발주 증가"],
          "takeaways": ["반도체 소부장 비중 점검", "메모리 사이클 저점 매수 검토"],
          "keywords": ["AI", "반도체", "HBM", "메모리", "투자"], "entities": ["엔비디아", "삼성전자"],
          "category": "반도체", "quotes": [], "engine": "demo", "model": ""}),
        ({"video_id": "DEMOhouse002", "url": "https://youtu.be/DEMOhouse002",
          "title": "[데모] 2026 부동산 금리와 전세 시장", "channel": "부동산데모",
          "duration_sec": 1320, "views": 6789, "has_transcript": True,
          "transcript_lang": "ko", "transcript_text": "데모 자막"},
         {"one_liner": "금리 인하 기대와 전세가율로 본 2026 부동산.",
          "tl_dr": ["전세가율 상승 지역 주목", "금리 향방이 핵심 변수"],
          "summary": "기준금리 경로에 따라 매매·전세 흐름이 갈린다는 시황 분석.",
          "key_points": ["전세가율 70% 회복 지역 등장", "거래량 바닥 신호"],
          "takeaways": ["실거주 매수 타이밍 점검", "전세 레버리지 리스크 관리"],
          "keywords": ["부동산", "금리", "전세", "시황"], "entities": ["한국은행"],
          "category": "부동산", "quotes": [], "engine": "demo", "model": ""}),
    ]


def _cmd_selftest(args):
    import os
    import tempfile
    tmp = os.path.join(tempfile.gettempdir(), "yt_brain_selftest.db")
    if os.path.exists(tmp):
        os.remove(tmp)
    kb = KnowledgeBase(db_path=tmp, jsonl_path=None)
    demos = _demo_records()
    for meta, card in demos:
        kb.upsert(meta, card, embedder=None)  # 키 없이 키워드검색 경로 검증
    print(f"[selftest] {len(demos)}개 데모 적재 · FTS5={kb.has_fts}")

    hits = kb.search("AI 반도체 투자", k=3) or []
    assert hits and hits[0]["category"] == "반도체", "검색이 반도체 영상을 1순위로 못 찾음"
    print(f"[selftest] search('AI 반도체 투자') → {[h['title'] for h in hits]} (match={hits[0]['match']})")

    st = kb.stats()
    assert st["total"] == 2, st
    print(f"[selftest] stats → {st}")

    res = ask("AI 반도체 투자 포인트는?", k=2, kb=kb)
    assert len(res["sources"]) >= 1, res
    print(f"[selftest] ask → note='{res['note']}' · 출처 {len(res['sources'])}건")

    kb.close()
    os.remove(tmp)
    print("✅ selftest 통과 (DB·검색·RAG 폴백 정상)")


if __name__ == "__main__":
    main()
