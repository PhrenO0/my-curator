import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "🌊 neural-flow",
  description: "이상적인 삶 운영 대시보드 — 오늘의 단 하나",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          background: "#0f172a",
          color: "#e2e8f0",
          fontFamily:
            "'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {children}
      </body>
    </html>
  );
}
