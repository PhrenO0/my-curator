// 빠른 입력 해석 · LLM 엔진 · 구글 캘린더 매핑 단위 테스트 (node --test)
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const http = require('http')
const { parseRules, interpret } = require('../main/input.js')
const { addMinutes } = require('../main/google.js')
const { callJson, providerOf, ready, detectClaude } = require('../main/llm.js')

const TODAY = '2026-10-06' // 화요일

test('규칙 파서: 날짜·시각·기간·종류', () => {
  const cases = [
    ['내일 오후 3시 커피챗 강남', { kind: 'event', title: '커피챗 강남', date: '2026-10-07', start: '15:00' }],
    ['10월 9일 14:30 면접 2시간', { kind: 'event', title: '면접', date: '2026-10-09', start: '14:30', minutes: 120 }],
    ['다음주 수요일 저녁 7시 반 스터디', { kind: 'event', title: '스터디', date: '2026-10-14', start: '19:30' }],
    ['금요일 운동', { kind: 'event', title: '운동', date: '2026-10-09', start: null }],
    ['모레 오전 10시에 치과', { kind: 'event', title: '치과', date: '2026-10-08', start: '10:00' }],
    ['3시 미팅', { kind: 'event', title: '미팅', date: TODAY, start: '15:00' }],
    ['오전 9시 QT', { kind: 'event', title: 'QT', date: TODAY, start: '09:00' }],
    ['10/20 제출', { kind: 'event', title: '제출', date: '2026-10-20' }],
    ['1월 3일 신년 계획', { kind: 'event', title: '신년 계획', date: '2027-01-03' }], // 지난 날짜 → 내년
    ['포트폴리오 케이스 정리', { kind: 'task', title: '포트폴리오 케이스 정리', date: null }],
    ['!자소서 1문항 끝내기', { kind: 'one_thing', title: '자소서 1문항 끝내기' }],
    ['메모: 위젯 다크모드', { kind: 'note', title: '위젯 다크모드' }],
  ]
  for (const [text, want] of cases) {
    const got = parseRules(text, TODAY)
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${text} → ${k}: ${JSON.stringify(got)}`)
  }
})

test('interpret: LLM 없으면 규칙, 형식이 틀린 LLM 응답도 규칙으로', async () => {
  const a = await interpret('내일 3시 커피챗', { today: TODAY, llm: { provider: 'none' } })
  assert.equal(a.source, 'rules')
  assert.equal(a.start, '15:00')
})

test('addMinutes: 자정 넘김 표시', () => {
  assert.equal(addMinutes('15:00', 90), '16:30')
  assert.deepEqual(addMinutes('23:30', 60), { time: '00:30', day: 1 })
})

// ── 가짜 서버로 엔진 · 구글 API 확인 ──────────────────────────────────────────
let handler = () => ({})
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const out = handler(req, body)
    res.writeHead(out.status || 200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out.json || {}))
  })
})
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', r)))
test.after(() => server.close())

test('GoogleClient: 이벤트 생성 바디(시간/종일/자정 넘김) + 401 오류 메시지', async () => {
  process.env.NF_GOOGLE_CALENDAR = `http://127.0.0.1:${server.address().port}/cal`
  delete require.cache[require.resolve('../main/google.js')]
  const { GoogleClient: GC } = require('../main/google.js')
  const bodies = []
  handler = (req, body) => {
    if (req.headers.authorization !== 'Bearer at') return { status: 401, json: { error: { message: 'Invalid Credentials' } } }
    bodies.push(JSON.parse(body))
    return { json: { id: 'x' } }
  }
  const gc = new GC({ accessToken: 'at', expiresAt: Date.now() + 3600e3 })
  await gc.createEvent('primary', { title: '면접', date: '2026-10-09', start: '14:30', minutes: 120 }, 'Asia/Seoul')
  await gc.createEvent('primary', { title: '종일', date: '2026-10-09' }, 'Asia/Seoul')
  await gc.createEvent('primary', { title: '야간', date: '2026-10-09', start: '23:30', minutes: 60 }, 'Asia/Seoul')
  assert.deepEqual(bodies[0].start, { dateTime: '2026-10-09T14:30:00', timeZone: 'Asia/Seoul' })
  assert.deepEqual(bodies[0].end, { dateTime: '2026-10-09T16:30:00', timeZone: 'Asia/Seoul' })
  assert.deepEqual(bodies[1].start, { date: '2026-10-09' })
  assert.deepEqual(bodies[1].end, { date: '2026-10-10' })
  assert.equal(bodies[2].end.dateTime, '2026-10-10T00:30:00')

  const bad = new GC({ accessToken: 'nope', expiresAt: Date.now() + 3600e3 })
  await assert.rejects(bad.createEvent('primary', { title: 'x', date: '2026-10-09' }, 'UTC'), /Invalid Credentials/)
  const noRefresh = new GC({})
  await assert.rejects(noRefresh.token(), /다시 로그인/)
})

test('엔진 선택 규칙', () => {
  assert.equal(providerOf({ key: 'k' }), 'gemini') // 옛 설정 호환
  assert.equal(providerOf({}), 'none')
  assert.equal(ready({ provider: 'claude' }), true)
  assert.equal(ready({ provider: 'gemini', key: '' }), false)
})

const FAKE = `"${process.execPath}" "${path.join(__dirname, 'e2e', 'fake-claude.js')}"`

test('Claude Code CLI 엔진: 버전 감지 + JSON 결과 파싱', async () => {
  assert.match(await detectClaude(FAKE), /9\.9\.9/)
  assert.equal(await detectClaude('definitely-not-a-real-command-xyz'), null)
  const out = await callJson({ provider: 'claude', claudeCmd: FAKE }, '일정 비서 테스트')
  assert.equal(out.kind, 'task')
  const it = await interpret('포트폴리오 정리', { today: TODAY, llm: { provider: 'claude', claudeCmd: FAKE }, profile: {} })
  assert.equal(it.source, 'claude')
  assert.match(it.title, /^CLAUDE:/)
})

test('Claude Code CLI 실패 → interpret 은 규칙으로 폴백', async () => {
  const it = await interpret('내일 3시 커피챗', {
    today: TODAY,
    llm: { provider: 'claude', claudeCmd: `"${process.execPath}" -e "process.exit(3)"` },
  })
  assert.equal(it.source, 'rules')
  assert.ok(it.error)
})
