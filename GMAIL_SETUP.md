# 📧 Gmail 앱 비밀번호 설정 가이드

## Gmail 앱 비밀번호란?

Google은 보안상 일반 Gmail 비밀번호로 외부 앱 로그인을 허용하지 않습니다.
대신 **앱 전용 비밀번호(16자리)**를 따로 발급받아야 합니다.

---

## Step 1: 2단계 인증 활성화 (이미 되어 있으면 건너뛰세요)

1. [myaccount.google.com](https://myaccount.google.com) 접속
2. **보안** 탭 클릭
3. **2단계 인증** → 활성화

---

## Step 2: 앱 비밀번호 발급

1. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) 접속
   - 또는: Google 계정 → 보안 → 앱 비밀번호
2. **앱 선택** → "메일" (또는 "기타(맞춤 이름)")
3. **기기 선택** → "기타" → 이름 입력: `MyCurator`
4. **생성** 클릭
5. **16자리 비밀번호** 복사 (xxxx xxxx xxxx xxxx 형태)

> ⚠️ 이 비밀번호는 한 번만 표시됩니다. 반드시 복사해 두세요!

---

## Step 3: GitHub Secrets에 등록

GitHub 리포에서: **Settings → Secrets and variables → Actions → New repository secret**

| Secret 이름 | 값 |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio에서 발급 |
| `NAVER_CLIENT_ID` | 네이버 개발자센터에서 발급 |
| `NAVER_CLIENT_SECRET` | 네이버 개발자센터에서 발급 |
| `YOUTUBE_API_KEY` | Google Cloud Console에서 발급 |
| `GMAIL_USER` | 보내는 Gmail 주소 (예: yourname@gmail.com) |
| `GMAIL_APP_PASSWORD` | Step 2에서 발급한 16자리 비밀번호 |
| `TO_EMAIL` | jun1234sang@gmail.com |

---

## Step 4: 테스트 실행

GitHub 리포 → **Actions** 탭 → **🧠 AI 일일 브리핑 발송** → **Run workflow**

성공하면 수분 내로 이메일이 도착합니다. 📬

---

## 자동 발송 스케줄

- **매일 오전 7시 KST** 자동 발송
- GitHub Actions가 서버 없이 무료로 실행

---

## 로컬에서 직접 실행하는 법 (선택)

```bash
# .env.local 파일에 API 키 입력 후:
npm run send-briefing
```

---

## 문제 해결

| 문제 | 원인 | 해결 |
|---|---|---|
| 이메일 미수신 | 스팸함 확인 | Gmail 스팸 폴더 체크 |
| 535 인증 오류 | 앱 비밀번호 오류 | 비밀번호 재발급 |
| API 오류 | 키 만료/오류 | 각 API 콘솔에서 확인 |
| Actions 실패 | Secrets 미등록 | Step 3 다시 확인 |
