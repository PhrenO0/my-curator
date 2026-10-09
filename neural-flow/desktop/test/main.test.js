// 메인 프로세스 모듈 단위 테스트 — Electron 없이 Node 로 돈다 (node --test)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const ical = require('node-ical')

// ── 가짜 Gemini 서버 ─────────────────────────────────────────────────────────
let reply = () => ({})
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const r = reply(JSON.parse(body).contents[0].parts[0].text, req)
    if (r.status) {
      res.writeHead(r.status)
      return res.end('fail')
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: r.text }] } }] }))
  })
})

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.NF_GEMINI_BASE = `http://127.0.0.1:${server.address().port}`
})
test.after(() => server.close())

const brain = () => require('../main/brain.js') // NF_GEMINI_BASE 설정 뒤에 불러오기

function sampleData(overrides = {}) {
  return {
    settings: { userName: '준상', englishLevel: '중급' },
    profile: {
      vision: { north_star: 'AI 서비스기획자' },
      goals: {},
      domains: [{ name: '💼 일·소명' }, { name: '🫀 신체·건강' }, { name: '💰 재정·경제' }],
    },
    activities: [
      { name: '지난 활동', domain: '💼 일·소명', priority: '높음', date: '2026-06-01', status: '제안됨' },
      { name: '아침 루틴', domain: '🫀 신체·건강', priority: '높음', repeat: '매일', energy: '루틴', status: '제안됨' },
      { name: '포트폴리오 정리', domain: '💼 일·소명', priority: '중간', status: '제안됨' },
    ],
    history: [],
    englishHistory: [],
    ...overrides,
  }
}
const ctx = { today: '2026-09-28', mode: 'daily', todayAgenda: [], deadlines: [] }

test('브리핑 폴백: 지난 활동·매일 루틴은 건너뛰고 미완료 활동을 고른다', async () => {
  const b = await brain().makeBrief(sampleData(), { key: '' }, ctx)
  assert.equal(b.source, 'fallback')
  assert.equal(b.one_thing, '포트폴리오 정리')
  assert.match(b.stuck_coaching, /재정·경제|신체·건강/)
})

test('브리핑 폴백: 마감이 있으면 마감이 최우선', async () => {
  const b = await brain().makeBrief(sampleData(), { key: '' }, { ...ctx, deadlines: [{ title: '자소서 제출', d: 2 }] })
  assert.equal(b.one_thing, '자소서 제출')
  assert.match(b.one_thing_why, /D-2/)
})

test('Gemini 응답(코드펜스 포함)을 파싱하고, 키는 헤더로만 보낸다', async () => {
  let seen
  reply = (prompt, req) => {
    seen = { key: req.headers['x-goog-api-key'], url: req.url, prompt }
    return { text: '```json\n{"one_thing":"AI 선정","one_thing_why":"이유"}\n```' }
  }
  const b = await brain().makeBrief(sampleData(), { key: 'k-123', model: 'gemini-2.5-flash' }, ctx)
  assert.equal(b.source, 'gemini')
  assert.equal(b.one_thing, 'AI 선정')
  assert.equal(seen.key, 'k-123')
  assert.ok(!seen.url.includes('k-123'), 'URL 에 키가 들어가면 안 됨')
  assert.match(seen.url, /gemini-2\.5-flash:generateContent/)
  assert.match(seen.prompt, /AI 서비스기획자/)
})

test('Gemini 실패 → 폴백 + 오류 기록 (앱이 죽지 않음)', async () => {
  reply = () => ({ status: 500 })
  const b = await brain().makeBrief(sampleData(), { key: 'k', model: 'm' }, ctx)
  assert.equal(b.source, 'fallback')
  assert.match(b.error, /HTTP 500/)
})

test('주간 모드 프롬프트에 추천 요청이 들어간다', async () => {
  let prompt
  reply = (p) => {
    prompt = p
    return { text: '{"one_thing":"x","recommendations":[{"name":"r"}]}' }
  }
  const b = await brain().makeBrief(sampleData(), { key: 'k', model: 'm' }, { ...ctx, mode: 'weekly' })
  assert.match(prompt, /\[주간 모드\]/)
  assert.equal(b.recommendations[0].name, 'r')
})

test('영어 폴백: 최근에 쓴 표현은 피한다', async () => {
  const first = await brain().makeEnglish(sampleData(), { key: '' }, ctx)
  assert.equal(first.source, 'fallback')
  assert.ok(first.expression && first.dialogue.length >= 2)
  const second = await brain().makeEnglish(sampleData({ englishHistory: [first] }), { key: '' }, ctx)
  assert.notEqual(second.expression, first.expression)
})

test('영어: 형식이 틀린 AI 응답은 폴백', async () => {
  reply = () => ({ text: '{"expression":"only"}' })
  const e = await brain().makeEnglish(sampleData(), { key: 'k', model: 'm' }, ctx)
  assert.equal(e.source, 'fallback')
})

test('영어 폴백 표현집: 21개, 필수 필드 모두 있음', () => {
  const { ENGLISH_FALLBACK } = require('../main/english-fallback.js')
  assert.equal(ENGLISH_FALLBACK.length, 21)
  for (const e of ENGLISH_FALLBACK) {
    assert.ok(e.expression && e.meaning && e.situation && e.tip, e.expression)
    assert.ok(e.dialogue.every((l) => l.speaker && l.en && l.ko), e.expression)
  }
  assert.equal(new Set(ENGLISH_FALLBACK.map((e) => e.expression)).size, 21, '중복 없음')
})

// ── 캘린더(ICS) ──────────────────────────────────────────────────────────────
test('ICS: 반복 일정 펼침 + 종일/시간 일정 + 로컬 시각 변환', () => {
  const { toItems } = require('../main/calendar.js')
  const parsed = ical.sync.parseICS(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a
DTSTART;VALUE=DATE:20260930
DTEND;VALUE=DATE:20261001
SUMMARY:종일
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART;TZID=Asia/Seoul:20260929T090000
DTEND;TZID=Asia/Seoul:20260929T100000
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:주간 회의
END:VEVENT
END:VCALENDAR`)
  const items = toItems(parsed, new Date(2026, 8, 1), new Date(2026, 10, 1), '회사')
  const allDay = items.find((i) => i.title === '종일')
  assert.equal(allDay.date, '2026-09-30')
  assert.equal(allDay.start, null)
  const weekly = items.filter((i) => i.title === '주간 회의')
  assert.equal(weekly.length, 3)
  assert.ok(weekly.every((i) => i.calendar === '회사'))
  if (process.env.TZ === 'Asia/Seoul') {
    assert.deepEqual(
      weekly.map((i) => `${i.date} ${i.start}-${i.end}`),
      ['2026-09-29 09:00-10:00', '2026-10-06 09:00-10:00', '2026-10-13 09:00-10:00']
    )
  }
})

// ── 저장소 ───────────────────────────────────────────────────────────────────
test('Store: 자동 일정 없이 시작 + 새 설정 기본값 병합 + 직접 일정 디스크 저장', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-store-'))
  const statePath = path.join(dir, 'state.json')
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      vision: { core_axis: 'x' },
      domains: [{ name: '💼 일·소명', sub: [] }],
      fixed_blocks: [{ title: '[마감] 제출', date: '2026-10-01T09:00' }, { title: '반복 블록', when: '평일' }],
      daily_anchors: [{ title: 'QT', time: '07:00', domain: '✝️ 영성·내면' }],
      activities: [{ name: '활동', status: '제안됨' }],
    })
  )
  process.env.NF_STATE_JSON = statePath
  delete require.cache[require.resolve('../main/store.js')]
  const { Store } = require('../main/store.js')

  const s = new Store(dir).load()
  const d = s.get()
  assert.equal(d.activities.length, 0)
  assert.equal(d.events.length, 0)
  assert.equal(d.brief, null)
  assert.equal(d.settings.engine, 'auto')

  // 옛 버전 파일(새 설정 키 없음)도 기본값으로 채워진다
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'neural-flow.json'), 'utf-8'))
  delete saved.settings.widget.showCalendar
  delete saved.settings.schedule
  fs.writeFileSync(path.join(dir, 'neural-flow.json'), JSON.stringify(saved))
  const s2 = new Store(dir).load()
  assert.equal(s2.get().settings.widget.showCalendar, true)
  assert.equal(s2.get().settings.widget.showCoach, false)

  let notified = 0
  s2.onChange(() => notified++)
  s2.update((x) => x.events.push({ id: 'n', title: '새 일정', date: '2026-10-02' }))
  s2.flush()
  assert.equal(notified, 1)
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'neural-flow.json'), 'utf-8'))
  assert.ok(onDisk.events.some((e) => e.title === '새 일정'))
  delete process.env.NF_STATE_JSON
})

test('캘린더 전환: 직접 쓴 일정은 보존하고 자동 앵커·미승인 제안만 정리한다', () => {
  const { Store } = require('../main/store.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-migration-'))
  fs.writeFileSync(path.join(dir, 'neural-flow.json'), JSON.stringify({
    settings: { engine: 'auto', widget: { showCoach: true } },
    events: [
      { id: 'manual', title: '내 약속', date: '2026-10-12', note: '직접 입력' },
      { id: 'anchor', title: '자동 루틴', note: '데일리 앵커 (state.json)' },
    ],
    activities: [{ id: 'suggestion', status: '제안됨' }, { id: 'accepted', status: '승인됨' }],
    account: { email: 'me@example.com' },
    brief: { one_thing: '자동 선정' },
  }))
  const s = new Store(dir).load()
  assert.deepEqual(s.get().events.map((e) => e.id), ['manual'])
  assert.deepEqual(s.get().activities.map((a) => a.id), ['accepted'])
  assert.equal(s.get().account.email, 'me@example.com')
  assert.equal(s.get().brief, null)
  assert.equal(s.get().settings.engine, 'auto')
  // Migration is one-time: a newly entered suggestion is not deleted on later startup.
  s.update((d) => d.activities.push({ id: 'new-manual', status: '제안됨' }))
  s.flush()
  assert.equal(new Store(dir).load().get().activities.length, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})
