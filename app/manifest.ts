import type { MetadataRoute } from "next";

// 핸드폰 홈화면에 설치 가능한 PWA. (next.config 의 '향후 PWA' 메모 구현)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "neural-flow — 이상적인 삶",
    short_name: "neural-flow",
    description: "오늘의 단 하나 · 9개 영역 · 이번 주",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
