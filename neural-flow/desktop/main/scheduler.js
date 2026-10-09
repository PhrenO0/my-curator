// Refresh user calendars only. No generated plans, coaching or briefing jobs.
const A = require('../renderer/shared/agenda.js')
function createScheduler(store, jobs, { intervalMs = 30000 } = {}) {
  let timer = null
  let lastDay = null
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const d = store.get()
      const today = A.ymd(new Date())
      if (lastDay !== today) {
        lastDay = today
        jobs.onNewDay?.(today)
      }
      if (d.account || d.settings.icsUrls?.length) {
        const age = d.remote?.fetchedAt ? Date.now() - new Date(d.remote.fetchedAt).getTime() : Infinity
        if (age >= 60000) await jobs.calendar()
      }
    } catch (e) {
      console.error('[scheduler]', e)
    } finally {
      running = false
    }
  }
  return {
    start() { if (!timer) { tick(); timer = setInterval(tick, intervalMs) } },
    stop() { clearInterval(timer); timer = null },
    tick,
  }
}
module.exports = { createScheduler }
