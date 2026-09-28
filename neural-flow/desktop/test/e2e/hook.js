// E2E 훅 — 실제 Electron 앱 안에서 IPC 경로(window.nf)를 그대로 호출해 검증한다.
// launch.js 가 NF_TEST_HOOK 으로 이 파일을 넘기면 main.js 가 스케줄러를 끄고 run() 을 부른다.
// 외부 네트워크 없이: 가짜 Gemini · ICS · RSS 를 로컬 서버로 띄운다.

const fs = require('fs')
const path = require('path')
const http = require('http')
const A = require('../../renderer/shared/agenda.js')

const PORT = Number(process.env.NF_E2E_PORT || 47811)
const SHOT_DIR = process.env.NF_SHOT_DIR // 있으면 화면 캡처 저장
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const today = A.ymd(new Date())
const compact = (d) => d.replace(/-/g, '')

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:회사
BEGIN:VEVENT
UID:g1
DTSTART:${compact(today)}T060000Z
DTEND:${compact(today)}T070000Z
SUMMARY:구글 테스트 미팅
END:VEVENT
BEGIN:VEVENT
UID:g2
DTSTART;VALUE=DATE:${compact(A.addDays(today, 2))}
DTEND;VALUE=DATE:${compact(A.addDays(today, 3))}
RRULE:FREQ=WEEKLY;COUNT=2
SUMMARY:주간 종일 이벤트
END:VEVENT
END:VCALENDAR`

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
${[1, 2, 3].map((i) => `<item><title>테스트 뉴스 ${i}</title><link>https://example.com/${i}</link><pubDate>${new Date(Date.now() - i * 3600e3).toUTCString()}</pubDate></item>`).join('')}
</channel></rss>`

function geminiReply(prompt) {
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
  const base = {
    greeting: '오늘도 거룩=집중.',
    one_thing: 'MOCK: 포트폴리오 케이스 1개 완성',
    one_thing_why: 'MOCK 이유',
    holiness_line: 'MOCK 거룩',
    stuck_coaching: 'MOCK 코칭',
    trend: 'MOCK 트렌드',
  }
  if (prompt.includes('[주간 모드]'))
    base.recommendations = [
      { name: 'MOCK 추천 활동 A', domain: '🫀 신체·건강', why: '운동', priority: '중간', energy: '루틴', min: 30 },
      { name: 'MOCK 추천 활동 B', domain: '💰 재정·경제', why: '예산', priority: '낮음', energy: '가벼움', min: 20 },
    ]
  return base
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/cal.ics')) {
        res.writeHead(200, { 'Content-Type': 'text/calendar' })
        return res.end(ICS)
      }
      if (req.url.startsWith('/feed.xml')) {
        res.writeHead(200, { 'Content-Type': 'application/rss+xml' })
        return res.end(RSS)
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (req.headers['x-goog-api-key'] !== 'test-key') {
          res.writeHead(400)
          return res.end('{"error":"bad key"}')
        }
        const prompt = JSON.parse(body).contents[0].parts[0].text
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply(prompt)) }] } }] }))
      })
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

exports.run = async ({ app, getWidget, openManager, getManager, setWidgetMode }) => {
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

    let s = await snap()
    check('state.json 시드', s.activities.length > 0 && s.events.length > 0, `활동 ${s.activities.length} · 일정 ${s.events.length}`)
    const html = await js('document.body.innerText')
    check('관리 창 렌더링', html.includes('오늘의 단 하나'))
    const widgetText = await getWidget().webContents.executeJavaScript('document.body.innerText')
    check('위젯 렌더링', widgetText.includes('오늘의 단 하나') && /\d{2}:\d{2}/.test(widgetText))

    // 1) 키 없음 → 규칙 기반
    await js("nf.run('brief')")
    s = await snap()
    check('키 없음 → 폴백 브리핑', s.brief?.source === 'fallback', s.brief?.one_thing)

    // 2) 키 검증
    let r = await js("nf.setKey('wrong-key')")
    check('잘못된 키 → ok:false', r.ok === false, r.message?.slice(0, 40))
    r = await js("nf.setKey('test-key')")
    s = await snap()
    check('키 저장·테스트 성공', r.ok === true && s.settings.hasKey, s.settings.keySource)
    check('스냅샷에 키 원문 없음', !JSON.stringify(s).includes('test-key'))

    // 3) AI 작업
    await js("nf.run('brief')")
    s = await snap()
    check('Gemini 데일리 브리핑', s.brief?.source === 'gemini' && s.brief.one_thing.startsWith('MOCK'), s.brief?.one_thing)

    const before = s.activities.length
    await js("nf.run('weekly')")
    await js("nf.run('weekly')")
    s = await snap()
    const added = s.activities.filter((a) => a.name.startsWith('MOCK 추천'))
    check('주간 추천 → 제안됨으로만, 중복 없이', added.length === 2 && added.every((a) => a.status === '제안됨'), `${before}→${s.activities.length}`)

    await js("nf.run('english')")
    s = await snap()
    check('Gemini 영어 표현', s.english?.source === 'gemini' && s.english.expression.includes('touch base'))

    await js(`nf.saveSettings({ feeds: [{ name: '로컬', url: '${base}/feed.xml' }] })`)
    await js("nf.run('news')")
    s = await snap()
    check('RSS 수집 + 최신순', s.news.items.length === 3 && s.news.items[0].title === '테스트 뉴스 1', `${s.news.items.length}건`)
    check('뉴스 AI 요약', s.news.summary?.bullets?.length === 3)

    // 4) 구글 캘린더(ICS): 주소를 바꾸면 바로 동기화
    await js(`nf.saveSettings({ icsUrls: ['${base}/cal.ics'] })`)
    for (let i = 0; i < 20 && !(await snap()).remote.fetchedAt; i++) await wait(200)
    s = await snap()
    const g = (s.remote.events || []).filter((e) => e.calendar === '회사')
    check('ICS 동기화 + 반복 펼침', g.length === 3, g.map((e) => `${e.date} ${e.start || '종일'}`).join(', '))

    // 5) 일정 · 마감 · 완료
    const dday = A.addDays(today, 3)
    await js(`nf.saveEvent({ title: '테스트 마감', date: '${dday}', start: '09:00', deadline: true, domain: '💼 일·소명' })`)
    s = await snap()
    const dl = A.deadlines({ events: s.events, activities: s.activities }, today)
    check('D-day 계산', dl.some((d) => d.title === '테스트 마감' && d.d === 3))

    await js('nf.toggleOneThing()')
    s = await snap()
    check('단 하나 완료 + 기록', s.brief.done === true && s.history.some((h) => h.date === today && h.done))

    const occ = A.occurrences({ events: s.events, remote: s.remote.events, activities: s.activities, doneMap: s.doneMap }, today, today)
    const routine = occ.find((o) => o.repeat === 'daily')
    await js(`nf.toggleOccurrence(${JSON.stringify(routine.key)})`)
    s = await snap()
    check('반복 일정은 날짜별로 완료', !!s.doneMap[routine.key])

    const act = s.activities.find((a) => a.name === 'MOCK 추천 활동 B')
    await js(`nf.saveActivity(${JSON.stringify({ ...act, date: today, start: '15:00' })})`)
    s = await snap()
    check('활동에 날짜 → 예정됨', s.activities.find((a) => a.id === act.id).status === '예정됨')

    await js(`nf.setActivityStatus(${JSON.stringify(act.id)}, '완료')`)
    s = await snap()
    check('보드 상태 변경', s.activities.find((a) => a.id === act.id).status === '완료')

    // 6) 화면 조작: 모달 열기
    await js("location.hash = 'calendar'")
    await wait(400)
    await js("document.querySelector('[data-act=new-event]').click()")
    await wait(300)
    check('새 일정 모달', await js("document.getElementById('modal').open"))
    await cap(m, 'modal.png')
    await js("document.getElementById('modal').close()")

    // 7) 위젯 모드 · 테마
    setWidgetMode('edit')
    await wait(1200)
    check('편집 모드 전환', (await snap()).widgetMode === 'edit')
    await cap(getWidget(), 'widget-edit.png')
    setWidgetMode('pinned')
    await wait(1200)
    await cap(getWidget(), 'widget-dark.png')
    for (const v of ['today', 'calendar', 'board', 'brief', 'settings']) {
      await js(`location.hash = '${v}'`)
      await cap(m, `app-${v}.png`)
    }
    await js("nf.saveSettings({ widget: { theme: 'light' } })")
    await wait(800)
    await cap(getWidget(), 'widget-light.png')

    // 8) 디스크
    await wait(600)
    const file = JSON.parse(fs.readFileSync(path.join(process.env.NF_DATA_DIR, 'neural-flow.json'), 'utf-8'))
    check('디스크 저장', file.events.some((e) => e.title === '테스트 마감'))
  } catch (e) {
    check('예외 없음', false, e.stack)
  }

  server.close()
  const failed = results.filter((r) => !r.ok)
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? `  (${r.info})` : ''}`)
  console.log(`\nE2E: ${results.length - failed.length}/${results.length} 통과`)
  app.exit(failed.length ? 1 : 0)
}
