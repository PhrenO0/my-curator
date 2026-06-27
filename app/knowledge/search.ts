// youtube_brain · /knowledge 서버측 검색 (의미검색 + RAG)
// ─────────────────────────────────────────────────────────
// knowledge.jsonl 에 저장된 임베딩과, 질의 임베딩(Gemini REST)을 코사인 비교해 의미검색.
// 키가 없으면 어휘(키워드) 매칭으로 폴백. GOOGLE_API_KEY 는 서버에서만 쓰며 클라이언트로 안 나간다.
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Rec = {
  video_id: string;
  url: string;
  title?: string;
  channel?: string;
  published?: string;
  duration_sec?: number;
  views?: number;
  one_liner?: string;
  tl_dr?: string[];
  summary?: string;
  key_points?: string[];
  takeaways?: string[];
  keywords?: string[];
  entities?: string[];
  category?: string;
  quotes?: string[];
  note?: string;
  engine?: string;
  created_at?: string;
  embedding?: number[] | null;
};

export type Ranked = { rec: Rec; score: number; match: "semantic" | "keyword" };

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ── 공용 데이터/표현 헬퍼 (page.tsx · map/page.tsx 가 공유) ──────────────────
export const CAT_COLOR: Record<string, string> = {
  AI: "#38bdf8",
  반도체: "#a78bfa",
  경제: "#fb923c",
  부동산: "#34d399",
  주식: "#fbbf24",
  창업: "#f472b6",
  노동시장: "#60a5fa",
  기타: "#94a3b8",
};

export function catColor(cat?: string): string {
  return (cat && CAT_COLOR[cat]) || "#94a3b8";
}

export function fmtDuration(sec?: number): string {
  const s = Math.max(0, Math.floor(sec ?? 0));
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

// knowledge.jsonl 한 줄 = 카드 하나. 손상된 줄은 건너뛴다(파이프라인과 동일 방어).
export function loadKnowledge(): Rec[] {
  try {
    const p = join(process.cwd(), "youtube_brain", "knowledge.jsonl");
    const raw = readFileSync(p, "utf-8");
    const out: Rec[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t) as Rec);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  } catch {
    return []; // 파일이 아직 없거나 비어 있음
  }
}

function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[가-힣]+|[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

// 질의 임베딩(text-embedding-004). 저장 카드와 같은 RETRIEVAL_QUERY 타입으로 공간을 맞춘다.
async function embedQuery(text: string): Promise<number[] | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_EMBED_MODEL || "models/text-embedding-004";
  try {
    const res = await fetch(`${GEMINI_BASE}/${model}:embedContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] }, taskType: "RETRIEVAL_QUERY" }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = await res.json();
    const v = j?.embedding?.values;
    return Array.isArray(v) ? (v as number[]) : null;
  } catch {
    return null;
  }
}

export async function rankRecords(recs: Rec[], q: string, k = 8): Promise<Ranked[]> {
  const qv = await embedQuery(q);
  if (qv) {
    const scored: Ranked[] = recs
      .filter((r) => Array.isArray(r.embedding) && r.embedding!.length === qv.length)
      .map((r) => ({ rec: r, score: cosine(qv, r.embedding as number[]), match: "semantic" as const }));
    if (scored.length) {
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    }
  }
  // 어휘 폴백
  const toks = tokenize(q);
  const scored: Ranked[] = recs
    .map((r) => {
      const hay = new Set(
        tokenize(
          [r.title, r.one_liner, r.summary, (r.keywords ?? []).join(" "), (r.takeaways ?? []).join(" ")]
            .filter(Boolean)
            .join(" "),
        ),
      );
      const score = toks.reduce((s, t) => s + (hay.has(t) ? 1 : 0), 0);
      return { rec: r, score, match: "keyword" as const };
    })
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// 검색 결과를 근거로 Gemini 가 한국어 답변(출처 번호 포함). 키 없으면 null → 카드만 노출.
export async function ragAnswer(question: string, top: Rec[]): Promise<string | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key || top.length === 0) return null;
  const ctx = top
    .slice(0, 5)
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title ?? ""} (${r.url})\n요약: ${(r.summary ?? "").slice(0, 500)}\n시사점: ${(r.takeaways ?? []).slice(0, 3).join(" / ")}`,
    )
    .join("\n\n");
  const prompt = `너는 사용자의 '제2의 뇌'다. 아래 '내가 저장한 유튜브 영상 지식'만 근거로 질문에 한국어로 답하라.
각 주장 끝에 [n] 형태로 출처 번호를 달고, 근거가 부족하면 솔직히 모자라다고 말하라. 분석·시사점 중심으로.

[질문] ${question}

[근거]
${ctx}`;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = await res.json();
    const parts = j?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    const text = parts.map((p: { text?: string }) => p.text ?? "").join("").trim();
    return text || null;
  } catch {
    return null;
  }
}
