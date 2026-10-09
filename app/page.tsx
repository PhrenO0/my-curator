export default function Page() {
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "64px 24px", lineHeight: 1.7 }}>
      <p style={{ color: "#38bdf8", fontWeight: 700 }}>neural-flow</p>
      <h1>내 일정</h1>
      <p>직접 입력한 일정을 Google 캘린더에서 관리하세요.</p>
      <a
        href="https://calendar.google.com/calendar/u/0/r"
        style={{ display: "inline-block", padding: "12px 20px", borderRadius: 12, background: "#3182f6", color: "white", textDecoration: "none" }}
      >
        Google 캘린더 열기
      </a>
      <p style={{ color: "#94a3b8", marginTop: 24 }}>
        모바일 Google 캘린더와 데스크톱 앱에서 같은 계정·캘린더를 사용하세요.
        데스크톱 앱은 Google 로그인 후 일정 읽기·쓰기를 지원합니다.
      </p>
      <p style={{ color: "#94a3b8" }}>
        이 웹 화면에는 캘린더 데이터를 표시하지 않습니다. 일정은 Google 캘린더에서 확인하세요.
      </p>
    </main>
  );
}
