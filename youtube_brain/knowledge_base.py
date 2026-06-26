"""
youtube_brain · 3단계 REMEMBER — 지식 데이터베이스(SQLite)
=========================================================
요약된 '지식 카드'를 SQLite 에 영구 저장하고, 의미검색(임베딩)·키워드검색(FTS5)으로
다시 꺼내 쓴다. 이게 '영상 → 내 지식'의 핵심.

- 정본 : knowledge.db   (SQLite — 쿼리 가능한 진짜 DB)
- 이식본: knowledge.jsonl(사람이 읽고 git 으로 버전관리. ingest 마다 자동 export)
- 컨테이너가 비어 DB 가 없으면 knowledge.jsonl 에서 자동 복원(seed) — 임베딩까지 보존.
- 의미검색: text-embedding-004 코사인. 키 없으면 FTS5 → LIKE 키워드검색으로 폴백.
"""

import os
import re
import json
import sqlite3

from .config import DB_PATH, JSONL_PATH, get_embedder, cosine, now_kst_iso


def _dump(v):
    return json.dumps(v or [], ensure_ascii=False)


def _load(s):
    if not s:
        return []
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return []


def _fts_query(query):
    """FTS5 MATCH 안전 질의 — 토큰을 따옴표로 감싸 OR 결합(특수문자/예약어 무력화)."""
    toks = re.findall(r"[\w가-힣]+", query or "")
    return " OR ".join(f'"{t}"' for t in toks) if toks else '""'


def _row_to_record(v, c):
    """videos+cards 행 → 표시/검색용 dict(임베딩·원본자막 제외)."""
    return {
        "video_id": c["video_id"],
        "url": (v["url"] if v else "") or f"https://www.youtube.com/watch?v={c['video_id']}",
        "title": v["title"] if v else "",
        "channel": v["channel"] if v else "",
        "published": v["published"] if v else "",
        "duration_sec": v["duration_sec"] if v else 0,
        "views": v["views"] if v else 0,
        "has_transcript": bool(v["has_transcript"]) if v else False,
        "transcript_lang": v["transcript_lang"] if v else "",
        "one_liner": c["one_liner"],
        "tl_dr": _load(c["tl_dr"]),
        "summary": c["summary"],
        "key_points": _load(c["key_points"]),
        "takeaways": _load(c["takeaways"]),
        "keywords": _load(c["keywords"]),
        "entities": _load(c["entities"]),
        "category": c["category"],
        "quotes": _load(c["quotes"]),
        "note": c["note"],
        "engine": c["engine"],
        "model": c["model"],
        "created_at": c["created_at"],
    }


class KnowledgeBase:
    def __init__(self, db_path=None, jsonl_path=None):
        self.db_path = db_path or DB_PATH
        self.jsonl_path = jsonl_path  # None 이면 export/seed 안 함(테스트용)
        if jsonl_path is None and db_path is None:
            self.jsonl_path = JSONL_PATH
        fresh = self.db_path == ":memory:" or not os.path.exists(self.db_path)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.has_fts = self._init_schema()
        if fresh and self.jsonl_path and os.path.exists(self.jsonl_path):
            self._seed_from_jsonl()

    # ── 스키마 ────────────────────────────────────────────────────────────────
    def _init_schema(self):
        self.conn.executescript("""
        CREATE TABLE IF NOT EXISTS videos (
            video_id TEXT PRIMARY KEY,
            url TEXT, title TEXT, channel TEXT, published TEXT,
            duration_sec INTEGER DEFAULT 0, views INTEGER DEFAULT 0, description TEXT,
            transcript_lang TEXT, transcript_is_generated INTEGER DEFAULT 0,
            has_transcript INTEGER DEFAULT 0, transcript_text TEXT, fetched_at TEXT
        );
        CREATE TABLE IF NOT EXISTS cards (
            video_id TEXT PRIMARY KEY,
            one_liner TEXT, tl_dr TEXT, summary TEXT, key_points TEXT, takeaways TEXT,
            keywords TEXT, entities TEXT, category TEXT, quotes TEXT, note TEXT,
            engine TEXT, model TEXT, embedding TEXT, created_at TEXT
        );
        """)
        has_fts = False
        try:
            self.conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts "
                              "USING fts5(video_id UNINDEXED, title, summary, keywords, takeaways)")
            has_fts = True
        except sqlite3.OperationalError:
            has_fts = False  # FTS5 미탑재 빌드 → LIKE 폴백
        self.conn.commit()
        return has_fts

    # ── 쓰기 ──────────────────────────────────────────────────────────────────
    @staticmethod
    def _card_text(meta, card):
        return " ".join(filter(None, [
            meta.get("title", ""), card.get("one_liner", ""),
            " ".join(card.get("tl_dr") or []), " ".join(card.get("key_points") or []),
            " ".join(card.get("takeaways") or []), " ".join(card.get("keywords") or []),
        ]))

    def upsert(self, meta, card, embedder="auto"):
        """영상+카드 저장(+임베딩, +FTS, +JSONL export). 임베딩 생성 여부 반환."""
        if embedder == "auto":
            embedder = get_embedder()
        emb = None
        if embedder is not None:
            try:
                emb = embedder.embed_query(self._card_text(meta, card))
            except Exception as e:
                print(f"[kb] 임베딩 실패(키워드검색만 사용): {e}")
        vid = meta["video_id"]
        self.conn.execute(
            """INSERT OR REPLACE INTO videos
               (video_id,url,title,channel,published,duration_sec,views,description,
                transcript_lang,transcript_is_generated,has_transcript,transcript_text,fetched_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (vid, meta.get("url", ""), meta.get("title", ""), meta.get("channel", ""),
             meta.get("published", ""), int(meta.get("duration_sec", 0) or 0), int(meta.get("views", 0) or 0),
             meta.get("description", ""), meta.get("transcript_lang", ""),
             1 if meta.get("transcript_is_generated") else 0, 1 if meta.get("has_transcript") else 0,
             meta.get("transcript_text", ""), now_kst_iso()))
        self.conn.execute(
            """INSERT OR REPLACE INTO cards
               (video_id,one_liner,tl_dr,summary,key_points,takeaways,keywords,entities,
                category,quotes,note,engine,model,embedding,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (vid, card.get("one_liner", ""), _dump(card.get("tl_dr")), card.get("summary", ""),
             _dump(card.get("key_points")), _dump(card.get("takeaways")), _dump(card.get("keywords")),
             _dump(card.get("entities")), card.get("category", ""), _dump(card.get("quotes")),
             card.get("note", ""), card.get("engine", ""), card.get("model", ""),
             json.dumps(emb) if emb else "", now_kst_iso()))
        self._index_fts(vid, meta.get("title", ""), card.get("summary", ""),
                        card.get("keywords") or [], card.get("takeaways") or [])
        self.conn.commit()
        self.export_jsonl()
        return emb is not None

    def _index_fts(self, vid, title, summary, keywords, takeaways):
        if not self.has_fts:
            return
        self.conn.execute("DELETE FROM knowledge_fts WHERE video_id=?", (vid,))
        self.conn.execute(
            "INSERT INTO knowledge_fts (video_id,title,summary,keywords,takeaways) VALUES (?,?,?,?,?)",
            (vid, title, summary, " ".join(keywords), " ".join(takeaways)))

    # ── 읽기 ──────────────────────────────────────────────────────────────────
    def exists(self, video_id):
        return self.conn.execute("SELECT 1 FROM cards WHERE video_id=?", (video_id,)).fetchone() is not None

    def get(self, video_id):
        c = self.conn.execute("SELECT * FROM cards WHERE video_id=?", (video_id,)).fetchone()
        if not c:
            return None
        v = self.conn.execute("SELECT * FROM videos WHERE video_id=?", (video_id,)).fetchone()
        return _row_to_record(v, c)

    def all_records(self, limit=None):
        rows = self.conn.execute("SELECT video_id FROM cards ORDER BY created_at DESC").fetchall()
        recs = [self.get(r["video_id"]) for r in rows]
        return recs[:limit] if limit else recs

    def stats(self):
        n = self.conn.execute("SELECT COUNT(*) AS n FROM cards").fetchone()["n"]
        with_tr = self.conn.execute("SELECT COUNT(*) AS n FROM videos WHERE has_transcript=1").fetchone()["n"]
        emb = self.conn.execute("SELECT COUNT(*) AS n FROM cards WHERE embedding != ''").fetchone()["n"]
        cats = self.conn.execute(
            "SELECT category, COUNT(*) AS n FROM cards GROUP BY category ORDER BY n DESC").fetchall()
        return {"total": n, "with_transcript": with_tr, "embedded": emb,
                "categories": [(r["category"], r["n"]) for r in cats]}

    # ── 검색 ──────────────────────────────────────────────────────────────────
    def search(self, query, k=8):
        """의미검색(임베딩) 우선, 안 되면 키워드검색(FTS5→LIKE)."""
        rows = self._semantic_search(query, k)
        return rows if rows is not None else self._keyword_search(query, k)

    def _semantic_search(self, query, k):
        embedder = get_embedder()
        if embedder is None:
            return None
        recs = self.conn.execute("SELECT video_id, embedding FROM cards WHERE embedding != ''").fetchall()
        if not recs:
            return None
        try:
            qv = embedder.embed_query(query)
        except Exception as e:
            print(f"[kb] 질의 임베딩 실패 → 키워드검색: {e}")
            return None
        scored = []
        for r in recs:
            v = _load(r["embedding"])
            if v:
                scored.append((cosine(qv, v), r["video_id"]))
        if not scored:  # 저장된 임베딩이 전부 손상 → 키워드검색으로 폴백
            return None
        scored.sort(reverse=True)
        out = []
        for score, vid in scored[:k]:
            rec = self.get(vid)
            rec["score"], rec["match"] = round(score, 4), "semantic"
            out.append(rec)
        return out

    def _keyword_search(self, query, k):
        if self.has_fts:
            try:
                rows = self.conn.execute(
                    "SELECT video_id, bm25(knowledge_fts) AS rank FROM knowledge_fts "
                    "WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?", (_fts_query(query), k)).fetchall()
                out = []
                for r in rows:
                    rec = self.get(r["video_id"])
                    rec["score"], rec["match"] = round(-r["rank"], 4), "fts"
                    out.append(rec)
                if out:
                    return out
            except sqlite3.OperationalError as e:
                print(f"[kb] FTS 검색 실패 → LIKE: {e}")
        like = f"%{query}%"
        rows = self.conn.execute(
            "SELECT c.video_id FROM cards c JOIN videos v ON v.video_id=c.video_id "
            "WHERE v.title LIKE ? OR c.summary LIKE ? OR c.keywords LIKE ? "
            "ORDER BY c.created_at DESC LIMIT ?", (like, like, like, k)).fetchall()
        out = []
        for r in rows:
            rec = self.get(r["video_id"])
            rec["score"], rec["match"] = None, "like"
            out.append(rec)
        return out

    # ── 이식(JSONL) ───────────────────────────────────────────────────────────
    def export_jsonl(self):
        """카드+임베딩을 knowledge.jsonl 로 내보낸다(원본 자막·설명은 제외해 가볍게)."""
        if not self.jsonl_path:
            return
        try:
            cards = self.conn.execute("SELECT * FROM cards ORDER BY created_at DESC").fetchall()
            with open(self.jsonl_path, "w", encoding="utf-8") as f:
                for c in cards:
                    v = self.conn.execute("SELECT * FROM videos WHERE video_id=?", (c["video_id"],)).fetchone()
                    rec = _row_to_record(v, c)
                    rec["embedding"] = _load(c["embedding"]) or None
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception as e:
            print(f"[kb] JSONL export 실패: {e}")

    def _seed_from_jsonl(self):
        try:
            with open(self.jsonl_path, encoding="utf-8") as f:
                lines = f.readlines()
        except Exception as e:
            print(f"[kb] JSONL 읽기 실패: {e}")
            return
        n, bad = 0, 0
        for line in lines:  # 한 줄이 손상돼도(병합충돌 마커·잘린 마지막 줄) 나머지는 살린다
            line = line.strip()
            if not line:
                continue
            try:
                self._insert_record(json.loads(line))
                n += 1
            except Exception as e:
                bad += 1
                print(f"[kb] 손상된 JSONL 줄 건너뜀: {e}")
        self.conn.commit()
        if n or bad:
            print(f"[kb] knowledge.jsonl 에서 {n}개 복원" + (f" ({bad}개 손상 줄 건너뜀)" if bad else ""))

    def _insert_record(self, rec):
        vid = rec["video_id"]
        self.conn.execute(
            """INSERT OR REPLACE INTO videos
               (video_id,url,title,channel,published,duration_sec,views,description,
                transcript_lang,transcript_is_generated,has_transcript,transcript_text,fetched_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (vid, rec.get("url", ""), rec.get("title", ""), rec.get("channel", ""), rec.get("published", ""),
             int(rec.get("duration_sec", 0) or 0), int(rec.get("views", 0) or 0), "",
             rec.get("transcript_lang", ""), 0, 1 if rec.get("has_transcript") else 0, "",
             rec.get("created_at", "")))
        emb = rec.get("embedding")
        self.conn.execute(
            """INSERT OR REPLACE INTO cards
               (video_id,one_liner,tl_dr,summary,key_points,takeaways,keywords,entities,
                category,quotes,note,engine,model,embedding,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (vid, rec.get("one_liner", ""), _dump(rec.get("tl_dr")), rec.get("summary", ""),
             _dump(rec.get("key_points")), _dump(rec.get("takeaways")), _dump(rec.get("keywords")),
             _dump(rec.get("entities")), rec.get("category", ""), _dump(rec.get("quotes")),
             rec.get("note", ""), rec.get("engine", ""), rec.get("model", ""),
             json.dumps(emb) if emb else "", rec.get("created_at", "")))
        self._index_fts(vid, rec.get("title", ""), rec.get("summary", ""),
                        rec.get("keywords") or [], rec.get("takeaways") or [])

    def close(self):
        self.conn.close()
