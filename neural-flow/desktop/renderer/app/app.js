// 관리 창 — 오늘 · 캘린더 · 활동 보드 · 브리핑 · 설정
const A = NFAgenda
const { esc, timeAgo, speak, greetingByHour } = UI

const $side = document.getElementById('side')
const $main = document.getElementById('view')
const $scroll = document.getElementById('main')
const $shell = document.getElementById('shell')
const $lock = document.getElementById('lock')
const $ask = document.getElementById('ask')
const $askInput = document.getElementById('ask-input')
const $askPreview = document.getElementById('ask-preview')
const $modal = document.getElementById('modal')
const $toast = document.getElementById('toast')

const STATUSES = ['제안됨', '승인됨', '예정됨', '진행중', '완료', '보류']
const REPEATS = [
  ['', '반복 안 함'],
  ['daily', '매일'],
  ['weekdays', '평일'],
  ['weekly', '매주'],
  ['monthly', '매월'],
]
const NAV = [
  ['today', '오늘', 'sun'],
  ['calendar', '캘린더', 'calendar-days'],
  ['settings', '설정', 'settings'],
]

let S = null
let route = location.hash.slice(1) || 'today'
let cal = null // { y, m, sel }
let boardFilter = ''

if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac')

async function refresh() {
  S = await nf.snapshot()
  if (!cal) {
    const t = A.parseYmd(S.today)
    cal = { y: t.getFullYear(), m: t.getMonth(), sel: S.today }
  }
  render()
  renderUpdate()
}

// ── 새 버전: 팝업 + 배너 + 사이드바 버튼 ──
const $updateDialog = document.getElementById('update-dialog')
const $updateBanner = document.getElementById('update-banner')
let updateLater = '' // 이번 실행에서 '나중에' 누른 버전
let updateMsg = ''
const mb = (n) => (n ? `${(n / 1048576).toFixed(0)}MB` : '')

function updateVisible() {
  const u = S?.update
  return !!(S && !S.locked && u?.available && u.version !== S.settings.updates.skipVersion)
}

function renderUpdate(force = false) {
  const u = S?.update || {}
  const visible = updateVisible()
  const busy = u.downloading != null || u.installing
  if (!visible) {
    $updateBanner.hidden = true
    if ($updateDialog.open && !busy) $updateDialog.close()
    return
  }
  // 팝업: 새 버전이 처음 보일 때 한 번 (입력 중이면 방해하지 않고 배너만)
  const typing = !!($askInput.value.trim() || $modal.open)
  if (!$updateDialog.open && (force || (updateLater !== u.version && !typing))) $updateDialog.showModal()
  if (force) updateLater = ''
  $updateBanner.hidden = $updateDialog.open
  $updateBanner.innerHTML = `<div class="update-banner">${icon('sparkles', 15)}<span><b>${esc(u.version)}</b> 새 버전이 나왔어요</span><button class="btn sm primary" data-act="update-open">업데이트</button></div>`
  if (!$updateDialog.open) return
  const pct = u.downloading ?? 0
  const status = u.installing
    ? `<div class="update-status">설치하고 다시 시작하는 중… 잠시 뒤 앱이 자동으로 켜져요</div>`
    : u.downloading != null
      ? `<div class="update-progress"><i style="width:${pct}%"></i></div><div class="update-status">받는 중 ${pct}%</div>`
      : u.pending
        ? `<div class="update-status">입력 중인 내용을 저장하거나 닫으면 바로 업데이트해요</div>`
        : u.error || updateMsg
          ? `<div class="update-status err">${esc(u.error || updateMsg)}</div>`
          : `<div class="update-status">받은 파일은 SHA-256 으로 검증한 뒤 설치하고, 끝나면 앱이 자동으로 다시 켜져요</div>`
  $updateDialog.innerHTML = `<div class="update-card">
    <div class="update-icon">${icon('sparkles', 26)}</div>
    <h3>새 버전이 나왔어요</h3>
    <div class="update-ver"><span>v${esc(u.current || S.version)}</span>${icon('chevron-right', 14)}<b>v${esc(u.version)}</b>${u.asset?.size ? `<em>${mb(u.asset.size)}</em>` : ''}</div>
    ${u.notes ? `<div class="update-notes">${esc(u.notes)}</div>` : ''}
    ${status}
    <div class="update-actions">
      <button class="btn primary lg" data-act="update-install" ${busy || u.pending ? 'disabled' : ''}>${u.installing ? '설치하는 중…' : u.downloading != null ? `받는 중 ${pct}%` : '지금 업데이트'}</button>
      ${busy ? '' : `<button class="btn ghost" data-act="update-later">나중에</button><button class="btn ghost" data-act="update-skip">이 버전 건너뛰기</button>`}
    </div>
    ${S.packaged ? '' : '<div class="update-status">개발 실행 중이라 자동 설치는 안 돼요 — git pull 로 업데이트하세요</div>'}
  </div>`
}
// 받는 중·설치 중에는 Esc 로 닫히지 않게
$updateDialog.addEventListener('cancel', (e) => {
  if (S?.update?.downloading != null || S?.update?.installing) e.preventDefault()
  else updateLater = S?.update?.version || ''
})
$updateDialog.addEventListener('close', () => renderUpdate())

function go(r) {
  route = r
  history.replaceState(null, '', `#${r}`)
  render()
  $scroll.scrollTop = 0
}

function toast(msg) {
  $toast.textContent = msg
  $toast.classList.add('show')
  clearTimeout(toast.t)
  toast.t = setTimeout(() => $toast.classList.remove('show'), 1800)
}

// '💼 일·소명' → '일·소명' (색 점과 이모지가 겹치지 않게)
const plainDomain = (d) => (A.domainEmoji(d) ? String(d).replace(/^\S+\s*/, '') : String(d || ''))
const domains = () => (S.profile.domains || []).map((d) => d.name)
const domainOptions = (sel) =>
  ['<option value="">영역 없음</option>']
    .concat(domains().map((d) => `<option ${d === sel ? 'selected' : ''}>${esc(d)}</option>`))
    .join('')
const opt = (list, sel) =>
  list.map((x) => (Array.isArray(x) ? x : [x, x])).map(([v, l]) => `<option value="${esc(v)}" ${v === (sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')

function occ(from, to) {
  return A.occurrences({ events: S.events, remote: S.remote.events || [], activities: S.activities, doneMap: S.doneMap }, from, to)
}

const ENGINE_LABEL = { codex: 'ChatGPT · Codex', claude: 'AI · Claude Code', gemini: 'AI · Gemini', none: 'AI 꺼짐 (규칙 모드)' }
const avatar = (a) =>
  a.picture
    ? `<img class="avatar" src="${esc(a.picture)}" alt="" referrerpolicy="no-referrer" />`
    : `<span class="avatar">${esc((a.name || a.email || '?').slice(0, 1).toUpperCase())}</span>`

// ── 잠금(로그인) 화면 ────────────────────────────────────────────────────────
let lockError = ''
let lockSetup = false
function renderLock() {
  if (S.sessionLocked && !S.needsLogin) return renderPinLock()
  const g = S.settings.google || {}
  const owner = (g.allowedEmails || []).join(', ')
  const needSetup = !g.clientId || lockSetup
  if ($lock.contains(document.activeElement) && document.activeElement.matches('input')) return
  $lock.innerHTML = `<div class="lock"><div class="lock-card">
    <div class="brand-mark">${icon('waves', 30)}</div>
    <h1>neural-flow</h1>
    <p>${needSetup ? '구글 캘린더 주소 하나면 바로 시작해요' : owner ? `<b>${esc(owner)}</b> 계정으로만 열 수 있어요` : '처음 로그인한 구글 계정이 주인으로 등록돼요'}</p>
    ${
      !needSetup
        ? `<button class="btn primary lg block gbtn" data-act="signin" ${S.busy.signin ? 'disabled' : ''}>${S.busy.signin ? '브라우저에서 로그인을 마쳐 주세요…' : 'Google 계정으로 로그인'}</button>
           <div class="or">또는</div>`
        : ''
    }
    <form id="simple-form">
      <div class="f"><label>간편 모드 — 구글 캘린더 iCal 비밀 주소</label>
        <input class="input" name="ics" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" required /></div>
      <p class="hint">구글 캘린더 웹 → 설정 → 내 캘린더 → <b>캘린더 통합</b> → 'iCal 형식의 비공개 주소' 복사.
        로그인 없이 일정을 <b>읽기만</b> 해요. 빠른 입력은 앱 안에 저장돼요.</p>
      <button class="btn ${needSetup ? 'primary' : ''} lg block" ${S.busy.calendar ? 'disabled' : ''}>${S.busy.calendar ? '캘린더 불러오는 중…' : '간편 모드로 시작'}</button>
    </form>
    ${
      needSetup
        ? `<details class="adv"><summary>구글 로그인 연결 (일정 쓰기까지, 한 번만 설정)</summary>
          <ol class="steps">
            <li>Google Cloud 콘솔 → <b>Google Calendar API</b> 사용 설정</li>
            <li>OAuth 동의 화면: 외부 · 테스트 사용자에 본인 이메일</li>
            <li>OAuth 클라이언트 ID → 유형 <b>데스크톱 앱</b></li>
            <li>아래에 붙여넣기 — GitHub 비밀값에 넣어 두면 다음 설치부터는 이 단계가 사라져요</li>
          </ol>
          <form id="auth-form">
            <div class="f"><label>클라이언트 ID</label><input class="input" name="clientId" value="${esc(g.clientId || '')}" placeholder="xxxx.apps.googleusercontent.com" required /></div>
            <div class="f"><label>클라이언트 보안 비밀</label><input class="input" name="clientSecret" type="password" placeholder="${g.hasSecret ? '저장됨 — 바꿀 때만 입력' : 'GOCSPX-…'}" /></div>
            <button class="btn lg block">저장하고 계속</button>
          </form></details>`
        : `<button class="btn ghost sm" style="margin-top:12px" data-act="lock-setup">로그인 설정 바꾸기</button>`
    }
    ${lockError ? `<div class="err">${esc(lockError)}</div>` : ''}
  </div></div>`
}

// PIN 잠금 (자리 비움·화면 잠금 뒤)
function renderPinLock() {
  if ($lock.contains(document.activeElement) && document.activeElement.matches('input')) return
  $lock.innerHTML = `<div class="lock"><div class="lock-card">
    <div class="brand-mark">${icon('lock', 28)}</div>
    <h1>잠겨 있어요</h1>
    <p>${S.account ? esc(S.account.email) : 'neural-flow'} · PIN 을 입력하세요</p>
    <form id="pin-form">
      <input class="input pin" id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••" autofocus />
      <button class="btn primary lg block" style="margin-top:12px">열기</button>
    </form>
    ${lockError ? `<div class="err">${esc(lockError)}</div>` : ''}
  </div></div>`
  setTimeout(() => document.getElementById('pin')?.focus(), 50)
}

// ── 언제든 입력 (상단 바) ────────────────────────────────────────────────────
const KIND = {
  event: ['calendar-plus', '일정'],
  task: ['list-todo', '할 일'],
  one_thing: ['target', '오늘의 단 하나'],
  note: ['sticky-note', '메모'],
}
let askItem = null
function describe(item) {
  const when = item.date ? `${A.formatKoreanDate(item.date)}${item.start ? ` ${item.start}` : item.kind === 'event' ? ' 종일' : ''}` : ''
  const where = {
    event: S.account ? '구글 캘린더에 추가' : '앱 일정에 추가',
    task: '활동 보드에 추가',
    one_thing: '오늘의 단 하나로 정하기',
    note: '메모로 저장',
  }[item.kind]
  return [when, item.minutes ? `${item.minutes}분` : '', where].filter(Boolean).join(' · ')
}
function renderAskPreview() {
  if (!askItem) return ($askPreview.innerHTML = '')
  $askPreview.innerHTML = NFInputReview.render(askItem, S.account) + `<div class="btn-row">
    <button class="btn sm" data-act="ask-cancel">취소</button>
    <button class="btn sm primary" data-act="ask-commit">확인한 내용 저장</button></div>`

}
let askPasted = null
let askBusy = false
async function askSubmit() {
  if (askBusy) return
  const shown = $askInput.value.trim()
  const text = askPasted && shown.startsWith('📄') ? askPasted : shown
  if (!text) return
  reportDraft()
  if (askItem && askItem._text === text) return askCommit()
  askBusy = true
  try {
    const result = await nf.previewInput(text)
    if (!result) throw new Error('일정 해석을 완료하지 못했어요. 다시 시도해 주세요')
    askItem = { ...result, _text: text }
    renderAskPreview()
    reportDraft()
  } catch (e) { toast(e.message) } finally { askBusy = false }
}
function reportDraft() {
  nf.setInputActive?.(!!($askInput.value.trim() || askItem || $modal.open || coachQuestion.trim() || document.querySelector('#key')?.value)).catch(() => {})
}
$modal.addEventListener('close', reportDraft)
document.addEventListener('input', (e) => {
  if (e.target.id === 'coach-question') coachQuestion = e.target.value
  reportDraft()
})

async function askCommit() {
  if (!askItem || askBusy) return
  NFInputReview.read($askPreview, askItem)
  askBusy = true
  try {
    const r = await nf.commitInput(askItem)
    toast(r?.message || '저장을 완료하지 못했어요')
    if (!r?.ok) {
      if (r?.remaining?.length) askItem = { ...askItem, kind: 'batch', items: r.remaining }
      renderAskPreview()
      return
    }
    askItem = null
    askPasted = null
    $askInput.value = ''
    renderAskPreview()
    reportDraft()
  } catch (e) { toast(e.message) } finally { askBusy = false }
}
// 여러 줄 공문 붙여넣기 → 원문 전체를 해석·평가
$askInput.addEventListener('paste', (e) => {
  const t = e.clipboardData?.getData('text') || ''
  if (!/\n/.test(t.trim())) return
  e.preventDefault()
  askPasted = t
  $askInput.value = `📄 ${t.trim().split(/\r?\n/)[0].slice(0, 40)}… (공문)`
  $askPreview.innerHTML = '<div class="muted small">일정 정보를 읽는 중…</div>'
  askSubmit()
})
$ask.addEventListener('submit', (e) => {
  e.preventDefault()
  askSubmit()
})
$askInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    askItem = null
    $askInput.value = ''
    renderAskPreview()
    reportDraft()
  }
})

// ── 사이드바 ────────────────────────────────────────────────────────────────
function renderSide() {
  const open = S.activities.filter((a) => a.status === '제안됨').length
  const todayCount = occ(S.today, S.today).length
  const counts = { today: todayCount || '', board: open ? `${open} 제안` : '' }
  const k = S.settings
  $side.innerHTML = `
    <div class="brand"><span class="brand-mark">${icon('waves', 15)}</span>neural-flow</div>
    ${NAV.map(
      ([r, l, ic]) =>
        `<button class="nav ${route === r ? 'on' : ''}" data-go="${r}">${icon(ic, 16)}<span>${l}</span><span class="count">${counts[r] || ''}</span></button>`
    ).join('')}
    <div class="side-foot">
      <div class="status"><span class="dot ${S.account ? 'ok' : ''}"></span>${
        S.account ? `구글 캘린더 · ${timeAgo(S.remote.fetchedAt) || '동기화 대기'}` : k.icsUrls?.length ? 'iCal 주소로 읽는 중' : '구글 캘린더 미연결'
      }</div>
      ${
        S.update?.available
          ? `<button class="btn sm soft" data-act="update-open">${icon('sparkles', 13)}${
              S.update.downloading != null ? `받는 중 ${S.update.downloading}%` : S.update.installing ? '설치 중…' : `${esc(S.update.version)} 업데이트`
            }</button>`
          : `<button class="btn sm ghost" data-act="update-check" title="새 버전이 있는지 확인">v${esc(S.version)} · ${S.update?.checking ? '확인 중…' : '업데이트 확인'}</button>`
      }
      ${
        S.account
          ? `<div class="me">${avatar(S.account)}<div class="who"><b>${esc(S.account.name || S.account.email.split('@')[0])}</b><span>${esc(S.account.email)}</span></div></div>`
          : ''
      }
      <button class="btn sm" data-act="widget-mode">${icon(S.widgetMode === 'edit' ? 'pin' : 'move', 14)}${
        S.widgetMode === 'edit' ? '위젯 고정하기' : '위젯 위치 옮기기'
      }</button>
    </div>`
}

// ── 오늘 ────────────────────────────────────────────────────────────────────
let coachResult = null
let coachQuestion = ''
function viewToday() {
  const items = occ(S.today, S.today)
  return `<div class="page-h"><div class="titles"><div class="eyebrow">내가 입력한 일정</div><h1>${A.formatKoreanDate(S.today)}</h1></div>
    <button class="btn" data-act="run" data-job="calendar">${icon('refresh-cw', 14)}동기화</button>
    <button class="btn primary" data-act="new-event" data-date="${S.today}">${icon('plus', 14)}일정 추가</button></div>
    <section class="card"><h2>오늘 일정 · ${items.length}</h2>${agendaList(items)}</section>
    <section class="card"><h2>일정 코칭</h2>
    <p>일정의 겹침·빠진 정보·준비 시간을 AI와 점검하세요.</p>
    <input class="input" id="coach-question" value="${esc(coachQuestion)}" placeholder="이번 주 일정을 잘 쓰려면 무엇을 확인해야 할까?" />
    <button class="btn" data-act="coach-review" ${S.busy.coach ? 'disabled' : ''}>${S.busy.coach ? '검토 중…' : '일정 검토 받기'}</button>
    <div id="coach-result">${coachResult ? coachResult.ok ? `<p>${esc(coachResult.answer)}</p>${[...(coachResult.observations || []), ...(coachResult.questions || [])].map(x=>`<p>${esc(x)}</p>`).join('')}` : `<p role="alert">${esc(coachResult.message)}</p>` : ''}</div></section>
    <section class="card"><h2>Google 캘린더</h2><p>${S.account ? '앱에서 저장한 일정은 모바일 Google 캘린더의 같은 계정·캘린더에서 볼 수 있어요. 모바일 변경도 자동으로 새로고침해요.' : '설정에서 Google 계정으로 로그인하면 모바일과 같은 캘린더를 읽고 쓸 수 있어요. iCal은 읽기 전용이에요.'}</p>
    ${(S.remote.errors || []).map((e) => `<p class="muted">${esc(e.message)}</p>`).join('')}</section>`
}

function agendaList(items, { editable = true } = {}) {
  if (!items.length) return `<div class="empty">일정이 없어요.</div>`
  return `<ul class="agenda">${items
    .map(
      (o) => `
    <li class="ag ${o.done ? 'done' : ''}" ${
      editable && o.kind !== 'remote'
        ? `data-act="edit-occ" data-kind="${o.kind}" data-id="${esc(o.id)}"`
        : o.link
          ? `data-act="link" data-url="${esc(o.link)}" title="구글 캘린더에서 열기"`
          : ''
    }>
      <span class="bar" style="background:${o.color}"></span>
      <span class="time">${o.start ? esc(o.start) : '종일'}</span>
      <span class="t">${esc(o.title)}</span>
      <span class="meta">${o.kind === 'remote' ? esc(o.domain || '구글') : o.kind === 'activity' ? '활동' : o.repeat ? icon('repeat', 12) : ''}</span>
      ${o.kind !== 'remote' ? `<button class="check sm ${o.done ? 'on' : ''}" data-act="occ" data-key="${esc(o.key)}" aria-label="완료">${icon('check', 11)}</button>` : ''}
    </li>`
    )
    .join('')}</ul>`
}

// ── 캘린더 ──────────────────────────────────────────────────────────────────
function viewCalendar() {
  const cells = A.monthGrid(cal.y, cal.m)
  const map = A.byDay(occ(cells[0].date, cells[41].date))
  const selItems = map[cal.sel] || []
  const wd = A.WEEKDAYS.map((w, i) => `<div class="wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')
  const grid = cells
    .map((c) => {
      const all = map[c.date] || []
      // 매일·평일 루틴은 칸마다 반복되면 시끄러워서 숫자로만 표시 (오른쪽 패널에는 전부 나옴)
      const routines = all.filter((o) => o.repeat === 'daily' || o.repeat === 'weekdays')
      const items = all.filter((o) => !routines.includes(o))
      const shown = items.slice(0, 3)
      return `<div class="cell ${c.inMonth ? '' : 'out'} ${c.date === S.today ? 'today' : ''} ${c.date === cal.sel ? 'sel' : ''} ${c.weekday === 0 ? 'sun' : ''}" data-act="sel-day" data-date="${c.date}">
        <div class="cell-h"><span class="n">${c.day}</span>${routines.length ? `<span class="rt" title="루틴 ${routines.length}개">${icon('repeat', 10)}${routines.length}</span>` : ''}</div>
        ${shown
          .map(
            (o) =>
              `<button class="pill ${o.done ? 'done' : ''}" style="--c:${o.color}" ${o.kind !== 'remote' ? `data-act="edit-occ" data-kind="${o.kind}" data-id="${esc(o.id)}"` : o.link ? `data-act="link" data-url="${esc(o.link)}"` : ''} title="${esc(`${o.start ? o.start + ' ' : ''}${o.title}`)}"><span class="tt">${esc(o.title)}</span></button>`
          )
          .join('')}
        ${items.length > 3 ? `<span class="more">+${items.length - 3}개</span>` : ''}
      </div>`
    })
    .join('')
  return `
  <div class="page-h">
    <div class="titles"><div class="eyebrow">캘린더</div><h1>${cal.y}년 ${cal.m + 1}월</h1></div>
    <div class="cal-toolbar">
      <button class="icon-btn" data-act="cal-move" data-d="-1" aria-label="이전 달">${icon('chevron-left', 18)}</button>
      <button class="btn sm" data-act="cal-move" data-d="0">오늘</button>
      <button class="icon-btn" data-act="cal-move" data-d="1" aria-label="다음 달">${icon('chevron-right', 18)}</button>
      ${S.account || S.settings.icsUrls?.length ? `<button class="btn sm ghost" data-act="run" data-job="calendar">${icon('refresh-cw', 13, S.busy.calendar ? 'spin' : '')}동기화</button>` : ''}
      <button class="btn sm primary" data-act="new-event" data-date="${cal.sel}">${icon('plus', 14)}새 일정</button>
    </div>
  </div>
  <div class="cal-wrap">
    <div class="month">${wd}${grid}</div>
    <section class="card">
      <h2><span class="grow">${A.formatKoreanDate(cal.sel)}</span>
        <button class="icon-btn" data-act="new-event" data-date="${cal.sel}" title="이 날에 추가">${icon('plus', 16)}</button></h2>
      ${agendaList(selItems)}
      <p class="muted small" style="margin:14px 0 0">빈 칸을 더블클릭하면 그 날짜로 바로 추가돼요. 구글 일정은 읽기 전용이에요.</p>
    </section>
  </div>`
}

// ── 설정 ────────────────────────────────────────────────────────────────────
function viewSettings() {
  const s = S.settings
  const w = s.widget
  const sc = s.schedule
  const field = (label, desc, control) =>
    `<div class="field"><div><div class="fl">${label}</div>${desc ? `<div class="fd">${desc}</div>` : ''}</div><div>${control}</div></div>`
  const sw = (key, on) => `<input type="checkbox" class="switch" data-set="${key}" ${on ? 'checked' : ''} />`
  const seg = (key, val, list) =>
    `<div class="seg">${list.map(([v, l]) => `<button class="${String(v) === String(val) ? 'on' : ''}" data-act="seg" data-set="${key}" data-v="${v}">${l}</button>`).join('')}</div>`

  return `
  <div class="page-h"><div class="titles"><div class="eyebrow">Google 일정은 로그인한 Google 계정에 저장돼요</div><h1>설정</h1></div></div>
  <div class="settings">
    <section class="card"><h2>${icon('lock', 16)}계정</h2>
      ${field(
        '로그인',
        S.account ? '이 계정으로 구글 캘린더를 읽고 써요' : '',
        S.account
          ? `<div class="inline"><div class="me" style="flex:1">${avatar(S.account)}<div class="who"><b>${esc(S.account.name || '')}</b><span>${esc(S.account.email)}</span></div></div><button class="btn" data-act="signout">${icon('log-out', 15)}로그아웃</button></div>`
          : `<button class="btn primary" data-act="signin">Google 계정으로 로그인</button>`
      )}
      ${field('허용 계정', '이 이메일로만 앱을 열 수 있어요. 쉼표로 여러 개.', `<input class="input" data-set="google.allowedEmails" value="${esc((s.google.allowedEmails || []).join(', '))}" />`)}
      ${field('로그인 필수', '끄면 로그인 없이 열려요 (구글 캘린더는 로그인해야 연결)', sw('requireLogin', s.requireLogin !== false))}
      ${
        S.remote.calendars?.length
          ? field(
              '새 일정 저장 위치',
              '빠른 입력·새 일정이 들어갈 캘린더',
              `<select class="input" data-set="google.defaultCalendar">${opt(
                S.remote.calendars.filter((c) => c.writable).map((c) => [c.primary ? 'primary' : c.id, c.name]),
                s.google.defaultCalendar || 'primary'
              )}</select>`
            ) +
            field(
              '표시할 캘린더',
              '위젯·캘린더에 보일 캘린더',
              S.remote.calendars
                .map((c) => {
                  const on = s.google.calendarIds ? s.google.calendarIds.includes(c.id) : c.selected
                  return `<label class="cal-pick" style="--c:${esc(c.color)}"><i></i><span>${esc(c.name)}</span><input type="checkbox" class="switch" data-act="cal-toggle" data-id="${esc(c.id)}" ${on ? 'checked' : ''} /></label>`
                })
                .join('')
            )
          : ''
      }
    </section>

    <section class="card"><h2>${icon('lock', 16)}보안 · 개인정보</h2>
      ${field(
        '데이터 암호화',
        s.security.canEncrypt
          ? `저장 파일을 OS 키체인(Windows DPAPI · macOS 키체인)으로 암호화해요. 지금: <b style="color:${S.encrypted ? 'var(--ok)' : 'var(--warn)'}">${S.encrypted ? '암호화됨' : '평문'}</b>`
          : '이 기기는 OS 키체인을 쓸 수 없어 평문으로 저장해요 (파일 권한은 내 계정만)',
        sw('security.encryptData', s.security.encryptData !== false)
      )}
      ${field(
        '앱 PIN',
        s.security.hasPin ? '설정됨 — 켤 때, 자리 비움·화면 잠금 뒤 PIN 으로 열어요' : '설정하면 자리 비움·화면 잠금 뒤 앱이 잠겨요',
        `<div class="inline"><input class="input" id="new-pin" type="password" inputmode="numeric" maxlength="8" placeholder="숫자 4~8자리" style="max-width:180px" /><button class="btn" data-act="set-pin">${s.security.hasPin ? '바꾸기' : '설정'}</button>${
          s.security.hasPin ? `<button class="btn ghost" data-act="clear-pin">끄기</button><button class="btn ghost" data-act="lock-now">지금 잠그기</button>` : ''
        }</div>`
      )}
      ${field('자리 비움 잠금', 'PIN 이 있을 때만 동작. 0 = 끔', `<div class="inline"><input class="input" type="number" min="0" max="240" data-set="security.idleLockMinutes" value="${s.security.idleLockMinutes}" style="max-width:110px" /><span class="muted small">분</span></div>`)}
      ${field('화면 잠금·절전 시 잠금', '', sw('security.lockOnScreenLock', s.security.lockOnScreenLock))}
      ${field('화면 공유·캡처에서 숨기기', '줌·디스코드 화면 공유나 캡처 도구에 위젯·앱 창이 찍히지 않아요', sw('security.contentProtection', s.security.contentProtection))}
      ${field('가리기 모드', `위젯의 일정·할 일 제목을 흐리게 가려요. ${S.platform === 'darwin' ? '⌘⌥P' : 'Ctrl+Alt+P'}`, sw('security.privacyMode', s.security.privacyMode))}
      ${field(
        '내 데이터',
        '백업은 키·토큰을 뺀 JSON. 모두 지우기는 구글 연결을 해제하고 이 기기의 데이터를 삭제해요',
        `<div class="btn-row"><button class="btn" data-act="export-data">백업 내보내기</button><button class="btn danger" data-act="wipe-data">모두 지우기</button></div>`
      )}
    </section>

    <section class="card"><h2>${icon('refresh-cw', 16)}업데이트</h2>
      ${field(
        `현재 ${esc(S.version)}`,
        S.update?.checking
          ? '확인 중…'
          : S.update?.error
            ? `<span style="color:var(--danger)">${esc(S.update.error)}</span>`
            : S.update?.available
              ? `<b style="color:var(--accent)">${esc(S.update.version)}</b> 이 나왔어요. 받은 파일은 SHA-256 으로 검증한 뒤 설치해요.`
              : S.update?.version
                ? '최신 버전이에요'
                : '',
        `<div class="btn-row">${
          S.update?.available
            ? `<button class="btn primary" data-act="update-install" ${S.update.downloading != null ? 'disabled' : ''}>${S.update.downloading != null ? `받는 중 ${S.update.downloading}%` : '지금 업데이트'}</button><button class="btn ghost" data-act="update-skip">이 버전 건너뛰기</button>`
            : `<button class="btn" data-act="update-check">업데이트 확인</button>`
        }</div>`
      )}
      ${field('자동 설치', S.update?.pending ? '입력 중인 내용을 저장하거나 닫으면 업데이트해요.' : '앱 시작 시 새 버전을 받아 검증하고 설치·재시작해요.', sw('updates.autoInstall', s.updates.autoInstall !== false))}
      ${field('자동 확인', '6시간마다 확인하고 새 버전이 있으면 알려줘요', sw('updates.autoCheck', s.updates.autoCheck))}
    </section>

    <section class="card"><h2>${icon('bot', 16)}일정·공지 해석</h2>
      ${field('입력 해석 엔진', `현재: ${esc(ENGINE_LABEL[s.provider] || '규칙 해석')}<br>자동은 ChatGPT 로그인한 Codex → Claude Code 순서예요. 입력·검토할 때 일정 정보를 선택한 AI에 보내요. Gemini API는 별도 과금이에요.`, seg('engine', s.engine || 'auto', [['auto','구독 자동'],['codex','ChatGPT · Codex'],['claude','Claude Code'],['gemini','Gemini API'],['off','규칙만']]))}
      ${field('ChatGPT · Codex', s.codexStatus?.subscription ? `ChatGPT 로그인 확인 · ${esc(s.codexStatus.version)}` : '이 PC에서 Codex CLI 설치 후 codex login으로 ChatGPT 계정에 로그인하세요.', `<div class="inline"><input class="input" data-set="codexCmd" value="${esc(s.codexCmd || 'codex')}" /><button class="btn" data-act="detect-engine">연결 확인</button></div>`)}
      ${field('Codex 모델', '비워 두면 구독 기본 모델', `<input class="input" data-set="codexModel" value="${esc(s.codexModel || '')}" />`)}
      ${field('Claude Code', s.claudeVersion ? `연결됨 · ${esc(s.claudeVersion)}` : '이 PC에 설치하고 로그인한 Claude Code를 사용해요.', `<div class="inline"><input class="input" data-set="claudeCmd" value="${esc(s.claudeCmd || 'claude')}" /><button class="btn" data-act="detect-engine">연결 확인</button></div>`)}
      ${field('Claude 모델', '비워 두면 기본 모델', `<input class="input" data-set="claudeModel" value="${esc(s.claudeModel || '')}" />`)}
      ${field('Gemini API 키', s.hasKey ? '키가 설정되어 있어요' : '키를 설정하면 Gemini로 입력을 해석할 수 있어요.', `<div class="inline"><input class="input" id="key" type="password" autocomplete="off" placeholder="새 키 입력" /><button class="btn" data-act="save-key">저장·연결 확인</button></div>`)}
      ${field('Gemini 모델', '', `<input class="input" data-set="geminiModel" value="${esc(s.geminiModel)}" />`)}
    </section>

    <section class="card"><h2>${icon('calendar-days', 16)}iCal 주소 (선택 · 읽기 전용)</h2>
      ${field(
        '비공개 iCal 주소',
        `로그인 없이 다른 캘린더(회사·공유)를 더 보고 싶을 때. 구글 캘린더 설정 → '캘린더 통합' → <b>iCal 형식의 비공개 주소</b>. 한 줄에 하나.${(S.remote.errors || []).length ? `<br><span style="color:var(--danger)">오류: ${S.remote.errors.map((e) => esc(e.message)).join(', ')}</span>` : ''}`,
        `<textarea class="input" data-set="icsUrls" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics">${esc((s.icsUrls || []).join('\n'))}</textarea>
         <div class="muted small" style="margin-top:6px">${S.remote.fetchedAt ? `마지막 동기화 ${timeAgo(S.remote.fetchedAt)} · ${S.remote.events.length}개` : ''}</div>`
      )}
    </section>

    <section class="card"><h2>${icon('pin', 14)}바탕화면 위젯</h2>
      ${field('불투명도', '배경화면이 비치는 정도', `<input type="range" min="0.25" max="0.95" step="0.01" data-set="widget.opacity" value="${w.opacity}" />`)}
      ${field('너비', '300 ~ 520px', `<input class="input" type="number" min="300" max="520" step="10" data-set="widget.width" value="${w.width}" style="max-width:120px" />`)}
      ${field('테마', '관리 창에도 함께 적용', seg('widget.theme', w.theme, [['dark', '다크'], ['light', '라이트'], ['auto', '시스템']]))}
      ${field('클릭 통과', '켜면 위젯이 마우스를 무시해요 (순수 배경처럼). 트레이 메뉴에서도 전환.', sw('widget.clickThrough', w.clickThrough))}
      ${field(
        '위치 옮기기',
        `${S.platform === 'darwin' ? '⌘⌥N' : 'Ctrl+Alt+N'} 으로도 전환. ${S.platform === 'win32' ? '' : '고정 상태에서는 OS 특성상 위젯 클릭이 안 돼요 — 편집 모드에서 조작하세요.'}`,
        `<button class="btn" data-act="widget-mode">${S.widgetMode === 'edit' ? '고정하기' : '편집 모드 켜기'}</button>`
      )}
    </section>

    <section class="card"><h2>${icon('clock', 14)}앱 시작</h2>
      ${field('로그인 시 자동 실행', 'PC를 켜면 캘린더 위젯이 떠요', sw('autoStart', s.autoStart))}
    </section>
  </div>`
}

// ── 모달: 일정 / 활동 ────────────────────────────────────────────────────────
function openModal(html, onSubmit) {
  $modal.innerHTML = html
  $modal.showModal()
  reportDraft()
  const form = $modal.querySelector('form')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (e.submitter?.value === 'cancel') return $modal.close()
    if (form.dataset.saving) return
    form.dataset.saving = 'true'
    try {
      const result = await onSubmit(Object.fromEntries(new FormData(form)), e.submitter?.value)
      if (result !== false) $modal.close()
    } catch (err) {
      toast(err.message)
    } finally {
      delete form.dataset.saving
    }
  })
  form.querySelector('input')?.focus()
}

const toMin = (hm) => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

function eventModal(ev) {
  const isNew = !ev.id
  openModal(
    `<form>
      <h3>${isNew ? '새 일정' : '일정 편집'}</h3>
      <div class="f"><label>제목</label><input class="input" name="title" required value="${esc(ev.title || '')}" placeholder="무엇을 하나요?" /></div>
      <div class="f-row">
        <div class="f"><label>날짜</label><input class="input" type="date" name="date" required value="${ev.date}" /></div>
        <div class="f"><label>시작</label><input class="input" type="time" name="start" value="${ev.start || ''}" /></div>
        <div class="f"><label>종료</label><input class="input" type="time" name="end" value="${ev.end || ''}" /></div>
      </div>
      <div class="f-row two">
        <div class="f"><label>반복</label><select class="input" name="repeat">${opt(REPEATS, ev.repeat || '')}</select></div>
        <div class="f"><label>영역</label><select class="input" name="domain">${domainOptions(ev.domain)}</select></div>
      </div>
      <div class="f"><label>메모</label><input class="input" name="note" value="${esc(ev.note || '')}" /></div>
      ${
        isNew && S.account
          ? `<div class="f"><label>저장 위치</label><select class="input" name="target"><option value="google">구글 캘린더 (${esc(S.account.email)})</option><option value="local">이 앱에만 (반복·D-day 가능)</option></select></div>`
          : ''
      }
      <label class="check-line"><input type="checkbox" class="switch" name="deadline" ${ev.deadline ? 'checked' : ''} />마감 — D-day 카운트다운에 표시</label>
      <div class="modal-foot">
        ${isNew ? '' : `<button class="btn danger ghost" value="delete" formnovalidate>${icon('trash-2', 14)}삭제</button>`}
        <span class="grow"></span>
        <button class="btn" value="cancel" formnovalidate>취소</button>
        <button class="btn primary" value="save">저장</button>
      </div>
    </form>`,
    async (f, action) => {
      if (action === 'delete') {
        await nf.deleteEvent(ev.id)
        return toast('삭제했어요')
      }
      if (f.target === 'google') {
        const mins = f.start && f.end ? toMin(f.end) - toMin(f.start) : 60
        const r = await nf.commitInput({ kind: 'event', title: f.title, date: f.date, start: f.start || null, end: f.end || null, minutes: mins > 0 ? mins : 60, note: f.note, repeat: f.repeat, location: f.location, target: 'google' })
        toast(r?.message || '저장했어요')
        return r?.ok !== false
      }
      await nf.saveEvent({ ...ev, ...f, deadline: f.deadline === 'on' })
      toast('저장했어요')
    }
  )
}

function activityModal(a) {
  const isNew = !a.id
  openModal(
    `<form>
      <h3>${isNew ? '새 활동' : '활동 편집'}</h3>
      <div class="f"><label>활동명</label><input class="input" name="name" required value="${esc(a.name || '')}" /></div>
      <div class="f-row">
        <div class="f"><label>영역</label><select class="input" name="domain">${domainOptions(a.domain)}</select></div>
        <div class="f"><label>우선순위</label><select class="input" name="priority">${opt(['높음', '중간', '낮음'], a.priority || '중간')}</select></div>
        <div class="f"><label>에너지</label><select class="input" name="energy">${opt(['딥워크', '가벼움', '루틴'], a.energy || '가벼움')}</select></div>
      </div>
      <div class="f-row">
        <div class="f"><label>날짜 (정하면 예정됨)</label><input class="input" type="date" name="date" value="${a.date || ''}" /></div>
        <div class="f"><label>시작 시각</label><input class="input" type="time" name="start" value="${a.start || ''}" /></div>
        <div class="f"><label>예상(분)</label><input class="input" type="number" name="min" min="0" step="5" value="${a.min || ''}" /></div>
      </div>
      <div class="f"><label>상태</label><select class="input" name="status">${opt(STATUSES, a.status || '제안됨')}</select></div>
      <div class="f"><label>왜 (비전 연결)</label><textarea class="input" name="why" rows="2">${esc(a.why || '')}</textarea></div>
      <div class="modal-foot">
        ${isNew ? '' : `<button class="btn danger ghost" value="delete" formnovalidate>${icon('trash-2', 14)}삭제</button>`}
        <span class="grow"></span>
        <button class="btn" value="cancel" formnovalidate>취소</button>
        <button class="btn primary" value="save">저장</button>
      </div>
    </form>`,
    async (f, action) => {
      if (action === 'delete') {
        await nf.deleteActivity(a.id)
        return toast('삭제했어요')
      }
      await nf.saveActivity({ ...a, ...f })
      toast('저장했어요')
    }
  )
}

function oneThingModal() {
  const cur = S.brief && S.brief.date === S.today ? S.brief.one_thing : ''
  openModal(
    `<form>
      <h3>오늘의 단 하나 직접 정하기</h3>
      <div class="f"><input class="input" name="text" required value="${esc(cur)}" placeholder="오늘 반드시 끝낼 1가지" /></div>
      <div class="modal-foot"><span class="grow"></span>
        <button class="btn" value="cancel" formnovalidate>취소</button><button class="btn primary" value="save">정하기</button></div>
    </form>`,
    async (f) => {
      await nf.setOneThing(f.text)
      toast('오늘의 단 하나를 정했어요')
    }
  )
}

// ── 렌더 & 이벤트 ───────────────────────────────────────────────────────────
const VIEWS = { today: viewToday, calendar: viewCalendar, settings: viewSettings }

function render() {
  if (!S) return
  $lock.hidden = !S.locked
  $shell.hidden = !!S.locked
  if (S.locked) return renderLock()
  document.getElementById('ask-kbd').textContent = S.platform === 'darwin' ? '⌘⇧Space' : 'Ctrl+Shift+Space'
  renderSide()
  // 입력 중이면 다시 그리지 않는다 (커서 튐 방지)
  if ($main.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return
  $main.innerHTML = (VIEWS[route] || viewToday)()
}

function setByPath(path, value) {
  const parts = path.split('.')
  if (parts.length === 1) return { [path]: value }
  return { [parts[0]]: { [parts[1]]: value } }
}

document.addEventListener('click', async (e) => {
  const goEl = e.target.closest('[data-go]')
  if (goEl) return go(goEl.dataset.go)
  const el = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  const d = el.dataset
  switch (act) {
    case 'signin': {
      lockError = ''
      const r = await nf.signIn()
      if (!r.ok) lockError = r.message
      else toast(`${r.email} 로 로그인했어요`)
      return refresh()
    }
    case 'set-pin': {
      const r = await nf.setPin(document.getElementById('new-pin').value)
      return toast(r.ok ? 'PIN 을 설정했어요' : r.message)
    }
    case 'clear-pin':
      await nf.setPin('')
      return toast('PIN 을 껐어요')
    case 'lock-now':
      return nf.lockNow()
    case 'export-data': {
      const r = await nf.exportData()
      return r.ok && toast('백업을 저장했어요')
    }
    case 'wipe-data':
      if (el.dataset.confirm !== '1') {
        el.dataset.confirm = '1'
        el.textContent = '정말 지울까요? 한 번 더 누르기'
        return
      }
      await nf.wipeData()
      return toast('모두 지웠어요')
    case 'update-check': {
      updateLater = ''
      const u = await nf.checkUpdate({ manual: true })
      if (u.available) {
        await refresh()
        return renderUpdate(true)
      }
      return toast(u.error ? u.error : '최신 버전이에요')
    }
    case 'update-open':
      return renderUpdate(true)
    case 'update-later':
      updateLater = S.update?.version || ''
      $updateDialog.close()
      return
    case 'update-install': {
      updateMsg = ''
      const r = await nf.installUpdate()
      if (r && !r.ok) {
        updateMsg = r.message || ''
        renderUpdate()
        return toast(r.message)
      }
      return
    }
    case 'update-skip':
      await nf.skipUpdate()
      await refresh()
      return toast('이 버전은 알리지 않을게요')
    case 'signout':
      await nf.signOut()
      return refresh()
    case 'lock-setup':
      lockSetup = true
      return render()
    case 'ask-commit':
      return askCommit()
    case 'ask-cancel':
      askItem = null
      askPasted = null
      $askInput.value = ''
      renderAskPreview()
      reportDraft()
      return
    case 'coach-review': {
      coachResult = await nf.reviewSchedule(coachQuestion)
      coachQuestion = ''
      render()
      reportDraft()
      return
    }
    case 'detect-engine': {
      const v = await nf.detectEngine()
      return toast(v?.codexStatus?.subscription ? 'ChatGPT 구독 로그인 확인' : v?.claudeVersion ? `Claude Code 찾음 · ${v.claudeVersion}` : 'Codex 또는 Claude Code를 설치하고 로그인해 주세요')
    }
    case 'cal-toggle': {
      const cals = S.remote.calendars || []
      const cur = S.settings.google.calendarIds || cals.filter((c) => c.selected).map((c) => c.id)
      const next = el.checked ? [...new Set([...cur, d.id])] : cur.filter((x) => x !== d.id)
      await nf.saveSettings({ google: { calendarIds: next } })
      return toast('저장했어요')
    }
    case 'one':
      return nf.toggleOneThing()
    case 'set-one':
      return oneThingModal()
    case 'occ':
      e.stopPropagation()
      return nf.toggleOccurrence(d.key)
    case 'run':
      e.preventDefault()
      nf.run(d.job).then(() => d.job === 'weekly' && toast('주간 추천을 제안됨에 추가했어요'))
      return
    case 'new-event':
      e.stopPropagation()
      return eventModal({ date: d.date || S.today })
    case 'edit-occ': {
      e.stopPropagation()
      if (d.kind === 'activity') return activityModal(S.activities.find((a) => a.id === d.id))
      const ev = S.events.find((x) => x.id === d.id)
      return ev && eventModal(ev)
    }
    case 'sel-day':
      cal.sel = d.date
      return render()
    case 'cal-move': {
      const n = Number(d.d)
      if (n === 0) {
        const t = A.parseYmd(S.today)
        Object.assign(cal, { y: t.getFullYear(), m: t.getMonth(), sel: S.today })
      } else {
        const t = new Date(cal.y, cal.m + n, 1)
        Object.assign(cal, { y: t.getFullYear(), m: t.getMonth() })
      }
      return render()
    }
    case 'new-activity':
      return activityModal({})
    case 'edit-activity':
      return activityModal(S.activities.find((a) => a.id === d.id))
    case 'archive-stale': {
      const n = await nf.archiveStale()
      return toast(`${n}개를 보류로 옮겼어요 (보류 칸에서 되살릴 수 있어요)`)
    }
    case 'filter':
      boardFilter = d.d
      return render()
    case 'link':
      e.preventDefault()
      return nf.openLink(d.url)
    case 'say':
      return speak(d.text)
    case 'say-all': {
      const lines = (S.english?.dialogue || []).map((l) => l.en).join(' … ')
      return speak(lines, { rate: 0.9 })
    }
    case 'widget-mode':
      return nf.setWidgetMode(S.widgetMode === 'edit' ? 'pinned' : 'edit')
    case 'seg': {
      const v = isNaN(Number(d.v)) ? d.v : Number(d.v)
      await nf.saveSettings(setByPath(d.set, v))
      return toast('저장했어요')
    }
    case 'save-key': {
      const key = document.getElementById('key').value
      if (!key) return
      el.disabled = true
      el.textContent = '테스트 중…'
      const r = await nf.setKey(key)
      toast(r.ok ? 'AI 키가 연결됐어요' : `키 확인 실패: ${r.message?.slice(0, 60)}`)
      return refresh()
    }
    case 'add-feed': {
      const name = document.getElementById('feed-name').value.trim()
      const url = document.getElementById('feed-url').value.trim()
      if (!/^https?:\/\//.test(url)) return toast('RSS 주소를 확인해 주세요')
      await nf.saveSettings({ feeds: [...S.settings.feeds, { name: name || new URL(url).hostname, url }] })
      nf.run('news')
      return toast('피드를 추가했어요')
    }
    case 'del-feed':
      return nf.saveSettings({ feeds: S.settings.feeds.filter((_, i) => i !== Number(d.i)) })
  }
})

// PIN 해제
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'pin-form') return
  e.preventDefault()
  const pin = new FormData(e.target).get('pin')
  document.activeElement?.blur()
  const r = await nf.unlock(pin)
  lockError = r.ok ? '' : r.message
  refresh()
})

// 잠금 화면: 간편 모드
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'simple-form') return
  e.preventDefault()
  const ics = new FormData(e.target).get('ics')
  document.activeElement?.blur()
  lockError = ''
  const r = await nf.simpleMode(ics)
  if (!r.ok) lockError = r.message
  else toast(`간편 모드로 시작했어요 · 일정 ${r.count}개`)
  refresh()
})

// 잠금 화면: 로그인 설정 저장
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'auth-form') return
  e.preventDefault()
  const f = Object.fromEntries(new FormData(e.target))
  await nf.authConfig({ clientId: f.clientId, ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}) })
  lockSetup = false
  lockError = ''
  document.activeElement?.blur()
  refresh()
})

// 캘린더 빈 칸 더블클릭 → 새 일정
document.addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.cell')
  if (cell && !e.target.closest('.pill')) eventModal({ date: cell.dataset.date })
})

// 설정 입력 → 자동 저장
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-set]')
  if (!el || el.tagName === 'BUTTON') return
  const key = el.dataset.set
  let v = el.type === 'checkbox' ? el.checked : el.value
  if (key === 'icsUrls') v = v.split(/\s+/).map((x) => x.trim()).filter(Boolean)
  if (key === 'google.allowedEmails') v = v.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
  if (el.type === 'number' || el.type === 'range' || key === 'schedule.weeklyDay') v = Number(v)
  await nf.saveSettings(setByPath(key, v))
  toast('저장했어요')
})
// 불투명도는 드래그 중에도 바로 반영
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-set="widget.opacity"]')) nf.saveSettings({ widget: { opacity: Number(e.target.value) } })
})

// 보드 드래그 앤 드롭
document.addEventListener('dragstart', (e) => {
  const t = e.target.closest('.task')
  if (!t) return
  e.dataTransfer.setData('text/plain', t.dataset.id)
  t.classList.add('dragging')
})
document.addEventListener('dragend', (e) => e.target.closest?.('.task')?.classList.remove('dragging'))
document.addEventListener('dragover', (e) => {
  const col = e.target.closest('.col')
  if (!col) return
  e.preventDefault()
  document.querySelectorAll('.col.over').forEach((c) => c !== col && c.classList.remove('over'))
  col.classList.add('over')
})
document.addEventListener('drop', async (e) => {
  const col = e.target.closest('.col')
  document.querySelectorAll('.col.over').forEach((c) => c.classList.remove('over'))
  if (!col) return
  e.preventDefault()
  const id = e.dataTransfer.getData('text/plain')
  if (id) await nf.setActivityStatus(id, col.dataset.status)
})

nf.onNavigate((v) => {
  if (v === 'update') return renderUpdate(true)
  go(v)
})
nf.onChange(refresh)
window.addEventListener('hashchange', () => {
  route = location.hash.slice(1) || 'today'
  render()
})
// 위젯의 업데이트 알림으로 열렸으면 팝업부터
if (route === 'update') {
  route = 'today'
  history.replaceState(null, '', '#today')
  const openAfter = setInterval(() => S && (clearInterval(openAfter), renderUpdate(true)), 100)
}
setInterval(() => S && A.ymd(new Date()) !== S.today && refresh(), 60000)
refresh()
