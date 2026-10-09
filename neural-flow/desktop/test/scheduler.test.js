const test = require('node:test')
const assert = require('node:assert/strict')
const { createScheduler } = require('../main/scheduler.js')
const setup = (overrides = {}) => {
  const data = { settings: { icsUrls: [] }, remote: {}, ...overrides }
  const calls = []
  const jobs = Object.fromEntries(['morning', 'weekly', 'checkin', 'news', 'calendar', 'onNewDay'].map((name) => [name, async () => {
    calls.push(name)
    if (name === 'calendar') data.remote.fetchedAt = new Date().toISOString()
  }]))
  return { data, calls, scheduler: createScheduler({ get: () => data }, jobs) }
}
test('브리핑·코칭·뉴스는 첫 실행과 저녁에도 실행하지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 27, 23, 0) })
  const { calls, scheduler } = setup()
  await scheduler.tick()
  await scheduler.tick()
  assert.deepEqual(calls, ['onNewDay'])
})
test('Google 로그인만 있어도 모바일 변경을 1분마다 읽는다', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 28, 10, 0) })
  const { calls, scheduler } = setup({ account: { email: 'me@example.com' } })
  await scheduler.tick()
  await scheduler.tick()
  assert.equal(calls.filter((x) => x === 'calendar').length, 1)
  t.mock.timers.tick(60000)
  await scheduler.tick()
  assert.equal(calls.filter((x) => x === 'calendar').length, 2)
  assert.ok(!calls.some((x) => ['morning', 'weekly', 'news', 'checkin'].includes(x)))
})
test('iCal도 갱신하고, 중복 요청은 막는다', async () => {
  const { scheduler, calls } = setup({ settings: { icsUrls: ['https://example.com/calendar.ics'] } })
  await Promise.all([scheduler.tick(), scheduler.tick()])
  assert.equal(calls.filter((x) => x === 'calendar').length, 1)
})
