import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /knowledge 페이지가 런타임에 읽는 지식DB 파일을 서버 번들에 포함(Vercel)
  outputFileTracingIncludes: {
    "/knowledge": ["./youtube_brain/knowledge.jsonl"],
  },
  // 향후 PWA 설정 추가 예정
};

export default nextConfig;
