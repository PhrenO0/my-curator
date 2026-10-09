const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { issues, commitBatch } = require('../renderer/shared/input-review.js')
const { interpret } = require('../main/input.js')
let answer
let seenPrompt
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => body += c)
  req.on('end', () => {
    seenPrompt = JSON.parse(body).contents[0].parts[0].text
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }))
  })
})
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.NF_GEMINI_BASE = `http://127.0.0.1:${server.address().port}`
  // llm.js is first loaded when interpret is called in this worker.
  delete require.cache[require.resolve('../main/llm.js')]
  delete require.cache[require.resolve('../main/input.js')]
})
test.after(() => server.close())
const options = { today: '2026-10-09', llm: { provider: 'gemini', key: 'test-key' }, timeZone: 'Asia/Seoul' }
const event = (title, date) => ({ kind: 'event', title, date, start: '15:00', end: '17:00', location: '강남', summary: '참가 공지' })

test('공지의 행사·신청 마감 모두 추출하고 원문·장소·종료 시각 보존', async () => {
  answer = { items: [event('행사', '2026-10-15'), { kind: 'event', title: '신청 마감', date: '2026-10-12', start: null }] }
  const text = '행사 공지\n10월 15일 오후 3~5시 강남\n신청 마감은 10월 12일'
  const out = await require('../main/input.js').interpret(text, options)
  assert.equal(out.kind, 'batch')
  assert.equal(out.items.length, 2)
  assert.equal(out.items[0].note, text)
  assert.equal(out.items[0].location, '강남')
  assert.equal(out.items[0].end, '17:00')
  assert.equal(out.items[1].date, '2026-10-12')
  assert.match(seenPrompt, /Asia\/Seoul/)
  assert.match(seenPrompt, /서로 다른 일정/)
})
test('날짜 없는 일정·잘못된 날짜는 오늘로 채우지 않는다', async () => {
  answer = { items: [{ kind: 'event', title: '미팅', date: null, start: '15:00' }] }
  let out = await require('../main/input.js').interpret('오후 3시 미팅', options)
  assert.equal(out.date, null)
  assert.ok(issues(out).includes('날짜를 확인해 주세요'))
  answer = { items: [{ kind: 'event', title: '미팅', date: '2026-02-30', start: '25:90' }] }
  out = await require('../main/input.js').interpret('미팅 공지\n2월 30일', options)
  assert.equal(out.date, null)
  assert.equal(out.start, null)
  assert.equal(out.warnings.length, 2)
})
test('잘못된 LLM 응답은 오류가 보이는 규칙 미리보기로 돌아온다', async () => {
  answer = { arbitrary: 'wrong schema' }
  const out = await require('../main/input.js').interpret('내일 오후 3시 미팅', options)
  assert.equal(out.source, 'rules')
  assert.equal(out.date, '2026-10-10')
  assert.match(out.error, /AI 해석 실패/)
})
test('공지 안에 날짜가 없으면 규칙 모드에서도 저장 전 날짜 확인', async () => {
  const out = await interpret('공지\n다음 모임 장소는 강남입니다', { ...options, llm: { provider: 'none' } })
  assert.equal(out.kind, 'event')
  assert.equal(out.date, null)
  assert.ok(issues(out).length)
})
test('일괄 저장: 잘못된 항목이 있으면 하나도 저장하지 않는다', async () => {
  let writes = 0
  const result = await commitBatch({ items: [event('첫 일정', '2026-10-15'), event('날짜 없음', null)] }, async () => { writes++; return { ok: true } })
  assert.equal(result.ok, false)
  assert.equal(writes, 0)
})
test('일괄 저장 일부 실패 시 재시도 대상은 실패한 일정만', async () => {
  const calls = []
  const batch = { items: [event('행사', '2026-10-15'), event('신청', '2026-10-12')] }
  const result = await commitBatch(batch, async (x) => { calls.push(x.title); return { ok: x.title === '행사', message: '연결 오류' } })
  assert.equal(result.saved, 1)
  assert.deepEqual(result.remaining.map((x) => x.title), ['신청'])
  const retry = await commitBatch({ items: result.remaining }, async (x) => { calls.push(x.title); return { ok: true } })
  assert.equal(retry.ok, true)
  assert.deepEqual(calls, ['행사', '신청', '신청'])
})

test('LLM 일정 코칭: 실제 일정만 보내고 답변·확인 질문을 반환한다', async () => {
  answer = { answer: '두 약속 사이 이동 시간을 확인하세요.', observations: ['15시 약속이 있어요.'], questions: ['이동할 장소는 어디인가요?'] }
  const { review } = require('../main/schedule-coach.js')
  const result = await review('일정을 잘 쓰려면?', { today: options.today, timeZone: 'Asia/Seoul', llm: options.llm, items: [event('내 약속','2026-10-15')] })
  assert.equal(result.ok, true)
  assert.equal(result.questions.length, 1)
  assert.match(seenPrompt, /캘린더를 수정하지 않는다/)
  assert.match(seenPrompt, /내 약속/)
  const missing = await review('test', { llm: {provider:'none'} })
  assert.equal(missing.ok,false)
  assert.match(missing.message,/구독 로그인/)
})
