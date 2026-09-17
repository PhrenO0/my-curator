import Link from "next/link";
import { type Rec, loadKnowledge, catColor } from "../search";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "🕸️ 지식맵 — youtube_brain",
  description: "영상들이 공유 키워드로 어떻게 연결되는지 보여주는 지식 그래프.",
};

const MAX_NODES = 24; // 원형 그래프 가독성 한도

function uniqLower(arr?: string[]): string[] {
  return [...new Set((arr ?? []).map((k) => k.trim()).filter(Boolean))];
}

export default function KnowledgeMap() {
  const all = loadKnowledge();

  // ── 태그 클라우드: 전체 키워드 빈도 ──────────────────────────────────────
  const freq = new Map<string, number>();
  for (const r of all) {
    for (const k of uniqLower(r.keywords)) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const topTags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const maxFreq = topTags.length ? topTags[0][1] : 1;

  // ── 그래프: 최근 N개 영상을 원형 배치, 키워드 공유 시 엣지 ────────────────
  const nodes = all.slice(0, MAX_NODES);
  const N = nodes.length;
  const C = 170;
  const R = 132;
  const pos = nodes.map((_, i) => {
    const ang = (-90 + (i * 360) / Math.max(1, N)) * (Math.PI / 180);
    return { x: C + R * Math.cos(ang), y: C + R * Math.sin(ang) };
  });
  const kwSets = nodes.map((r) => new Set(uniqLower(r.keywords)));
  const edges: { i: number; j: number; w: number }[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      let w = 0;
      for (const k of kwSets[i]) if (kwSets[j].has(k)) w++;
      if (w > 0) edges.push({ i, j, w });
    }
  }
  const degree = new Array<number>(N).fill(0);
  for (const e of edges) {
    degree[e.i] += e.w;
    degree[e.j] += e.w;
  }

  const catsPresent = [...new Set(nodes.map((n) => n.category || "기타"))];

  const card = { background: "#1e293b", borderRadius: 16, padding: 20, marginBottom: 16 } as const;
  const h2 = { fontSize: 13, color: "#94a3b8", margin: "0 0 12px", textTransform: "uppercase" as const };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 18px 64px" }}>
      <header style={{ marginBottom: 16 }}>
        <Link href="/knowledge" style={{ color: "#38bdf8", fontSize: 13, textDecoration: "none" }}>
          ← 유튜브 지식
        </Link>
        <h1 style={{ margin: "8px 0 4px", fontSize: 26 }}>🕸️ 지식맵</h1>
        <p style={{ color: "#94a3b8", margin: 0, lineHeight: 1.6 }}>
          영상 {all.length}개 · 공유 키워드로 본 연결 ({edges.length}개 링크)
        </p>
      </header>

      {all.length === 0 && (
        <section style={{ ...card, textAlign: "center", color: "#94a3b8", lineHeight: 1.7 }}>
          아직 지식이 없습니다. <code style={{ color: "#cbd5e1" }}>python -m youtube_brain &quot;키워드&quot;</code> 로 모아보세요.
        </section>
      )}

      {/* 태그 클라우드 */}
      {topTags.length > 0 && (
        <section style={card}>
          <h2 style={h2}>🏷️ 자주 등장하는 키워드</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
            {topTags.map(([k, n]) => {
              const size = 12 + Math.round(((n - 1) / Math.max(1, maxFreq - 1)) * 14);
              return (
                <Link
                  key={k}
                  href={`/knowledge?q=${encodeURIComponent(k)}`}
                  title={`${n}개 영상`}
                  style={{
                    fontSize: size,
                    color: "#cbd5e1",
                    textDecoration: "none",
                    lineHeight: 1.3,
                    opacity: 0.6 + 0.4 * (n / maxFreq),
                  }}
                >
                  #{k}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 연결 그래프 */}
      {N >= 2 && (
        <section style={card}>
          <h2 style={h2}>🔗 영상 연결 그래프 {all.length > MAX_NODES ? `(최근 ${MAX_NODES}개)` : ""}</h2>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <svg viewBox="0 0 340 340" width="100%" style={{ maxWidth: 380 }}>
              {edges.map((e, idx) => (
                <line
                  key={idx}
                  x1={pos[e.i].x}
                  y1={pos[e.i].y}
                  x2={pos[e.j].x}
                  y2={pos[e.j].y}
                  stroke="#a78bfa"
                  strokeWidth={Math.min(2.5, 0.6 + e.w * 0.5)}
                  strokeOpacity={Math.min(0.5, 0.12 + e.w * 0.12)}
                />
              ))}
              {nodes.map((r, i) => {
                const color = catColor(r.category);
                const rad = 6 + Math.min(6, degree[i]); // 연결 많을수록 크게
                return (
                  <g key={r.video_id}>
                    <circle cx={pos[i].x} cy={pos[i].y} r={rad} fill={color} fillOpacity={0.85} />
                    <text
                      x={pos[i].x}
                      y={pos[i].y}
                      fontSize={9}
                      fill="#0f172a"
                      fontWeight={700}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {i + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          {/* 카테고리 범례 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 8 }}>
            {catsPresent.map((c) => (
              <span key={c} style={{ fontSize: 12, color: "#94a3b8" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: catColor(c),
                    marginRight: 4,
                  }}
                />
                {c}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 노드 번호 → 영상 */}
      {N > 0 && (
        <section style={card}>
          <h2 style={h2}>📍 노드 ({N})</h2>
          {nodes.map((r: Rec, i) => (
            <div
              key={r.video_id}
              style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid #334155" }}
            >
              <span style={{ width: 22, color: catColor(r.category), fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, color: "#e2e8f0", textDecoration: "none", lineHeight: 1.4 }}
              >
                {r.title || "(제목 없음)"}
              </a>
              <span style={{ color: "#64748b", fontSize: 12, whiteSpace: "nowrap" }}>
                🔗 {degree[i]}
              </span>
            </div>
          ))}
        </section>
      )}

      <footer style={{ textAlign: "center", color: "#475569", fontSize: 12, marginTop: 24 }}>
        노드=영상 · 선=공유 키워드 · 두꺼울수록 더 많이 겹침
      </footer>
    </main>
  );
}
