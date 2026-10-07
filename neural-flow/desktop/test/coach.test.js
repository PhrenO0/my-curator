// 코칭 규칙 단위 테스트 (node --test)
const test = require('node:test')
const assert = require('node:assert/strict')
const coach = require('../main/coach.js')

const today = '2026-10-10' // 토요일 → 내일(11일)은 일요일
const ev = (date, start, end, title) => ({ date, start, end, title, done: false })

test('과부하 · 보호 시간(교회) 겹침 · 쉬는 시간 침범 · 여유 부족 · 마감', () => {
  const occ = [
    ev(today, '09:00', '13:00', '공부A'),
    ev(today, '13:05', '18:00', '공부B'),
    ev(today, '18:30', '23:30', '과제'),
    ev('2026-10-11', '14:00', '15:00', '스터디'),
  ]
  const deadlines = [{ title: '레포트', date: '2026-10-11', d: 1 }]
  const t = coach.tips({ occ, deadlines, today, nowMin: 8 * 60 })
  const all = t.map((x) => x.text).join('\n')
  assert.match(all, /오늘 일정이 \d+(\.\d)?시간/)
  assert.match(all, /'스터디'.*교회/)
  assert.match(all, /'과제'.*23:00 이후/)
  assert.match(all, /'공부A' → '공부B' 사이 여유가 5분/)
  assert.match(all, /D-1 레포트/)
  assert.equal(t[0].level, 'warn')
  assert.ok(t.length <= 6)
})

test('일정이 없으면 쉬라고 · 끄면 조용', () => {
  const t = coach.tips({ occ: [], deadlines: [], today, nowMin: 600 })
  assert.equal(t.length, 1)
  assert.equal(t[0].level, 'good')
  assert.deepEqual(coach.tips({ occ: [ev(today, '09:00', '20:00', 'x')], today, coach: { enabled: false } }), [])
})

test('AI 엔진이 없으면 규칙 점검으로 답한다', async () => {
  const r = await coach.ask('이번 주 괜찮아?', { occ: [ev(today, '22:00', '23:50', '야간')], deadlines: [], today, now: new Date(2026, 9, 10, 9), llm: { provider: 'none' } })
  assert.equal(r.source, 'rules')
  assert.match(r.answer, /야간/)
})
