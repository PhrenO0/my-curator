import type { CSSProperties } from "react";
import state from "@/neural-flow/state.json";
import expData from "@/neural-flow/experiences.json";

export const metadata = {
  title: "준상 — CX형 AI 서비스기획자 포트폴리오",
  description:
    "사용자의 불안·마찰을 읽어 AI·콘텐츠·공간으로 다음 행동을 확신하게 만드는 경험을 설계·연출합니다.",
};

type Exp = {
  id: string;
  title: string;
  serves?: string[];
  one_liner: string;
  metrics?: string[];
  proof: string;
};

export default function Portfolio() {
  const cm = (state.goals as unknown as { career_map?: any }).career_map;
  const exps = (expData.experiences as unknown as Exp[]) ?? [];
  const flagship = exps.find((e) => e.id === "neural-flow");
  const cases = exps.filter((e) => e.id !== "neural-flow");

  const card: CSSProperties = {
    background: "#1e293b",
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
  };
  const tag: CSSProperties = {
    fontSize: 11,
    color: "#94a3b8",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 999,
    padding: "2px 8px",
    marginRight: 6,
  };

  // 2026 시장적합도
  const fit = cm?.market_fit_2026 ?? {};
  const fitRows: [string, string][] = [
    ["오후 안에 vibe-code MVP", fit.vibe_code_mvp],
    ["agentic AI 이해", fit.agentic_ai],
    ["RAG로 데이터 접지", fit.rag],
    ["해본 사람만 뽑힌다", fit.done_the_job],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 18px 72px" }}>
      <header style={{ marginBottom: 28 }}>
        <div style={{ color: "#38bdf8", fontWeight: 700, letterSpacing: 2 }}>
          PORTFOLIO
        </div>
        <h1 style={{ margin: "6px 0 10px", fontSize: 30, lineHeight: 1.25 }}>
          CX형 AI 서비스기획자
          <br />
          <span style={{ color: "#94a3b8", fontSize: 18 }}>
            = 짓고 파는 메이커 (Experience-led Product Builder)
          </span>
        </h1>
        <p style={{ color: "#cbd5e1", margin: 0, lineHeight: 1.7 }}>
          {state.vision.north_star}
        </p>
      </header>

      {/* Flagship: neural-flow */}
      {flagship && (
        <section
          style={{
            ...card,
            background: "linear-gradient(135deg,#38bdf822,#1e293b 60%)",
            border: "1px solid #38bdf855",
          }}
        >
          <div style={{ color: "#38bdf8", fontWeight: 700, fontSize: 12 }}>
            ★ FLAGSHIP — 내 문제를 직접 AI 제품으로 풀다
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, margin: "8px 0" }}>
            {flagship.title}
          </div>
          <div style={{ color: "#cbd5e1", lineHeight: 1.7 }}>
            {flagship.one_liner}
          </div>
          <div style={{ marginTop: 10 }}>
            {["RAG", "멀티에이전트", "vibe coding", "Notion×Calendar", "자동화"].map(
              (t) => (
                <span key={t} style={tag}>
                  {t}
                </span>
              )
            )}
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "#94a3b8" }}>
            근거: {flagship.proof}
          </div>
        </section>
      )}

      {/* 2026 시장적합도 */}
      {fitRows.length > 0 && (
        <section style={card}>
          <h2 style={{ fontSize: 14, color: "#94a3b8", margin: "0 0 12px" }}>
            2026 시장이 원하는 것 ↔ 나의 증명물
          </h2>
          {fitRows.map(([k, v]) => (
            <div
              key={k}
              style={{
                display: "flex",
                gap: 12,
                padding: "7px 0",
                borderBottom: "1px solid #334155",
                fontSize: 14,
              }}
            >
              <span style={{ width: 150, color: "#94a3b8", flexShrink: 0 }}>
                {k}
              </span>
              <span style={{ flex: 1 }}>{v}</span>
            </div>
          ))}
        </section>
      )}

      {/* 케이스 스터디 */}
      <h2 style={{ fontSize: 14, color: "#94a3b8", margin: "24px 0 12px" }}>
        핵심 프로젝트 (문제 → 설계 → 결과)
      </h2>
      {cases.map((e) => (
        <section key={e.id} style={card}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{e.title}</div>
          <div style={{ color: "#cbd5e1", lineHeight: 1.7, marginTop: 6 }}>
            {e.one_liner}
          </div>
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(e.metrics ?? []).map((m) => (
              <span
                key={m}
                style={{
                  ...tag,
                  color: "#fbbf24",
                  borderColor: "#fbbf2455",
                  background: "#fbbf2411",
                }}
              >
                {m}
              </span>
            ))}
            {(e.serves ?? []).map((s) => (
              <span key={s} style={tag}>
                {s}
              </span>
            ))}
          </div>
        </section>
      ))}

      <footer
        style={{
          textAlign: "center",
          color: "#475569",
          fontSize: 12,
          marginTop: 28,
        }}
      >
        neural-flow · 경험·숫자 불변 · {cm?.version ?? ""}
      </footer>
    </main>
  );
}
