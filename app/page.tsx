import type { CSSProperties } from "react";
import state from "@/neural-flow/state.json";

// 항상 '오늘' 기준으로 새로 렌더 (Vercel에서 요청 시 계산)
export const dynamic = "force-dynamic";

type Activity = {
  name: string;
  domain: string;
  priority?: string;
  energy?: string;
  repeat?: string;
  min?: number;
  date?: string;
  status?: string;
  why?: string;
};

const DOMAIN_COLOR: Record<string, string> = {
  "✝️ 영성·내면": "#a78bfa",
  "🧠 정신·심리": "#60a5fa",
  "🫀 신체·건강": "#34d399",
  "📚 지성·성장": "#fbbf24",
  "🤝 관계·사랑": "#f472b6",
  "💼 일·소명": "#c4956c",
  "💰 재정·경제": "#fb923c",
  "🎨 창조·표현": "#f87171",
  "🔁 환경·일상": "#94a3b8",
};

function kstToday(): Date {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(target: string, today: Date): number {
  const t = new Date(target.replace("Z", "").slice(0, 10) + "T00:00:00");
  const base = new Date(ymd(today) + "T00:00:00");
  return Math.round((t.getTime() - base.getTime()) / 86400000);
}

export default function Page() {
  const today = kstToday();
  const todayStr = ymd(today);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][today.getDay()];
  const activities = state.activities as unknown as Activity[];

  // 오늘의 단 하나: 오늘 날짜 + 높음 우선 → 가장 가까운 미래 높음 → 첫 높음
  const dated = activities.filter((a) => a.date);
  const oneThing =
    dated.find((a) => a.date === todayStr && a.priority === "높음") ||
    dated
      .filter((a) => a.priority === "높음" && daysBetween(a.date!, today) >= 0)
      .sort((a, b) => daysBetween(a.date!, today) - daysBetween(b.date!, today))[0] ||
    activities.find((a) => a.priority === "높음");

  // 마감 카운트다운
  const deadlines = (state.fixed_blocks as unknown as { title: string; date?: string }[])
    .filter((b) => b.date)
    .map((b) => ({ title: b.title, date: b.date!, d: daysBetween(b.date!, today) }))
    .filter((b) => b.d >= -1 && b.d <= 14)
    .sort((a, b) => a.d - b.d);

  // 9영역 균형
  const counts = (state.domains as unknown as { name: string }[]).map((dm) => ({
    name: dm.name,
    n: activities.filter((a) => a.domain === dm.name).length,
  }));

  // 이번 주 (오늘~+7)
  const week = dated
    .filter((a) => {
      const d = daysBetween(a.date!, today);
      return d >= 0 && d <= 7;
    })
    .sort((a, b) => daysBetween(a.date!, today) - daysBetween(b.date!, today));

  const card: CSSProperties = {
    background: "#1e293b",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  };
  const h2: CSSProperties = {
    fontSize: 14,
    letterSpacing: 1,
    color: "#94a3b8",
    margin: "0 0 12px",
    textTransform: "uppercase",
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 18px 64px" }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ color: "#38bdf8", fontWeight: 700, letterSpacing: 2 }}>
          🌊 NEURAL-FLOW
        </div>
        <h1 style={{ margin: "4px 0 6px", fontSize: 26 }}>
          {todayStr} ({wd})
        </h1>
        <p style={{ color: "#94a3b8", margin: 0, lineHeight: 1.6 }}>
          {state.vision.core_axis}
        </p>
      </header>

      {/* 오늘의 단 하나 */}
      <section
        style={{
          ...card,
          background: "linear-gradient(135deg,#f59e0b22,#1e293b 60%)",
          border: "1px solid #f59e0b55",
        }}
      >
        <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 13 }}>
          ☀️ 오늘의 단 하나
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, margin: "8px 0" }}>
          {oneThing?.name ?? "오늘의 핵심 1개를 정하세요"}
        </div>
        <div style={{ color: "#cbd5e1", lineHeight: 1.6 }}>{oneThing?.why}</div>
        {oneThing && (
          <div style={{ marginTop: 10, fontSize: 13, color: "#94a3b8" }}>
            {oneThing.domain} · {oneThing.energy} · {oneThing.min ?? 0}분
          </div>
        )}
      </section>

      {/* 마감 카운트다운 */}
      <section style={card}>
        <h2 style={h2}>⏳ 마감 카운트다운</h2>
        {deadlines.length === 0 && (
          <div style={{ color: "#64748b" }}>임박한 마감 없음</div>
        )}
        {deadlines.map((d) => {
          const label = d.d === 0 ? "오늘" : d.d < 0 ? "지남" : `D-${d.d}`;
          const color = d.d <= 1 ? "#f87171" : d.d <= 3 ? "#fb923c" : "#94a3b8";
          return (
            <div
              key={d.title}
              style={{
                display: "flex",
                gap: 12,
                padding: "6px 0",
                borderBottom: "1px solid #334155",
              }}
            >
              <span style={{ color, fontWeight: 700, width: 48 }}>{label}</span>
              <span style={{ flex: 1 }}>{d.title}</span>
              <span style={{ color: "#64748b" }}>{d.date}</span>
            </div>
          );
        })}
      </section>

      {/* 9영역 균형 */}
      <section style={card}>
        <h2 style={h2}>🌳 9개 영역 균형</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {counts.map((c) => {
            const color = DOMAIN_COLOR[c.name] ?? "#94a3b8";
            return (
              <span
                key={c.name}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  background: c.n === 0 ? "#0f172a" : `${color}22`,
                  border: `1px solid ${c.n === 0 ? "#334155" : color + "66"}`,
                  color: c.n === 0 ? "#475569" : "#e2e8f0",
                }}
              >
                {c.name} <b style={{ color }}>{c.n === 0 ? "·" : c.n}</b>
              </span>
            );
          })}
        </div>
      </section>

      {/* 이번 주 */}
      <section style={card}>
        <h2 style={h2}>🗓️ 이번 주 ({week.length})</h2>
        {week.map((a, i) => {
          const color = DOMAIN_COLOR[a.domain] ?? "#94a3b8";
          const dd = daysBetween(a.date!, today);
          const day = dd === 0 ? "오늘" : dd === 1 ? "내일" : `+${dd}일`;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid #334155",
              }}
            >
              <span style={{ width: 44, color: "#94a3b8", fontSize: 13 }}>{day}</span>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{a.name}</span>
              <span style={{ color: "#64748b", fontSize: 12 }}>{a.status}</span>
            </div>
          );
        })}
      </section>

      <footer
        style={{
          textAlign: "center",
          color: "#475569",
          fontSize: 12,
          marginTop: 24,
        }}
      >
        과확장 금지 · 하루 단 하나 · North Star: {state.vision.north_star}
      </footer>
    </main>
  );
}
