import type { CSSProperties } from "react";
import Link from "next/link";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// knowledge.jsonl 은 youtube_brain 파이프라인이 갱신하므로 요청 시마다 새로 읽는다.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "📺 유튜브 지식 — youtube_brain",
  description: "유튜브 영상을 요약해 쌓은 개인 지식DB.",
};

type Rec = {
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
};

const CAT_COLOR: Record<string, string> = {
  AI: "#38bdf8",
  반도체: "#a78bfa",
  경제: "#fb923c",
  부동산: "#34d399",
  주식: "#fbbf24",
  창업: "#f472b6",
  노동시장: "#60a5fa",
  기타: "#94a3b8",
};

function catColor(cat?: string): string {
  return (cat && CAT_COLOR[cat]) || "#94a3b8";
}

function fmtDuration(sec?: number): string {
  const s = Math.max(0, Math.floor(sec ?? 0));
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

function loadKnowledge(): Rec[] {
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
        // 손상된 줄은 건너뛴다 (파이프라인과 동일한 방어)
      }
    }
    return out;
  } catch {
    return []; // 파일이 아직 없거나 비어 있음
  }
}

export default async function Knowledge({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const sp = await searchParams;
  const all = loadKnowledge();
  const active = sp.cat ?? "";

  const catCounts = new Map<string, number>();
  for (const r of all) {
    const c = r.category || "기타";
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const cats = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);
  const recs = active ? all.filter((r) => (r.category || "기타") === active) : all;

  const card: CSSProperties = {
    background: "#1e293b",
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
  };
  const chip = (active2: boolean, color: string): CSSProperties => ({
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 13,
    textDecoration: "none",
    background: active2 ? `${color}33` : "#0f172a",
    border: `1px solid ${active2 ? color + "99" : "#334155"}`,
    color: active2 ? "#e2e8f0" : "#94a3b8",
  });
  const tag: CSSProperties = {
    fontSize: 11,
    color: "#94a3b8",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 999,
    padding: "2px 8px",
    marginRight: 6,
    marginTop: 6,
    display: "inline-block",
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 18px 64px" }}>
      <header style={{ marginBottom: 20 }}>
        <Link href="/" style={{ color: "#38bdf8", fontSize: 13, textDecoration: "none" }}>
          ← 대시보드
        </Link>
        <h1 style={{ margin: "8px 0 4px", fontSize: 26 }}>📺 유튜브 지식</h1>
        <p style={{ color: "#94a3b8", margin: 0, lineHeight: 1.6 }}>
          영상을 요약해 쌓은 나만의 지식DB · 총 {all.length}개
        </p>
      </header>

      {/* 카테고리 필터 */}
      {cats.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          <Link href="/knowledge" style={chip(!active, "#38bdf8")}>
            전체 <b>{all.length}</b>
          </Link>
          {cats.map(([c, n]) => (
            <Link key={c} href={`/knowledge?cat=${encodeURIComponent(c)}`} style={chip(active === c, catColor(c))}>
              {c} <b style={{ color: catColor(c) }}>{n}</b>
            </Link>
          ))}
        </div>
      )}

      {/* 빈 상태 */}
      {all.length === 0 && (
        <section style={{ ...card, textAlign: "center", color: "#94a3b8", lineHeight: 1.7 }}>
          아직 쌓인 지식이 없습니다.
          <br />
          <code style={{ color: "#cbd5e1" }}>python -m youtube_brain &quot;유튜브링크 또는 키워드&quot;</code>
          <br />
          로 영상을 추가하면 여기에 모입니다.
        </section>
      )}

      {/* 지식 카드 목록 */}
      {recs.map((r) => {
        const color = catColor(r.category);
        const meta = [r.channel, fmtDuration(r.duration_sec), r.views ? `조회 ${r.views.toLocaleString()}` : ""]
          .filter(Boolean)
          .join(" · ");
        return (
          <section key={r.video_id} style={{ ...card, borderLeft: `3px solid ${color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 17, textDecoration: "none", lineHeight: 1.4 }}
              >
                {r.title || "(제목 없음)"} ↗
              </a>
              <span style={{ color, fontSize: 12, whiteSpace: "nowrap" }}>{r.category}</span>
            </div>
            {meta && <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{meta}</div>}

            {r.one_liner && (
              <div style={{ color: "#cbd5e1", lineHeight: 1.7, margin: "10px 0 0", fontWeight: 600 }}>
                💡 {r.one_liner}
              </div>
            )}

            {(r.tl_dr ?? []).length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "#cbd5e1", lineHeight: 1.7 }}>
                {r.tl_dr!.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}

            {(r.takeaways ?? []).length > 0 && (
              <div style={{ marginTop: 10, padding: "10px 12px", background: "#0f172a", borderRadius: 10 }}>
                <div style={{ color: "#fbbf24", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>💼 시사점</div>
                {r.takeaways!.map((t, i) => (
                  <div key={i} style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.7 }}>
                    → {t}
                  </div>
                ))}
              </div>
            )}

            {(r.keywords ?? []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                {r.keywords!.map((k) => (
                  <span key={k} style={tag}>
                    #{k}
                  </span>
                ))}
              </div>
            )}

            {r.note && <div style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>⚠️ {r.note}</div>}
          </section>
        );
      })}

      <footer style={{ textAlign: "center", color: "#475569", fontSize: 12, marginTop: 24 }}>
        youtube_brain · 자막 → Gemini 요약 → SQLite 지식DB · 키워드/의미 검색·RAG
      </footer>
    </main>
  );
}
