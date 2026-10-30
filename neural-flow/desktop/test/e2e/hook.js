// E2E 훅 — 실제 Electron 앱 안에서 IPC 경로(window.nf)를 그대로 호출해 검증한다.
// launch.js 가 NF_TEST_HOOK 으로 이 파일을 넘기면 main.js 가 run() 을 부른다.
// 외부 네트워크 없이: 가짜 Notion API · 가짜 업데이트 서버를 로컬에 띄운다.

const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const PORT = Number(process.env.NF_E2E_PORT || 47811)
const SHOT_DIR = process.env.NF_SHOT_DIR // 있으면 화면 캡처 저장
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (n) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}
const today = ymd(new Date())
const WD = ['일', '월', '화', '수', '목', '금', '토']
const md = (n) => {
  const d = addDays(n)
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')} ${WD[d.getDay()]}`
}

const TOKEN = 'ntn_' + 'a1B2c3D4e5'.repeat(4)
const PAGE_ID = '3d8b9019035781acb237e2d609a7f276'
const OTHER_PAGE = '11112222333344445555666677778888'
const BOARD_ID = 'cafe0000-1111-2222-3333-444455556666'
const rt = (...t) => t.map((x) => ({ plain_text: x }))
const bullet = (a, b) => ({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(a, b) } })

// 어제 줄이 남아 있는 보드 (아침 갱신 전 상황) + 오늘부터 6일
const PAGE = [
  { id: 'h1', type: 'heading_3', heading_3: { rich_text: rt('✍️ 오늘') } },
  { id: 'h7', type: 'heading_3', heading_3: { rich_text: rt('📅 앞으로 7일') } },
  { id: BOARD_ID, type: 'callout', has_children: true, callout: { rich_text: rt(`${md(-1)} – ${md(5)}`, ' · 정규 수업 제외 · 매일 아침 자동 갱신') } },
]
const BOARD = [
  bullet(md(-1), '　18:00 어제 지난 일'),
  bullet(md(0), '　11:00 [마감] 모두의창업 웹사이트 1차 제작 · 15:00 활동보고서 작성 · 18:00 2차 정산금 입금 확인'),
  bullet(md(1), '　09:00 AI_TOP_100 예선 입장·사전준비 · 10:00 [필수] AI_TOP_100 예선'),
  bullet(md(2), '　23:59 [마감] 국민대 캠타 CRE-AI-TIVE 참가 신청'),
  bullet(md(3), '　19:00 지속가능도시론 2차 퀴즈 준비 · 21:00 [마감] 도시빅데이터분석 프로젝트 제안서 · 종일 도시빅데이터분석 기획안'),
  bullet(md(4), '　종일 영캠 모임'),
  { type: 'paragraph', paragraph: { rich_text: rt('과제안내: 대중교통현장관찰조사 …') } },
  bullet(md(5), '　13:30 도빅분 프로젝트 중간 체크인(예정) · 종일 예비군'),
]

const UPDATE_BYTES = Buffer.from('fake installer')
const mock = { notionCalls: 0, badAuth: 0 }

function startServer() {
  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname
      if (p.startsWith('/repos/')) {
        const sha = crypto.createHash('sha256').update(UPDATE_BYTES).digest('hex')
        const a = (name) => ({ name, browser_download_url: `http://127.0.0.1:${PORT}/dl`, size: UPDATE_BYTES.length, digest: `sha256:${sha}` })
        return json(res, 200, [{ tag_name: 'desktop-v9.9.9', draft: false, prerelease: false, html_url: 'x', body: '테스트', assets: [a('neural-flow-9.9.9-win-x64.exe'), a('neural-flow-9.9.9-mac-arm64.dmg'), a('neural-flow-9.9.9-mac-x64.dmg')] }])
      }
      if (p === '/dl') return res.writeHead(200), res.end(UPDATE_BYTES)
      const m = /^\/v1\/blocks\/([^/]+)\/children$/.exec(p)
      if (m) {
        mock.notionCalls++
        if (req.headers.authorization !== `Bearer ${TOKEN}` || req.headers['notion-version'] !== '2022-06-28') {
          mock.badAuth++
          return json(res, 401, { message: 'API token is invalid.' })
        }
        if (m[1] === PAGE_ID) return json(res, 200, { results: PAGE, has_more: false })
        if (m[1] === BOARD_ID) return json(res, 200, { results: BOARD, has_more: false })
        return json(res, 404, { message: 'Could not find block' })
      }
      json(res, 404, {})
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

exports.run = async ({ app, store, getWidget, openSettings, getSettings, setWidgetMode }) => {
  const { safeStorage } = require('electron')
  const results = []
  const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info })
  const server = await startServer()
  const cap = async (w, name) => {
    if (!SHOT_DIR) return
    await wait(500)
    fs.writeFileSync(path.join(SHOT_DIR, name), (await w.webContents.capturePage()).toPNG())
  }
  const wjs = (code) => getWidget().webContents.executeJavaScript(code)

  try {
    await wait(1500)
    // ── 1) 처음: 토큰 없음 → 위젯은 연결 안내 ──
    let s = await wjs('nf.snapshot()')
    check('처음엔 보드 없음 · 토큰 없음', !s.hasToken && !s.board)
    check('위젯: Notion 연결 안내', /Notion 연결하기/.test(await wjs('document.body.innerText')))
    await cap(getWidget(), 'widget-setup.png')

    openSettings()
    await wait(1500)
    const m = getSettings()
    const js = (code) => m.webContents.executeJavaScript(code)

    // ── 2) 토큰 형식 검사 → 저장 → 보드 읽기 ──
    let r = await js("nf.setToken('abc')")
    check('잘못된 형식의 토큰 거부', r.ok === false && /ntn_/.test(r.message), r.message)
    r = await js(`nf.setToken(${JSON.stringify(TOKEN)})`)
    s = await js('nf.snapshot()')
    check('토큰 저장 → 7일 보드 읽기', r.ok && r.days === 7 && s.hasToken && s.board.days.length === 7 && s.board.range === `${md(-1)} – ${md(5)}`, JSON.stringify(r))
    check('토큰은 화면으로 안 넘어감', !JSON.stringify(s).includes(TOKEN))
    const d0 = s.board.days.find((d) => d.date === today)
    check('파싱: 시각 · [마감] 태그 · 제목', d0 && d0.items.length === 3 && d0.items[0].time === '11:00' && d0.items[0].tag === '마감' && d0.items[0].title === '모두의창업 웹사이트 1차 제작', JSON.stringify(d0))

    // ── 3) 위젯 시각화 ──
    await wait(600)
    const wv = JSON.parse(
      await wjs(
        "JSON.stringify({ days: document.querySelectorAll('.day').length, today: document.querySelector('.day.today .rel')?.textContent || '', due: document.querySelectorAll('.it.due').length, must: document.querySelectorAll('.it.must').length, allday: [...document.querySelectorAll('.it .tm')].filter((e) => e.textContent === '종일').length, past: document.body.innerText.includes('어제 지난 일'), stale: /갱신 전/.test(document.querySelector('.ft')?.innerText || ''), h: document.getElementById('wrap').getBoundingClientRect().height })"
      )
    )
    check('위젯: 오늘부터 6일 · 오늘 표시 · 마감/필수 강조 · 종일', wv.days === 6 && wv.today === '오늘' && wv.due === 3 && wv.must === 1 && wv.allday === 3, JSON.stringify(wv))
    check('위젯: 아침 갱신 전이면 지난 날은 숨기고 알림', !wv.past && wv.stale, JSON.stringify(wv))
    const wb = getWidget().getBounds()
    check('위젯 창 높이가 내용에 맞춰짐 (잘리지 않음)', wb.height >= Math.min(wv.h, 600) - 2, `${wb.height} / ${wv.h}`)
    await cap(getWidget(), 'widget.png')

    // ── 4) 누르면 Notion 앱으로 ──
    await wjs("document.querySelector('.day').click()")
    await wait(300)
    s = await js('nf.snapshot()')
    const blk = BOARD_ID.replace(/-/g, '')
    check('위젯 누르면 Notion 앱 주소로 (보드 위치)', s.test.opened.at(-1) === `notion://www.notion.so/${PAGE_ID}#${blk}`, s.test.opened.at(-1))
    await js("nf.saveSettings({ notion: { openIn: 'web' } })")
    await wjs("document.querySelector('[data-act=open].lk').click()")
    await wait(300)
    s = await js('nf.snapshot()')
    check('설정: 브라우저로 열기', s.test.opened.at(-1) === `https://www.notion.so/${PAGE_ID}#${blk}`, s.test.opened.at(-1))
    await js("nf.saveSettings({ notion: { openIn: 'app' } })")

    // ── 5) 오류: 연결 안 된 페이지 → 보드는 그대로 두고 경고 ──
    r = await js(`nf.saveSettings({ notion: { page: 'https://www.notion.so/Other-${OTHER_PAGE}' } })`)
    await wait(800)
    s = await js('nf.snapshot()')
    check('연결 안 된 페이지 → 이유 안내 · 마지막 보드는 유지', /연결/.test(s.boardError) && s.board?.days.length === 7, s.boardError)
    check('위젯에 경고 표시', /⚠/.test(await wjs("document.querySelector('.ft')?.innerText || ''")))
    await js("nf.saveSettings({ notion: { page: '' } })")
    await wait(800)
    s = await js('nf.snapshot()')
    check('기본 페이지로 되돌리면 다시 정상', !s.boardError && s.board.pageId === PAGE_ID, s.boardError)
    const settingsText = await js('document.body.innerText')
    check('설정 창: 연결 상태 표시', /연결됨/.test(settingsText) && /7일/.test(settingsText), settingsText.slice(0, 80))
    await cap(m, 'settings.png')

    // ── 6) 위젯 옮기기 · 고정 · Win+D ──
    setWidgetMode('edit')
    await wait(1200)
    check('옮기기 모드', (await js('nf.snapshot()')).widgetMode === 'edit' && /드래그/.test(await wjs('document.body.innerText')))
    await cap(getWidget(), 'widget-edit.png')
    setWidgetMode('pinned')
    await wait(1500)
    if (process.platform === 'win32') {
      s = await js('nf.snapshot()')
      check('Win+D 보호 켜짐 (소유자 = 바탕화면)', s.winDesktop?.active && s.winDesktop.ownerIsDesktop, JSON.stringify(s.winDesktop))
      const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { stdio: 'ignore' })
      ps('(New-Object -ComObject Shell.Application).ToggleDesktop()') // = Win+D
      await wait(2000)
      s = await js('nf.snapshot()')
      check('Win+D 뒤에도 위젯 표시', s.winDesktop.visible && !s.winDesktop.iconic && getWidget().isVisible(), JSON.stringify(s.winDesktop))
      ps('(New-Object -ComObject Shell.Application).ToggleDesktop()')
    }
    await js("nf.saveSettings({ widget: { theme: 'light' } })")
    await wait(800)
    await cap(getWidget(), 'widget-light.png')
    await js("nf.saveSettings({ widget: { theme: 'auto' } })")

    // ── 7) 틀린 토큰 → 이유 안내 ──
    r = await js(`nf.setToken('ntn_${'z'.repeat(40)}')`)
    check('틀린 토큰 → 다시 넣으라는 안내', r.ok === false && /토큰이 맞지 않/.test(r.message) && mock.badAuth >= 1, r.message)
    r = await js(`nf.setToken(${JSON.stringify(TOKEN)})`)
    check('다시 맞는 토큰', r.ok)

    // ── 8) 저장 파일: 토큰·보드가 평문으로 남지 않음 ──
    store.flush()
    const raw = fs.readFileSync(path.join(process.env.NF_DATA_DIR, 'neural-flow.json'), 'utf-8')
    check(
      safeStorage.isEncryptionAvailable() ? '데이터 파일 암호화 (토큰·보드 평문 없음)' : '데이터 파일 (이 OS 는 키체인 없음 → 평문)',
      safeStorage.isEncryptionAvailable() ? raw.startsWith('NFENC1') && !raw.includes(TOKEN) && !raw.includes('모두의창업') : raw.includes('모두의창업'),
      raw.slice(0, 6)
    )

    // ── 9) 업데이트: 확인 → 받기 → SHA-256 검증 (설치는 건너뜀) ──
    const u = await js('nf.checkUpdate()')
    if (process.platform === 'linux') {
      check('업데이트 확인 (리눅스: 설치 파일 없음)', u.version === '9.9.9' && !u.available && !u.asset)
    } else {
      check('업데이트 확인', u.available && u.version === '9.9.9' && !!u.asset, `${u.current} → ${u.version}`)
      r = await js('nf.installUpdate()')
      check('업데이트 받기 + SHA-256 검증', r.ok && r.dryRun && r.verified, JSON.stringify(r).slice(0, 80))
    }

    // ── 10) 토큰 지우기 → 보드도 지움 ──
    await js("nf.setToken('')")
    s = await js('nf.snapshot()')
    check('토큰 지우면 보드도 지움', !s.hasToken && !s.board)
  } catch (e) {
    check('예외 없음', false, e.stack)
  }

  server.close()
  const failed = results.filter((x) => !x.ok)
  for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.info ? `  (${x.info})` : ''}`)
  console.log(`\nE2E: ${results.length - failed.length}/${results.length} 통과`)
  app.exit(failed.length ? 1 : 0)
}
