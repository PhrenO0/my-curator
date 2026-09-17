"""youtube_brain — 유튜브 영상을 요약해 개인 지식DB로 쌓고 다시 꺼내 쓰는 파이프라인.

흐름: 링크/키워드 → 자막 수집 → Gemini 요약(지식 카드) → SQLite 지식DB → 의미검색·RAG 질의.
CLI:  python -m youtube_brain <링크|키워드>          # 수집
      python -m youtube_brain ask "질문"            # 내 지식에 묻기(RAG)
"""

from .pipeline import ingest_target, ask
from .knowledge_base import KnowledgeBase

__all__ = ["ingest_target", "ask", "KnowledgeBase"]
__version__ = "1.0.0"
