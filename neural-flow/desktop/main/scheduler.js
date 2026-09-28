// 트리거(Cadence) — GitHub Actions cron 을 로컬로 옮긴 것.
// 30초마다 깨어나 '오늘 아직 안 한 일'만 실행한다.
// PC가 07:00에 꺼져 있었다면 켜진 직후 바로 따라잡는다 (cron 은 못 하는 부분).

const A = require('../renderer/shared/agenda.js')

function createScheduler(store, jobs, { intervalMs = 30000 } = {}) {
  let timer = null
  let lastDay = null

  const tick = async () => {
    const d = store.get()
    const now = new Date()
    const today = A.ymd(now)
    const t = A.hm(now)
    const s = d.settings.schedule
    const last = d.lastRun || {}
    const mark = (k) => store.update((x) => (x.lastRun = { ...(x.lastRun || {}), [k]: today }))

    if (lastDay !== today) {
      lastDay = today
      jobs.onNewDay?.(today)
    }

    // 아침 브리핑: 예약 시각이 지났거나, 오늘 브리핑이 아직 한 번도 없으면
    const noBriefToday = !d.brief || d.brief.date !== today
    if (last.brief !== today && (t >= s.briefTime || (noBriefToday && !last.everRan))) {
      mark('brief')
      store.update((x) => (x.lastRun.everRan = true))
      await jobs.morning()
    }

    // 주간 추천 + 회고
    if (now.getDay() === Number(s.weeklyDay) && t >= s.weeklyTime && last.weekly !== today) {
      mark('weekly')
      await jobs.weekly()
    }

    // 저녁 체크인 — 오늘의 단 하나를 아직 안 끝냈을 때만
    if (t >= s.checkinTime && last.checkin !== today) {
      mark('checkin')
      jobs.checkin()
    }

    // 최신 정보
    const hours = Math.max(1, Number(s.newsEveryHours) || 3)
    const newsAge = d.news?.fetchedAt ? now - new Date(d.news.fetchedAt) : Infinity
    if (newsAge > hours * 3600000) await jobs.news()

    // 구글 캘린더(ICS) 30분마다
    if (d.settings.icsUrls?.length) {
      const calAge = d.remote?.fetchedAt ? now - new Date(d.remote.fetchedAt) : Infinity
      if (calAge > 30 * 60000) await jobs.calendar()
    }
  }

  let running = false
  const safeTick = async () => {
    if (running) return
    running = true
    try {
      await tick()
    } catch (e) {
      console.error('[scheduler]', e)
    } finally {
      running = false
    }
  }

  return {
    start() {
      safeTick()
      timer = setInterval(safeTick, intervalMs)
    },
    stop() {
      clearInterval(timer)
    },
    tick: safeTick,
  }
}

module.exports = { createScheduler }
