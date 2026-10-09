// E2E 훅 — 실제 Electron 앱 안에서 IPC 경로(window.nf)를 그대로 호출해 검증한다.
// launch.js 가 NF_TEST_HOOK 으로 이 파일을 넘기면 main.js 가 스케줄러를 끄고 run() 을 부른다.
// 외부 네트워크 없이: 가짜 Gemini · 구글(로그인·캘린더) · ICS · RSS 를 로컬 서버로, Claude Code 는 가짜 CLI 로.

const fs = require('fs')
const path = require('path')
const http = require('http')
const { execFileSync } = require('child_process')
const A = require('../../renderer/shared/agenda.js')

const PORT = Number(process.env.NF_E2E_PORT || 47811)
const SHOT_DIR = process.env.NF_SHOT_DIR // 있으면 화면 캡처 저장
const OWNER = 'jun1234sang@gmail.com' // neural-flow/config.json 의 userEmail
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const today = A.ymd(new Date())
const tomorrow = A.addDays(today, 1)
const compact = (d) => d.replace(/-/g, '')
const at = (day, hh) => new Date(`${day}T${hh}:00`).toISOString() // 로컬 시각 → ISO

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:공유
BEGIN:VEVENT
UID:i1
DTSTART;VALUE=DATE:${compact(A.addDays(today, 2))}
DTEND;VALUE=DATE:${compact(A.addDays(today, 3))}
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:주간 종일 이벤트
END:VEVENT
END:VCALENDAR`

const UPDATE_BYTES = Buffer.from('fake installer')
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
${[1, 2, 3].map((i) => `<item><title>테스트 뉴스 ${i}</title><link>https://example.com/${i}</link><pubDate>${new Date(Date.now() - i * 3600e3).toUTCString()}</pubDate></item>`).join('')}
</channel></rss>`

function geminiReply(prompt) {
  if (prompt.includes('일정 코치')) return { answer: '겹침과 이동 시간을 확인하세요.', observations: [], questions: ['장소가 정해졌나요?'] }
  if (prompt.includes('일정 비서')) return { kind: 'event', title: '커피챗', date: tomorrow, start: '15:00', minutes: 60, domain: '🤝 관계·사랑', reply: 'ok' }
  if (prompt.includes('영어 회화 코치'))
    return {
      expression: "Let's touch base tomorrow.",
      meaning: '내일 잠깐 이야기 나눠요.',
      situation: '짧게 진행 상황을 맞출 때',
      dialogue: [
        { speaker: 'A', en: "Let's touch base tomorrow.", ko: '내일 잠깐 얘기해요.' },
        { speaker: 'B', en: 'Sounds good. 10 a.m.?', ko: '좋아요. 10시 어때요?' },
      ],
      variations: ["Let's sync up."],
      tip: 'touch base = 가볍게 연락/점검',
    }
  if (prompt.includes('헤드라인')) return { bullets: ['요약 1', '요약 2', '요약 3'], pick: { title: '테스트 뉴스 1', why: '이유' } }
  const base = { greeting: '오늘도 거룩=집중.', one_thing: 'MOCK: 포트폴리오 케이스 1개 완성', one_thing_why: 'MOCK 이유', holiness_line: 'MOCK 거룩', stuck_coaching: 'MOCK 코칭', trend: 'MOCK 트렌드' }
  if (prompt.includes('[주간 모드]'))
    base.recommendations = [
      { name: 'MOCK 추천 활동 A', domain: '🫀 신체·건강', why: '운동', priority: '중간', energy: '루틴', min: 30 },
      { name: 'MOCK 추천 활동 B', domain: '💰 재정·경제', why: '예산', priority: '낮음', energy: '가벼움', min: 20 },
    ]
  return base
}

// ── 가짜 서버 ────────────────────────────────────────────────────────────────
const mock = { userEmail: OWNER, revoked: 0, created: [], tokenCalls: 0 }
const CALS = [
  { id: 'me@x', summary: '준상', primary: true, backgroundColor: '#3182f6', accessRole: 'owner', selected: true },
  { id: 'work', summary: '회사', backgroundColor: '#f04452', accessRole: 'reader', selected: true },
  { id: 'hidden', summary: '숨김', backgroundColor: '#999999', accessRole: 'reader', selected: false },
]

function startServer() {
  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const p = url.pathname
        if (p === '/cal.ics') return res.writeHead(200, { 'Content-Type': 'text/calendar' }), res.end(ICS)
        if (p.startsWith('/repos/')) {
          const sha = require('crypto').createHash('sha256').update(UPDATE_BYTES).digest('hex')
          const a = (name) => ({ name, browser_download_url: `http://127.0.0.1:${PORT}/dl`, size: UPDATE_BYTES.length, digest: `sha256:${sha}` })
          return json(res, 200, [{ tag_name: 'desktop-v9.9.9', draft: false, prerelease: false, html_url: 'x', body: '테스트', assets: [a('neural-flow-9.9.9-win-x64.exe'), a('neural-flow-9.9.9-mac-arm64.dmg'), a('neural-flow-9.9.9-mac-x64.dmg')] }])
        }
        if (p === '/dl') return res.writeHead(200), res.end(UPDATE_BYTES)
        if (p === '/feed.xml') return res.writeHead(200, { 'Content-Type': 'application/rss+xml' }), res.end(RSS)
        // 구글 OAuth
        if (p === '/o/auth') {
          const q = url.searchParams
          const ok = q.get('code_challenge_method') === 'S256' && q.get('client_id') === 'cid'
          res.writeHead(302, { Location: `${q.get('redirect_uri')}?${ok ? 'code=c1' : 'error=bad_request'}&state=${q.get('state')}` })
          return res.end()
        }
        if (p === '/o/token') {
          mock.tokenCalls++
          const f = new URLSearchParams(body)
          if (f.get('client_secret') !== 'sec') return json(res, 401, { error: 'invalid_client' })
          return json(res, 200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
        }
        if (p === '/o/userinfo') return json(res, 200, { email: mock.userEmail, email_verified: true, name: '준상' })
        if (p === '/o/revoke') return mock.revoked++, json(res, 200, {})
        // 구글 캘린더
        if (p.startsWith('/calendar/v3')) {
          if (req.headers.authorization !== 'Bearer at') return json(res, 401, { error: { message: 'unauthorized' } })
          if (p.endsWith('/calendarList')) return json(res, 200, { items: CALS })
          const m = p.match(/\/calendars\/([^/]+)\/events$/)
          if (m && req.method === 'POST') {
            const ev = JSON.parse(body)
            mock.created.push({ calendar: decodeURIComponent(m[1]), ...ev })
            return json(res, 200, { id: `new${mock.created.length}`, ...ev })
          }
          if (m) {
            const cal = decodeURIComponent(m[1])
            const items =
              cal === 'me@x'
                ? [
                    { id: 'g1', summary: '구글 팀 미팅', start: { dateTime: at(today, '10:00') }, end: { dateTime: at(today, '11:00') }, htmlLink: 'https://calendar.google.com/e/g1' },
                    { id: 'g2', summary: '구글 종일', start: { date: tomorrow }, end: { date: A.addDays(tomorrow, 1) } },
                    ...mock.created.map((c, i) => ({ id: `new${i + 1}`, summary: c.summary, start: c.start, end: c.end })),
                  ]
                : cal === 'work'
                  ? [{ id: 'w1', summary: '회사 점심', start: { dateTime: at(today, '12:00') }, end: { dateTime: at(today, '13:00') } }]
                  : [{ id: 'h1', summary: '숨김 일정', start: { date: today }, end: { date: tomorrow } }]
            return json(res, 200, { items })
          }
          return json(res, 404, { error: { message: 'not found' } })
        }
        // Gemini
        if (req.headers['x-goog-api-key'] !== 'test-key') return res.writeHead(400), res.end('{"error":"bad key"}')
        const prompt = JSON.parse(body).contents[0].parts[0].text
        json(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply(prompt)) }] } }] })
      })
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

exports.run = async ({ app, store, getWidget, openManager, getManager, setWidgetMode, toggleQuick, getQuick }) => {
  const results = []
  const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info })
  const server = await startServer()
  const base = `http://127.0.0.1:${PORT}`

  try {
    await wait(1200)
    openManager('today')
    await wait(1500)
    const m = getManager()
    const js = (code) => m.webContents.executeJavaScript(code)
    const snap = () => js('nf.snapshot()')
    const cap = async (w, name) => {
      if (!SHOT_DIR) return
      await wait(500)
      fs.writeFileSync(path.join(SHOT_DIR, name), (await w.webContents.capturePage()).toPNG())
    }

    // ── 1) 잠금 ──
    let s = await snap()
    check('처음엔 잠겨 있음 (개인 데이터 미전송)', s.locked === true && s.events === undefined && s.settings.google.allowedEmails.includes(OWNER))
    const blocked = await js("nf.saveEvent({ title: 'x', date: '2026-01-01' }).then(() => 'ok', (e) => e.message)")
    check('잠금 중 쓰기 거부', /로그인이 필요/.test(blocked), blocked)
    check('잠금 화면 렌더링 (구글 로그인 + 간편 모드)', /Google 계정으로 로그인/.test(await js('document.body.innerText')) && /간편 모드로 시작/.test(await js('document.body.innerText')))
    check('설치 파일에 구운 구글 클라이언트 자동 적용', s.settings.google.clientId === 'cid' && s.settings.google.hasSecret)
    await cap(m, 'lock-setup.png')

    // ── 2) 로그인 ──
    await js("nf.authConfig({ clientId: 'cid', clientSecret: 'sec' })")
    s = await snap()
    check('클라이언트 설정 저장 (시크릿은 화면에 안 보냄)', s.settings.google.clientId === 'cid' && s.settings.google.hasSecret && !JSON.stringify(s).includes('"sec"'))
    await cap(m, 'lock.png')

    mock.userEmail = 'intruder@example.com'
    let r = await js('nf.signIn()')
    s = await snap()
    check('다른 구글 계정 거부 + 토큰 폐기', r.ok === false && /허용되지 않은/.test(r.message) && mock.revoked === 1 && s.locked, r.message)

    mock.userEmail = OWNER
    r = await js('nf.signIn()')
    await wait(800)
    s = await snap()
    check('본인 계정 로그인 → 잠금 해제', r.ok && !s.locked && s.account.email === OWNER, r.message || r.email)
    await wait(600)
    const saved = (store.flush(), store._read()) /* 암호화돼 있어도 앱과 같은 방식으로 복호화 */
    const { safeStorage } = require('electron')
    const encOk = safeStorage.isEncryptionAvailable()
    check(
      encOk ? '리프레시 토큰은 OS 키체인으로 암호화 저장' : '리프레시 토큰 저장 (이 OS 는 키체인 없음 → 평문 표시)',
      encOk ? saved.account.refreshEnc.startsWith('enc:') && !JSON.stringify(saved).includes('"rt"') : saved.account.refreshEnc === 'raw:rt',
      saved.account.refreshEnc.slice(0, 8)
    )
    check('자동 일정 시드 없음', s.activities.length === 0 && s.events.length === 0, `활동 ${s.activities.length} · 일정 ${s.events.length}`)

    // ── 3) 구글 캘린더 ──
    for (let i = 0; i < 25 && !(await snap()).remote.calendars; i++) await wait(200)
    s = await snap()
    const g = (s.remote.events || []).filter((e) => e.source === 'google')
    check(
      '구글 캘린더 동기화 (표시 켠 캘린더만)',
      g.some((e) => e.title === '구글 팀 미팅' && e.start === '10:00' && e.color === '#3182f6') &&
        g.some((e) => e.title === '회사 점심' && e.calendar === '회사') &&
        g.some((e) => e.title === '구글 종일' && e.date === tomorrow && !e.start) &&
        !g.some((e) => e.title === '숨김 일정'),
      g.map((e) => `${e.calendar}:${e.title}@${e.date} ${e.start || '종일'}`).join(', ')
    )
    await js(`nf.saveSettings({ google: { calendarIds: ['me@x'] } })`)
    await wait(1200)
    s = await snap()
    check('표시할 캘린더 선택 반영', !s.remote.events.some((e) => e.title === '회사 점심') && s.remote.events.some((e) => e.title === '구글 팀 미팅'))
    check('토큰 재사용 (매번 새로 받지 않음)', mock.tokenCalls === 2, `token calls ${mock.tokenCalls}`)

    // ── 4) 빠른 입력: 규칙 → 구글 캘린더에 생성 ──
    await js("nf.saveSettings({ engine: 'gemini' })") // 키 없음 → 규칙
    let item = await js("nf.previewInput('내일 오후 3시 커피챗 강남 2시간')")
    check('입력 해석(규칙)', item.kind === 'event' && item.date === tomorrow && item.start === '15:00' && item.minutes === 120 && item.source === 'rules', JSON.stringify(item))
    r = await js(`nf.commitInput(${JSON.stringify(item)})`)
    const made = mock.created[0]
    check(
      '구글 캘린더에 일정 생성',
      r.ok && /구글/.test(r.message) && made?.start?.dateTime === `${tomorrow}T15:00:00` && made?.end?.dateTime === `${tomorrow}T17:00:00` && made.calendar === 'primary',
      JSON.stringify(made)
    )
    r = await js("nf.previewInput('!자소서 1문항 끝내기').then((i) => nf.commitInput(i))")
    s = await snap()
    check('입력 → 오늘의 단 하나', s.brief?.one_thing === '자소서 1문항 끝내기' && s.brief.source === 'manual')
    await js("nf.previewInput('메모: 위젯 다크모드 아이디어').then((i) => nf.commitInput(i))")
    await js("nf.previewInput('포트폴리오 케이스 정리').then((i) => nf.commitInput(i))")
    s = await snap()
    check('입력 → 메모 / 활동 보드', s.notes.some((n) => n.text === '위젯 다크모드 아이디어') && s.activities.some((a) => a.name === '포트폴리오 케이스 정리' && a.status === '승인됨'))

    // ── 5) 엔진: Gemini ──
    r = await js("nf.setKey('wrong-key')")
    check('잘못된 Gemini 키 → ok:false', r.ok === false, r.message?.slice(0, 40))
    r = await js("nf.setKey('test-key')")
    s = await snap()
    check('Gemini 키 저장 + 스냅샷에 키 원문 없음', r.ok && s.settings.hasKey && s.settings.provider === 'gemini' && !JSON.stringify(s).includes('test-key'))
    item = await js("nf.previewInput('내일 3시 커피챗')")
    check('입력 해석(Gemini)', item.source === 'gemini' && item.title === '커피챗' && item.start === '15:00', JSON.stringify(item))
    const before = (await snap()).activities.length
    for (const job of ['brief', 'weekly', 'english', 'news']) await js(`nf.run('${job}')`)
    s = await snap()
    check('자동 추천·뉴스·영어 생성 경로 제거', s.activities.length === before && !s.english && !s.news.items.length && !s.coachTips.length)
    const engine = await js('nf.detectEngine()')
    check('ChatGPT 구독 로그인 감지', engine.codexStatus?.subscription === true)
    await js("nf.saveSettings({ engine: 'codex' })")
    item = await js("nf.previewInput('내일 오후 3시 커피챗')")
    check('Codex 구독으로 입력 해석 + 입력 조언', item.source === 'codex' && item.title === 'CODEX: 커피챗' && !!item.coaching)
    const eventCount = (await snap()).events.length
    r = await js("nf.reviewSchedule('일정을 잘 쓰려면?')")
    check('LLM 일정 코칭은 일정 추가 없이 조언만', r.ok && r.source === 'codex' && r.answer.startsWith('CODEX:') && (await snap()).events.length === eventCount)
    await js("nf.saveSettings({ engine: 'off' })")

    // ── 7) iCal 주소도 함께 ──
    await js(`nf.saveSettings({ icsUrls: ['${base}/cal.ics'] })`)
    for (let i = 0; i < 20 && !(await snap()).remote.events.some((e) => e.calendar === '공유'); i++) await wait(200)
    s = await snap()
    check('iCal + 구글 함께 표시', s.remote.events.filter((e) => e.calendar === '공유').length === 2 && s.remote.events.some((e) => e.source === 'google'))

    // ── 8) 일정 · 마감 · 완료 ──
    const dday = A.addDays(today, 3)
    await js(`nf.saveEvent({ title: '테스트 마감', date: '${dday}', start: '09:00', deadline: true, domain: '💼 일·소명' })`)
    s = await snap()
    check('D-day 계산', A.deadlines({ events: s.events, activities: s.activities }, today).some((d) => d.title === '테스트 마감' && d.d === 3))
    await js('nf.toggleOneThing()')
    s = await snap()
    check('단 하나 완료 + 기록', s.brief.done === true && s.history.some((h) => h.date === today && h.done))
    await js(`nf.saveEvent({ title: '직접 쓴 반복 일정', date: '${today}', start: '07:00', repeat: 'daily' })`)
    s = await snap()
    const occ = A.occurrences({ events: s.events, remote: s.remote.events, activities: s.activities, doneMap: s.doneMap }, today, today)
    const routine = occ.find((o) => o.repeat === 'daily')
    await js(`nf.toggleOccurrence(${JSON.stringify(routine.key)})`)
    s = await snap()
    check('반복 일정은 날짜별로 완료', !!s.doneMap[routine.key])

    await js(`nf.saveActivity({ name: '직접 쓴 지난 할 일', date: '${A.addDays(today, -1)}', status: '예정됨' })`)
    s = await snap()
    const stale = s.activities.filter((a) => a.date && a.date < today && !['완료', '보류'].includes(a.status)).length
    const moved = await js('nf.archiveStale()')
    s = await snap()
    check('지난 활동 정리 → 보류 (삭제 안 함)', moved === stale && moved > 0 && !s.activities.some((a) => a.date && a.date < today && !['완료', '보류'].includes(a.status)), `${moved}개`)

    // ── 9) 화면 ──
    await js("location.hash = 'calendar'")
    await wait(400)
    await js("document.querySelector('[data-act=new-event]').click()")
    await wait(300)
    check('새 일정 모달 (저장 위치 선택 포함)', await js("document.getElementById('modal').open && !!document.querySelector('select[name=target]')"))
    await cap(m, 'modal.png')
    await js("document.getElementById('modal').close()")

    toggleQuick()
    await wait(1500)
    const q = getQuick()
    check('빠른 입력 창', q && q.isVisible() && (await q.webContents.executeJavaScript('!!document.getElementById("q")')))
    await q.webContents.executeJavaScript("document.getElementById('q').value = '금요일 7시 반 스터디'; document.getElementById('bar').requestSubmit()")
    await wait(1500)
    await cap(q, 'quick.png')
    q.hide()

    // ── 10) 위젯 · Win+D ──
    setWidgetMode('edit')
    await wait(1200)
    check('편집 모드 전환', (await snap()).widgetMode === 'edit')
    await cap(getWidget(), 'widget-edit.png')
    setWidgetMode('pinned')
    await wait(1500)
    if (process.platform === 'win32') {
      s = await snap()
      check('Win+D 보호 켜짐 (소유자 = 바탕화면)', s.winDesktop?.active && s.winDesktop.ownerIsDesktop, JSON.stringify(s.winDesktop))
      const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { stdio: 'ignore' })
      m.show()
      await wait(500)
      ps('(New-Object -ComObject Shell.Application).ToggleDesktop()') // = Win+D
      await wait(2000)
      s = await snap()
      // 대조군: 일반 창(관리 창)이 내려갔는지로 '바탕화면 보기'가 실제로 일어났는지 판단
      const control = m.isMinimized() || !m.isVisible()
      check(
        'Win+D 뒤에도 위젯 표시',
        s.winDesktop.visible && !s.winDesktop.iconic && getWidget().isVisible(),
        `${JSON.stringify(s.winDesktop)} · 대조군(관리 창) ${control ? '내려감 → 바탕화면 보기 실제 발생' : '그대로 → 이 러너에선 바탕화면 보기가 안 일어남(판단 보류)'}`
      )
      await cap(getWidget(), 'widget-after-win-d.png')
      ps('(New-Object -ComObject Shell.Application).ToggleDesktop()')
    }
    await cap(getWidget(), 'widget.png')
    for (const v of ['today', 'calendar', 'settings']) {
      await js(`location.hash = '${v}'`)
      await cap(m, `app-${v}.png`)
    }
    await js("nf.saveSettings({ widget: { theme: 'dark' } })")
    await wait(800)
    await cap(getWidget(), 'widget-dark.png')
    await js("location.hash = 'today'")
    await cap(m, 'app-today-dark.png')

    // ── 보안: PIN · 세션 잠금 · 가리기 · 암호화 ──
    r = await js("nf.setPin('12')")
    check('PIN 형식 검사', r.ok === false)
    r = await js("nf.setPin('2580')")
    s = await snap()
    check('PIN 설정 (해시는 화면에 안 보냄)', r.ok && s.settings.security.hasPin && !JSON.stringify(s).includes('scrypt'))
    await js('nf.lockNow()')
    s = await snap()
    const lockedWrite = await js("nf.saveEvent({ title: 'x', date: '2026-01-01' }).then(() => 'ok', (e) => e.message)")
    const draftOff = await js("nf.setInputActive(false).then(() => 'ok', (e) => e.message)")
    check('잠금 중에도 입력 종료 알림 수신 (업데이트가 막히지 않게)', draftOff === 'ok', draftOff)
    check('지금 잠그기 → 개인 데이터 숨김 + 쓰기 거부', s.locked && s.sessionLocked && !s.needsLogin && s.events === undefined && /로그인이 필요/.test(lockedWrite))
    check('PIN 잠금 화면', /PIN 을 입력하세요/.test(await js('document.body.innerText')))
    await cap(m, 'pin-lock.png')
    r = await js("nf.unlock('0000')")
    check('틀린 PIN 거부', r.ok === false)
    r = await js("nf.unlock('2580')")
    s = await snap()
    check('PIN 해제', r.ok && !s.locked)
    await js('nf.togglePrivacy()')
    await wait(400)
    check('가리기 모드 (위젯)', (await snap()).privacy && (await getWidget().webContents.executeJavaScript("document.body.classList.contains('privacy')")))
    await cap(getWidget(), 'widget-privacy.png')
    await js('nf.togglePrivacy()')
    await js("nf.setPin('')")
    await wait(500)
    const rawFile = fs.readFileSync(path.join(process.env.NF_DATA_DIR, 'neural-flow.json'), 'utf-8')
    check(
      safeStorage.isEncryptionAvailable() ? '데이터 파일 암호화 (평문 없음)' : '데이터 파일 (이 OS 는 키체인 없음 → 평문)',
      safeStorage.isEncryptionAvailable() ? rawFile.startsWith('NFENC1') && !rawFile.includes('테스트 마감') : rawFile.includes('테스트 마감'),
      rawFile.slice(0, 6)
    )

    // ── 업데이트: 확인 → 받기 → SHA-256 검증 (설치는 건너뜀) ──
    const u = await js('nf.checkUpdate()')
    if (process.platform === 'linux') {
      // 리눅스용 설치 파일은 배포하지 않는다 → 새 버전은 보이지만 설치 대상은 없음
      check('업데이트 확인 (리눅스: 설치 파일 없음)', u.version === '9.9.9' && !u.available && !u.asset)
    } else {
      check('업데이트 확인', u.available && u.version === '9.9.9' && !!u.asset, `${u.current} → ${u.version}`)
      r = await js('nf.installUpdate()')
      check('업데이트 받기 + SHA-256 검증', r.ok && r.dryRun && r.verified, JSON.stringify(r).slice(0, 80))
    }
    await js("location.hash = 'settings'")
    await cap(m, 'app-settings-security.png')

    // ── 11) 로그아웃 → 다시 잠금 ──
    await js('nf.signOut()')
    s = await snap()
    check('로그아웃 → 다시 잠금', s.locked && s.events === undefined)

    // ── 12) 간편 모드: 로그인 없이 iCal 로 시작 ──
    r = await js("nf.simpleMode('notaurl')")
    check('간편 모드: 잘못된 주소 거부', r.ok === false)
    r = await js(`nf.simpleMode('${base}/cal.ics')`)
    s = await snap()
    check('간편 모드: 로그인 없이 열림 + iCal 일정', r.ok && !s.locked && !s.account && s.remote.events.some((e) => e.calendar === '공유'), `일정 ${r.count}개`)

    await wait(600)
    const file = (store.flush(), store._read()) /* 암호화돼 있어도 앱과 같은 방식으로 복호화 */
    check('디스크 저장 + 로그아웃 시 토큰 삭제', file.events.some((e) => e.title === '테스트 마감') && file.account === null)
  } catch (e) {
    check('예외 없음', false, e.stack)
  }

  server.close()
  const failed = results.filter((r) => !r.ok)
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? `  (${r.info})` : ''}`)
  console.log(`\nE2E: ${results.length - failed.length}/${results.length} 통과`)
  app.exit(failed.length ? 1 : 0)
}
