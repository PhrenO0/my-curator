import type { CSSProperties } from "react";
import Link from "next/link";
import { type Rec, rankRecords, ragAnswer, loadKnowledge, catColor, fmtDuration } from "./search";

// knowledge.jsonl 은 youtube_brain 파이프라인이 갱신하므로 요청 시마다 새로 읽는다.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "📺 유튜브 지식 — youtube_brain",
  description: "유튜브 영상을 요약해 쌓은 개인 지식DB.",
};

const cardStyle: CSSProperties = { background: "#1e293b", borderRadius: 16, padding: 20, marginBottom: 14 };
const tagStyle: CSSProperties = {
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

function KnowledgeCard({ r, badge }: { r: Rec; badge?: string }) {
  const color = catColor(r.category);
  const meta = [r.channel, fmtDuration(r.duration_sec), r.views ? `조회 ${r.views.toLocaleString()}` : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <section style={{ ...cardStyle, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 17, textDecoration: "none", lineHeight: 1.4 }}
        >
          {badge ? <span style={{ color, marginRight: 6 }}>{badge}</span> : null}
          {r.title || "(제목 없음)"} ↗
        </a>
        <span style={{ color, fontSize: 12, whiteSpace: "nowrap" }}>{r.category}</span>
      </div>
      {meta && <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{meta}</div>}

      {r.one_liner && (
        <div style={{ color: "#cbd5e1", lineHeight: 1.7, margin: "10px 0 0", fontWeight: 600 }}>💡 {r.one_liner}</div>
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
            <span key={k} style={tagStyle}>
              #{k}
            </span>
          ))}
        </div>
      )}

      {r.note && <div style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>⚠️ {r.note}</div>}
    </section>
  );
}

export default async function Knowledge({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const all = loadKnowledge();
  const active = sp.cat ?? "";
  const q = (sp.q ?? "").trim();

  const catCounts = new Map<string, number>();
  for (const r of all) {
    const c = r.category || "기타";
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const cats = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);

  // 검색 모드: 의미검색 랭킹 + RAG 답변
  const ranked = q ? await rankRecords(all, q) : [];
  const answer = q && ranked.length ? await ragAnswer(q, ranked.map((x) => x.rec)) : null;

  const chip = (on: boolean, color: string): CSSProperties => ({
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 13,
    textDecoration: "none",
    background: on ? `${color}33` : "#0f172a",
    border: `1px solid ${on ? color + "99" : "#334155"}`,
    color: on ? "#e2e8f0" : "#94a3b8",
  });

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 18px 64px" }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Link href="/" style={{ color: "#38bdf8", fontSize: 13, textDecoration: "none" }}>
            ← 대시보드
          </Link>
          <Link href="/knowledge/map" style={{ color: "#a78bfa", fontSize: 13, textDecoration: "none" }}>
            🕸️ 지식맵 →
          </Link>
        </div>
        <h1 style={{ margin: "8px 0 4px", fontSize: 26 }}>📺 유튜브 지식</h1>
        <p style={{ color: "#94a3b8", margin: 0, lineHeight: 1.6 }}>
          영상을 요약해 쌓은 나만의 지식DB · 총 {all.length}개
        </p>
      </header>

      {/* 검색창 — 내 지식에 질문(의미검색 + RAG) */}
      <form method="get" action="/knowledge" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <input
          name="q"
          defaultValue={q}
          placeholder="내 지식에 질문하기 — 예: HBM 투자 포인트"
          style={{
            flex: 1,
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 10,
            padding: "10px 14px",
            color: "#e2e8f0",
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          style={{
            background: "#38bdf8",
            color: "#0f172a",
            fontWeight: 700,
            border: "none",
            borderRadius: 10,
            padding: "0 18px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          검색
        </button>
      </form>

      {/* 카테고리 필터 (검색 중이 아닐 때만) */}
      {!q && cats.length > 0 && (
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
        <section style={{ ...cardStyle, textAlign: "center", color: "#94a3b8", lineHeight: 1.7 }}>
          아직 쌓인 지식이 없습니다.
          <br />
          <code style={{ color: "#cbd5e1" }}>python -m youtube_brain &quot;유튜브링크 또는 키워드&quot;</code>
          <br />
          로 영상을 추가하면 여기에 모입니다.
        </section>
      )}

      {/* === 검색 모드 === */}
      {q && (
        <>
          <div style={{ marginBottom: 14 }}>
            <Link href="/knowledge" style={{ color: "#94a3b8", fontSize: 13, textDecoration: "none" }}>
              ← 전체 보기
            </Link>
          </div>

          {answer && (
            <section
              style={{
                ...cardStyle,
                background: "linear-gradient(135deg,#38bdf822,#1e293b 60%)",
                border: "1px solid #38bdf855",
              }}
            >
              <div style={{ color: "#38bdf8", fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
                🧠 내 지식 기반 답변
              </div>
              <div style={{ color: "#e2e8f0", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{answer}</div>
            </section>
          )}

          {ranked.length === 0 ? (
            <section style={{ ...cardStyle, color: "#94a3b8" }}>
              ‘{q}’ 와 관련된 지식을 못 찾았습니다. 먼저 관련 영상을 ingest 해보세요.
            </section>
          ) : (
            <>
              <h2 style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 12px", textTransform: "uppercase" }}>
                관련 영상 {ranked.length}건 ({ranked[0].match === "semantic" ? "의미검색" : "키워드"})
              </h2>
              {ranked.map((x, i) => (
                <KnowledgeCard key={x.rec.video_id} r={x.rec} badge={`[${i + 1}]`} />
              ))}
            </>
          )}
        </>
      )}

      {/* === 일반 목록 모드 === */}
      {!q &&
        (active ? all.filter((r) => (r.category || "기타") === active) : all).map((r) => (
          <KnowledgeCard key={r.video_id} r={r} />
        ))}

      <footer style={{ textAlign: "center", color: "#475569", fontSize: 12, marginTop: 24 }}>
        youtube_brain · 자막 → Gemini 요약 → SQLite 지식DB · 키워드/의미 검색·RAG
      </footer>
    </main>
  );
}
