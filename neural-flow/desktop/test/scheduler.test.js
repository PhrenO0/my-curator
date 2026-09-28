// 스케줄러 단위 테스트 — 시계를 가짜로 돌려 '언제 무엇이 실행되는지' 확인 (node --test)
const test = require('node:test')
const assert = require('node:assert/strict')
const { createScheduler } = require('../main/scheduler.js')

function fakeStore(overrides = {}) {
  const data = {
    settings: {
      icsUrls: [],
      schedule: { briefTime: '07:00', checkinTime: '22:00', weeklyDay: 0, weeklyTime: '20:00', newsEveryHours: 3 },
    },
    brief: null,
    news: { fetchedAt: new Date(2026, 8, 28, 0, 0).toISOString() },
    remote: {},
    lastRun: {},
    ...overrides,
  }
  return { get: () => data, update: (fn) => fn(data), data }
}

function fakeJobs() {
  const calls = []
  const j = (name) => async () => calls.push(name)
  return {
    calls,
    jobs: {
      morning: j('morning'),
      weekly: j('weekly'),
      checkin: () => calls.push('checkin'),
      news: j('news'),
      calendar: j('calendar'),
      onNewDay: () => calls.push('newDay'),
    },
  }
}

const at = (t, h, m) => t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 28, h, m) }) // 2026-09-28 (월)

test('첫 실행: 예약 시각 전이라도 오늘 브리핑이 없으면 바로 만든다', async (t) => {
  at(t, 3, 0)
  const store = fakeStore()
  const { calls, jobs } = fakeJobs()
  await createScheduler(store, jobs).tick()
  assert.ok(calls.includes('morning'))
  assert.equal(store.data.lastRun.brief, '2026-09-28')
  assert.equal(store.data.lastRun.everRan, true)
})

test('이미 돌린 적이 있으면 07:00 전에는 기다린다', async (t) => {
  at(t, 6, 59)
  const store = fakeStore({ lastRun: { brief: '2026-09-27', everRan: true } })
  const { calls, jobs } = fakeJobs()
  await createScheduler(store, jobs).tick()
  assert.ok(!calls.includes('morning'))
})

test('07:00 이후 켜지면 따라잡고, 같은 날 두 번 돌지 않는다', async (t) => {
  at(t, 9, 30)
  const store = fakeStore({ lastRun: { brief: '2026-09-27', everRan: true } })
  const { calls, jobs } = fakeJobs()
  const s = createScheduler(store, jobs)
  await s.tick()
  await s.tick()
  assert.equal(calls.filter((c) => c === 'morning').length, 1)
})

test('저녁 체크인은 22:00 이후 하루 한 번', async (t) => {
  at(t, 22, 5)
  const store = fakeStore({ lastRun: { brief: '2026-09-28', everRan: true } })
  const { calls, jobs } = fakeJobs()
  const s = createScheduler(store, jobs)
  await s.tick()
  await s.tick()
  assert.equal(calls.filter((c) => c === 'checkin').length, 1)
})

test('주간 추천은 설정한 요일에만', async (t) => {
  at(t, 20, 30) // 월요일
  const store = fakeStore({ lastRun: { brief: '2026-09-28', everRan: true } })
  const { calls, jobs } = fakeJobs()
  await createScheduler(store, jobs).tick()
  assert.ok(!calls.includes('weekly'), '일요일(0) 설정인데 월요일에 돌면 안 됨')

  store.data.settings.schedule.weeklyDay = 1
  await createScheduler(store, jobs).tick()
  assert.ok(calls.includes('weekly'))
})

test('뉴스는 간격이 지났을 때만, ICS 는 주소가 있을 때만', async (t) => {
  at(t, 2, 0) // 뉴스 마지막 00:00 → 2시간 경과 (간격 3시간)
  const store = fakeStore({ lastRun: { brief: '2026-09-28', everRan: true } })
  const { calls, jobs } = fakeJobs()
  await createScheduler(store, jobs).tick()
  assert.ok(!calls.includes('news'))
  assert.ok(!calls.includes('calendar'))

  store.data.settings.schedule.newsEveryHours = 1
  store.data.settings.icsUrls = ['https://example.com/a.ics']
  await createScheduler(store, jobs).tick()
  assert.ok(calls.includes('news'))
  assert.ok(calls.includes('calendar'))
})
