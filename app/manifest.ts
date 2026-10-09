import type { MetadataRoute } from "next";

// 핸드폰 홈화면에 설치 가능한 PWA. (next.config 의 '향후 PWA' 메모 구현)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "neural-flow — 내 일정",
    short_name: "neural-flow",
    description: "직접 입력한 일정과 Google 캘린더",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
