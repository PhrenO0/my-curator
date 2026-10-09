import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "🌊 neural-flow",
  description: "직접 입력한 일정과 Google 캘린더",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "neural-flow",
  },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
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
