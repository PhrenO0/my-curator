"""
youtube_brain · 공용 설정·헬퍼
==============================
모든 단계(ingest→summarize→store→ask)가 공유하는 경로·LLM·임베더·JSON 파서.
neural-flow의 get_llm/_loads 관습을 그대로 따른다 — 키가 없으면 조용히 폴백(graceful degrade).
"""

import os
import json
import math
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "knowledge.db")        # 정본: 쿼리 가능한 SQLite DB
JSONL_PATH = os.path.join(HERE, "knowledge.jsonl")  # 이식본: git 으로 버전관리되는 지식
KST = timezone(timedelta(hours=9))

DEFAULT_LANGS = ["ko", "en"]  # 자막 우선순위(한국어 → 영어 → 그 외)


def now_kst_iso():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")


def get_llm(temperature=0.3):
    """Gemini LLM. GOOGLE_API_KEY 없으면 None(폴백 동작)."""
    key = os.environ.get("GOOGLE_API_KEY")
    if not key:
        return None
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
            google_api_key=key,
            temperature=temperature,
        )
    except Exception as e:
        print(f"[config] LLM 로드 실패: {e}")
        return None


def get_embedder():
    """text-embedding-004 임베더(의미검색용). 키/패키지 없으면 None → 키워드검색으로 폴백."""
    key = os.environ.get("GOOGLE_API_KEY")
    if not key:
        return None
    try:
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        return GoogleGenerativeAIEmbeddings(
            model=os.environ.get("GEMINI_EMBED_MODEL", "models/text-embedding-004"),
            google_api_key=key,
        )
    except Exception as e:
        print(f"[config] 임베더 로드 실패: {e}")
        return None


def loads_json(raw):
    """LLM 출력에서 JSON 만 견고하게 추출(코드펜스·잡텍스트 허용)."""
    if not raw:
        raise ValueError("빈 응답")
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        if len(parts) >= 2:
            raw = parts[1].strip()
            if raw.lower().startswith("json"):
                raw = raw[4:].strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # 첫 여는 괄호 ~ 마지막 닫는 괄호 사이를 시도({...} 또는 [...])
        for open_c, close_c in (("{", "}"), ("[", "]")):
            s, e = raw.find(open_c), raw.rfind(close_c)
            if s != -1 and e > s:
                try:
                    return json.loads(raw[s:e + 1])
                except json.JSONDecodeError:
                    continue
        raise


def cosine(a, b):
    """두 벡터의 코사인 유사도(neural-flow/coverletter 와 동일 구현)."""
    if not a or not b or len(a) != len(b):  # 임베딩 모델이 바뀌어 차원이 다르면 매칭 무효
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0
