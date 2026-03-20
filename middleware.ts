import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // === 보안 헤더 (모든 요청에 적용) ===
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  // CSP (Content Security Policy) — XSS 방지의 핵심
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // Next.js가 사용하는 인라인 스크립트 허용
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // YouTube 임베드 + 이미지 소스 허용
      "img-src 'self' data: https://i.ytimg.com https://*.googleusercontent.com https://*.naver.net",
      "frame-src https://www.youtube.com https://youtube.com",
      // API 호출 허용 대상
      "connect-src 'self' https://generativelanguage.googleapis.com https://openapi.naver.com https://www.googleapis.com https://news.google.com",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );

  // === API 라우트 CORS 설정 ===
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin") || "";

    // 허용된 도메인만 CORS 허용
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      // Vercel 배포 시 자동 생성되는 URL 패턴
    ];

    // 개발 모드에서는 localhost 허용
    const isDev = process.env.NODE_ENV === "development";
    const isAllowed =
      isDev ||
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app");

    if (isAllowed) {
      response.headers.set("Access-Control-Allow-Origin", origin || "*");
    }

    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, x-app-secret"
    );
    response.headers.set("Access-Control-Max-Age", "86400");

    // Preflight 요청 처리
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: response.headers });
    }
  }

  return response;
}

export const config = {
  matcher: [
    // 정적 파일 제외한 모든 경로
    "/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest.json).*)",
  ],
};
