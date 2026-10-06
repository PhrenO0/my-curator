// 구글 로그인 + 구글 캘린더 (읽기·쓰기)
//
// - OAuth 2.0 '데스크톱 앱' 흐름: 브라우저로 로그인 → 127.0.0.1 루프백으로 코드 수신 (PKCE)
// - 허용된 이메일(기본: 본인)만 통과. 다른 계정이면 토큰을 즉시 폐기하고 거부한다.
// - 리프레시 토큰은 OS 키체인(safeStorage)으로 암호화해 저장.
// 엔드포인트는 테스트에서 가짜 서버로 바꿀 수 있게 환경변수로 덮어쓸 수 있다.

const http = require('http')
const crypto = require('crypto')
const A = require('../renderer/shared/agenda.js')

const BASE = {
  auth: process.env.NF_GOOGLE_AUTH || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.NF_GOOGLE_TOKEN || 'https://oauth2.googleapis.com/token',
  revoke: process.env.NF_GOOGLE_REVOKE || 'https://oauth2.googleapis.com/revoke',
  userinfo: process.env.NF_GOOGLE_USERINFO || 'https://openidconnect.googleapis.com/v1/userinfo',
  calendar: process.env.NF_GOOGLE_CALENDAR || 'https://www.googleapis.com/calendar/v3',
}
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
]

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function postForm(url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error_description || json.error || `HTTP ${res.status}`)
  return json
}

// 브라우저 로그인 → 코드 → 토큰 → 이메일 확인
async function signIn({ clientId, clientSecret, allowedEmails, openUrl, timeoutMs = 300000 }) {
  if (!clientId) throw new Error('Google OAuth 클라이언트 ID가 필요해요 (설정 → 계정)')
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(16))

  const { code, redirectUri } = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        return res.end()
      }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<meta charset="utf-8"><body style="font-family:-apple-system,'Pretendard',sans-serif;display:grid;place-items:center;height:90vh;color:#191f28">
         <div style="text-align:center"><div style="font-size:40px">${ok ? '✅' : '⚠️'}</div>
         <h2>${ok ? '로그인 완료 — 이 창은 닫아도 돼요' : '로그인 실패'}</h2></div></body>`
      )
      clearTimeout(timer)
      server.close()
      if (ok) resolve({ code: url.searchParams.get('code'), redirectUri })
      else reject(new Error(url.searchParams.get('error') || '로그인이 취소됐어요'))
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('로그인 시간이 초과됐어요'))
    }, timeoutMs)
    let redirectUri
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}/callback`
      const url = new URL(BASE.auth)
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
        ...(allowedEmails?.length === 1 ? { login_hint: allowedEmails[0] } : {}),
      }).toString()
      openUrl(url.toString())
    })
  })

  const tok = await postForm(BASE.token, {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  const user = await (await fetch(BASE.userinfo, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json()
  const email = String(user.email || '').toLowerCase()
  const allowed = (allowedEmails || []).map((e) => e.toLowerCase().trim()).filter(Boolean)
  if (!email || user.email_verified === false || (allowed.length && !allowed.includes(email))) {
    await postForm(BASE.revoke, { token: tok.refresh_token || tok.access_token }).catch(() => {})
    throw new Error(`허용되지 않은 계정이에요: ${email || '(이메일 없음)'}`)
  }
  return {
    email,
    name: user.name || '',
    picture: user.picture || '',
    refreshToken: tok.refresh_token || '',
    accessToken: tok.access_token,
    expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
  }
}

// 액세스 토큰 자동 갱신 + 캘린더 API
class GoogleClient {
  constructor({ clientId, clientSecret, refreshToken, accessToken = '', expiresAt = 0 }) {
    Object.assign(this, { clientId, clientSecret, refreshToken, accessToken, expiresAt })
  }

  async token() {
    if (this.accessToken && Date.now() < this.expiresAt - 60000) return this.accessToken
    if (!this.refreshToken) throw new Error('다시 로그인해 주세요')
    const tok = await postForm(BASE.token, {
      client_id: this.clientId,
      ...(this.clientSecret ? { client_secret: this.clientSecret } : {}),
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    })
    this.accessToken = tok.access_token
    this.expiresAt = Date.now() + (tok.expires_in || 3600) * 1000
    return this.accessToken
  }

  async api(path, { method = 'GET', body, query } = {}) {
    const url = new URL(BASE.calendar + path)
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 204) return null
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error?.message || `Google API HTTP ${res.status}`)
    return json
  }

  async calendars() {
    const out = await this.api('/users/me/calendarList', { query: { minAccessRole: 'reader', maxResults: '250' } })
    return (out.items || []).map((c) => ({
      id: c.id,
      name: c.summaryOverride || c.summary,
      color: c.backgroundColor || '#3182f6',
      primary: !!c.primary,
      selected: c.selected !== false,
      writable: c.accessRole === 'owner' || c.accessRole === 'writer',
    }))
  }

  // 선택된 캘린더들의 일정을 앱 공용 형식으로
  async events(calendars, from, to) {
    const out = []
    const errors = []
    for (const cal of calendars) {
      try {
        let pageToken = ''
        do {
          const res = await this.api(`/calendars/${encodeURIComponent(cal.id)}/events`, {
            query: {
              timeMin: from.toISOString(),
              timeMax: to.toISOString(),
              singleEvents: 'true',
              orderBy: 'startTime',
              maxResults: '2500',
              ...(pageToken ? { pageToken } : {}),
            },
          })
          for (const ev of res.items || []) {
            if (ev.status === 'cancelled') continue
            const allDay = !!ev.start?.date
            const start = allDay ? A.parseYmd(ev.start.date) : new Date(ev.start?.dateTime)
            const end = allDay ? null : new Date(ev.end?.dateTime)
            out.push({
              uid: ev.id,
              eventId: ev.id,
              calendarId: cal.id,
              title: ev.summary || '(제목 없음)',
              date: A.ymd(start),
              start: allDay ? null : A.hm(start),
              end: end ? A.hm(end) : null,
              location: ev.location || '',
              calendar: cal.name,
              color: cal.color,
              link: ev.htmlLink || '',
              source: 'google',
            })
          }
          pageToken = res.nextPageToken || ''
        } while (pageToken)
      } catch (e) {
        errors.push({ calendar: cal.name, message: e.message })
      }
    }
    return { events: out, errors }
  }

  // {title, date, start?, end?, note?} → 구글 일정 생성
  async createEvent(calendarId, ev, timeZone) {
    const body = { summary: ev.title, description: ev.note || undefined, location: ev.location || undefined }
    if (ev.start) {
      const end = ev.end || addMinutes(ev.start, Number(ev.minutes) || 60)
      body.start = { dateTime: `${ev.date}T${ev.start}:00`, timeZone }
      body.end = { dateTime: `${end.day ? A.addDays(ev.date, 1) : ev.date}T${end.time || end}:00`, timeZone }
    } else {
      body.start = { date: ev.date }
      body.end = { date: A.addDays(ev.date, 1) }
    }
    return this.api(`/calendars/${encodeURIComponent(calendarId || 'primary')}/events`, { method: 'POST', body })
  }

  async deleteEvent(calendarId, eventId) {
    return this.api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' })
  }
}

// 'HH:mm' + n분 → 'HH:mm' (자정을 넘기면 {time, day:1})
function addMinutes(hhmm, n) {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m + n
  const time = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
  return t >= 1440 ? { time, day: 1 } : time
}

module.exports = { signIn, GoogleClient, addMinutes, SCOPES }
