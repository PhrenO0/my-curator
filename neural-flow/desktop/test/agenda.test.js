// 일정 계산 코어 단위 테스트 (node --test)
const test = require('node:test')
const assert = require('node:assert/strict')
const A = require('../renderer/shared/agenda.js')

test('날짜 유틸: 월말·연말 넘김', () => {
  assert.equal(A.addDays('2026-09-30', 1), '2026-10-01')
  assert.equal(A.addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(A.diffDays('2026-09-28', '2026-10-01'), 3)
  assert.equal(A.weekday('2026-09-28'), 1) // 월요일
})

test('반복 규칙: 매일 / 평일 / 매주 / 매월 / until', () => {
  const base = { date: '2026-09-28' }
  assert.ok(A.occursOn({ ...base, repeat: 'daily' }, '2026-10-04'))
  assert.ok(!A.occursOn({ ...base, repeat: 'daily' }, '2026-09-27'), '시작일 이전은 없음')
  assert.ok(A.occursOn({ ...base, repeat: 'weekdays' }, '2026-10-02')) // 금
  assert.ok(!A.occursOn({ ...base, repeat: 'weekdays' }, '2026-10-03')) // 토
  assert.ok(A.occursOn({ ...base, repeat: 'weekly' }, '2026-10-05'))
  assert.ok(!A.occursOn({ ...base, repeat: 'weekly' }, '2026-10-06'))
  assert.ok(A.occursOn({ ...base, repeat: 'monthly' }, '2026-10-28'))
  assert.ok(!A.occursOn({ ...base, repeat: 'daily', until: '2026-09-30' }, '2026-10-01'))
})

test('occurrences: 로컬·구글·활동을 합쳐 시간순 정렬, 완료 상태 반영', () => {
  const events = [
    { id: 'e1', title: '저녁 점검', date: '2026-09-01', start: '22:40', repeat: 'daily', domain: '✝️ 영성·내면' },
    { id: 'e2', title: '마감', date: '2026-09-28', start: '09:00', deadline: true },
  ]
  const remote = [{ uid: 'g1', title: '구글 미팅', date: '2026-09-28', start: '15:00', end: '16:00' }]
  const activities = [
    { id: 'a1', name: '종일 활동', date: '2026-09-28', status: '예정됨' },
    { id: 'a2', name: '보류 활동', date: '2026-09-28', status: '보류' },
    { id: 'a3', name: '완료 활동', date: '2026-09-28', status: '완료' },
  ]
  const doneMap = { 'e1@2026-09-28': true }
  const out = A.occurrences({ events, remote, activities, doneMap }, '2026-09-28', '2026-09-28')
  assert.deepEqual(
    out.map((o) => o.title),
    ['종일 활동', '완료 활동', '마감', '구글 미팅', '저녁 점검']
  )
  assert.ok(!out.some((o) => o.title === '보류 활동'), '보류는 캘린더에 안 나옴')
  assert.equal(out.find((o) => o.id === 'e1').done, true)
  assert.equal(out.find((o) => o.id === 'a3').done, true)
  assert.equal(out.find((o) => o.id === 'e1').color, A.DOMAIN_COLORS['영성·내면'])
})

test('deadlines: D-1 ~ D+14, 반복 일정 제외, 높은 우선순위 활동은 3일 이내', () => {
  const events = [
    { id: '1', title: '어제 마감', date: '2026-09-27', deadline: true },
    { id: '2', title: '2주 뒤', date: '2026-10-12', deadline: true },
    { id: '3', title: '너무 먼', date: '2026-10-13', deadline: true },
    { id: '4', title: '반복', date: '2026-09-28', deadline: true, repeat: 'weekly' },
    { id: '5', title: '마감 아님', date: '2026-09-29' },
  ]
  const activities = [
    { id: 'a', name: '급한 활동', date: '2026-09-30', priority: '높음', status: '예정됨' },
    { id: 'b', name: '완료된 급한 활동', date: '2026-09-30', priority: '높음', status: '완료' },
  ]
  const out = A.deadlines({ events, activities }, '2026-09-28')
  assert.deepEqual(
    out.map((d) => [d.title, d.d]),
    [
      ['어제 마감', -1],
      ['급한 활동', 2],
      ['2주 뒤', 14],
    ]
  )
  assert.equal(A.dLabel(0), 'D-DAY')
  assert.equal(A.dLabel(3), 'D-3')
  assert.equal(A.dLabel(-1), 'D+1')
})

test('monthGrid: 일요일 시작 6주, 이번 달 표시', () => {
  const cells = A.monthGrid(2026, 8) // 2026년 9월
  assert.equal(cells.length, 42)
  assert.equal(cells[0].date, '2026-08-30')
  assert.equal(cells[0].weekday, 0)
  assert.ok(cells.find((c) => c.date === '2026-09-01').inMonth)
  assert.ok(!cells[0].inMonth)
})

test('domainColor / domainEmoji: 이모지가 붙은 영역 이름', () => {
  assert.equal(A.domainColor('💼 일·소명'), A.DOMAIN_COLORS['일·소명'])
  assert.equal(A.domainEmoji('💼 일·소명'), '💼')
  assert.equal(A.domainEmoji('일·소명'), '')
  assert.equal(A.formatKoreanDate('2026-09-28'), '9월 28일 월요일')
})
