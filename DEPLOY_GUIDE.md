# 🚀 Vercel 배포 가이드 (5분이면 끝)

## Step 1: GitHub에 코드 올리기

1. [github.com/new](https://github.com/new) 에서 새 리포 생성
   - Repository name: `my-curator`
   - **Private** 선택 (공개하면 코드가 노출됨)
   - Create repository 클릭

2. PC 터미널에서 실행:
```bash
cd "동부광성교회 영상팀/my-curator"
git init
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/본인계정/my-curator.git
git push -u origin main
```

## Step 2: Vercel에 배포

1. [vercel.com](https://vercel.com) 접속 → GitHub 계정으로 로그인
2. "Add New Project" 클릭
3. `my-curator` 리포 선택 → Import
4. **Environment Variables** 섹션에서 아래 키들을 추가:

| Name | Value |
|------|-------|
| `GEMINI_API_KEY` | (Google AI Studio에서 발급한 키) |
| `NAVER_CLIENT_ID` | (네이버 개발자센터에서 발급한 ID) |
| `NAVER_CLIENT_SECRET` | (네이버 개발자센터에서 발급한 Secret) |
| `YOUTUBE_API_KEY` | (Google Cloud Console에서 발급한 키) |
| `APP_SECRET` | (아무 랜덤 문자열 - 보안용) |

5. "Deploy" 클릭 → 완료!

## Step 3: 접속

배포가 끝나면 `https://my-curator-xxxx.vercel.app` 같은 URL이 생깁니다.
이 URL을 폰 홈 화면에 추가하면 앱처럼 사용할 수 있습니다.

### 폰 홈화면에 추가하는 법
- **iPhone**: Safari에서 URL 접속 → 공유 버튼 → "홈 화면에 추가"
- **Android**: Chrome에서 URL 접속 → 메뉴(⋮) → "홈 화면에 추가"

## ⚠️ 보안 주의

- GitHub 리포는 반드시 **Private**으로!
- `.env.local` 파일은 `.gitignore`에 포함되어 있어서 Git에 올라가지 않음
- API 키는 Vercel의 Environment Variables에만 입력 (코드에 직접 넣지 마세요)
