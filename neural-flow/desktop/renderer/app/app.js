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
  ['board', '활동 보드', 'square-kanban'],
  ['brief', '브리핑', 'newspaper'],
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
}

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

const ENGINE_LABEL = { claude: 'AI · Claude Code', gemini: 'AI · Gemini', none: 'AI 꺼짐 (규칙 모드)' }
const avatar = (a) =>
  a.picture
    ? `<img class="avatar" src="${esc(a.picture)}" alt="" referrerpolicy="no-referrer" />`
    : `<span class="avatar">${esc((a.name || a.email || '?').slice(0, 1).toUpperCase())}</span>`

// ── 잠금(로그인) 화면 ────────────────────────────────────────────────────────
let lockError = ''
let lockSetup = false
function renderLock() {
  const g = S.settings.google || {}
  const owner = (g.allowedEmails || []).join(', ')
  const needSetup = !g.clientId || lockSetup
  if ($lock.contains(document.activeElement) && document.activeElement.matches('input')) return
  $lock.innerHTML = `<div class="lock"><div class="lock-card">
    <div class="brand-mark">${icon('waves', 30)}</div>
    <h1>neural-flow</h1>
    <p>${owner ? `<b>${esc(owner)}</b> 계정으로만 열 수 있어요` : '처음 로그인한 구글 계정이 주인으로 등록돼요'}</p>
    ${
      needSetup
        ? `<ol class="steps">
            <li>Google Cloud 콘솔 → API 및 서비스 → <b>Google Calendar API</b> 사용 설정</li>
            <li>OAuth 동의 화면: 외부 · 테스트 사용자에 본인 이메일 추가</li>
            <li>사용자 인증 정보 → OAuth 클라이언트 ID → 유형 <b>데스크톱 앱</b></li>
            <li>만든 클라이언트 ID·보안 비밀을 아래에 붙여넣기</li>
          </ol>
          <form id="auth-form">
            <div class="f"><label>클라이언트 ID</label><input class="input" name="clientId" value="${esc(g.clientId || '')}" placeholder="xxxx.apps.googleusercontent.com" required /></div>
            <div class="f"><label>클라이언트 보안 비밀</label><input class="input" name="clientSecret" type="password" placeholder="${g.hasSecret ? '저장됨 — 바꿀 때만 입력' : 'GOCSPX-…'}" /></div>
            <button class="btn primary lg block">저장하고 계속</button>
          </form>`
        : `<button class="btn primary lg block gbtn" data-act="signin" ${S.busy.signin ? 'disabled' : ''}>${S.busy.signin ? '브라우저에서 로그인을 마쳐 주세요…' : 'Google 계정으로 로그인'}</button>
           <button class="btn ghost sm" style="margin-top:12px" data-act="lock-setup">로그인 설정 바꾸기</button>`
    }
    ${lockError ? `<div class="err">${esc(lockError)}</div>` : ''}
  </div></div>`
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
  const [ic, label] = KIND[askItem.kind] || KIND.task
  $askPreview.innerHTML = `<div class="preview">
    <span class="kind">${icon(ic, 20)}</span>
    <div class="what"><b>${esc(askItem.title)}</b><span>${esc(label)} · ${esc(describe(askItem))}${askItem.source && askItem.source !== 'rules' ? ' · AI 해석' : ''}</span></div>
    <button class="btn sm" data-act="ask-cancel">취소</button>
    <button class="btn sm primary" data-act="ask-commit">${icon('corner-down-left', 14)}추가</button>
  </div>`
}
async function askSubmit() {
  const text = $askInput.value.trim()
  if (!text) return
  if (askItem && askItem._text === text) return askCommit()
  askItem = { ...(await nf.previewInput(text)), _text: text }
  renderAskPreview()
}
async function askCommit() {
  if (!askItem) return
  const r = await nf.commitInput(askItem)
  toast(r?.message || '추가했어요')
  askItem = null
  $askInput.value = ''
  renderAskPreview()
}
$ask.addEventListener('submit', (e) => {
  e.preventDefault()
  askSubmit()
})
$askInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    askItem = null
    $askInput.value = ''
    renderAskPreview()
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
      <div class="status"><span class="dot ${k.provider !== 'none' ? 'ok' : 'warn'}"></span>${ENGINE_LABEL[k.provider] || '규칙 모드'}</div>
      <div class="status"><span class="dot ${S.account ? 'ok' : ''}"></span>${
        S.account ? `구글 캘린더 · ${timeAgo(S.remote.fetchedAt) || '동기화 대기'}` : k.icsUrls?.length ? 'iCal 주소로 읽는 중' : '구글 캘린더 미연결'
      }</div>
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
function viewToday() {
  const b = S.brief && S.brief.date === S.today ? S.brief : null
  const items = occ(S.today, S.today)
  const dls = A.deadlines({ events: S.events, activities: S.activities }, S.today)
  const name = S.settings.userName || ''
  const hist = Object.fromEntries((S.history || []).map((h) => [h.date, h]))
  const days = Array.from({ length: 7 }, (_, i) => A.addDays(S.today, i - 6))

  const hero = b
    ? `
    <section class="hero">
      <div class="hero-label">${icon('target', 14)}오늘의 단 하나</div>
      <div class="hero-main">
        <button class="check ${b.done ? 'on' : ''}" data-act="one" aria-label="완료 표시">${icon('check', 16)}</button>
        <div>
          <div class="hero-text ${b.done ? 'done' : ''}">${esc(b.one_thing)}</div>
          ${b.one_thing_why ? `<div class="hero-why">${esc(b.one_thing_why)}</div>` : ''}
        </div>
      </div>
      <div class="hero-foot">
        ${
          b.source === 'gemini' || b.source === 'claude'
            ? `<span class="badge accent">${icon('sparkles', 11)}${b.source === 'claude' ? 'Claude' : 'Gemini'} 코칭</span>`
            : b.source === 'manual'
              ? '<span class="badge">직접 정함</span>'
              : '<span class="badge">규칙 기반 선정</span>'
        }
        ${b.done ? '<span class="badge ok">완료</span>' : ''}
        <span class="grow"></span>
        <button class="btn sm ghost" data-act="set-one">${icon('pencil', 13)}직접 정하기</button>
        <button class="btn sm" data-act="run" data-job="brief" ${S.busy.brief ? 'disabled' : ''}>${icon('refresh-cw', 13, S.busy.brief ? 'spin' : '')}다시 생성</button>
      </div>
    </section>`
    : `
    <section class="hero">
      <div class="hero-label">${icon('sunrise', 14)}오늘의 단 하나</div>
      <div class="hero-text" style="margin-top:12px">${S.busy.brief ? '브리핑을 만드는 중이에요…' : '아직 오늘 브리핑이 없어요'}</div>
      <div class="hero-foot"><span class="grow"></span>
        <button class="btn sm ghost" data-act="set-one">${icon('pencil', 13)}직접 정하기</button>
        <button class="btn sm primary" data-act="run" data-job="brief" ${S.busy.brief ? 'disabled' : ''}>${icon('sparkles', 13)}지금 만들기</button>
      </div>
    </section>`

  const mentor = b
    ? [
        ['sparkles', '거룩 한 줄', b.holiness_line],
        ['target', '비어있는 영역 코칭', b.stuck_coaching],
        ['newspaper', '트렌드 한 줄', b.trend],
      ]
        .filter((r) => r[2])
        .map(([ic, l, t]) => `<div class="row"><span class="ic">${icon(ic, 14)}</span><div><div class="lbl">${l}</div>${esc(t)}</div></div>`)
        .join('')
    : ''

  return `
  <div class="page-h"><div class="titles">
    <div class="eyebrow">${greetingByHour(new Date().getHours())}${name ? `, ${esc(name)}님` : ''}${b?.greeting ? ` · ${esc(b.greeting)}` : ''}</div>
    <h1>${A.formatKoreanDate(S.today)}</h1>
  </div></div>
  <div class="grid-2">
    <div class="stack">
      ${hero}
      ${mentor ? `<section class="card"><h2>${icon('sun', 14)}멘토 브리핑</h2><div class="rows">${mentor}</div></section>` : ''}
      <section class="card">
        <h2><span class="grow">최근 7일 · 단 하나 실행</span><span class="muted small">${days.filter((d) => hist[d]?.done).length}/7</span></h2>
        <div class="streak">${days
          .map((d) => {
            const h = hist[d]
            const cls = h?.done ? 'done' : h && d < S.today ? 'miss' : ''
            return `<div title="${esc(h?.one_thing || '')}"><i class="${cls}"></i>${A.WEEKDAYS[A.weekday(d)]}</div>`
          })
          .join('')}</div>
      </section>
    </div>
    <div class="stack">
      <section class="card">
        <h2><span class="grow">오늘 일정 · ${items.length}</span>
          <button class="icon-btn" data-act="new-event" data-date="${S.today}" title="일정 추가">${icon('plus', 16)}</button></h2>
        ${agendaList(items)}
      </section>
      <section class="card">
        <h2>${icon('hourglass', 14)}다가오는 마감</h2>
        ${
          dls.length
            ? dls
                .map(
                  (d) =>
                    `<div class="dl"><span class="d" style="color:${d.d <= 2 ? 'var(--danger)' : 'var(--text)'}">${A.dLabel(d.d)}</span><span class="t">${esc(d.title)}</span><span class="muted small">${d.date.slice(5).replace('-', '/')}</span></div>`
                )
                .join('')
            : `<div class="empty">2주 안에 마감이 없어요. 일정에 'D-day 표시'를 켜면 여기에 나와요.</div>`
        }
      </section>
    </div>
  </div>`
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
      ${S.settings.icsUrls?.length ? `<button class="btn sm ghost" data-act="run" data-job="calendar">${icon('refresh-cw', 13, S.busy.calendar ? 'spin' : '')}동기화</button>` : ''}
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

// ── 활동 보드 ───────────────────────────────────────────────────────────────
function viewBoard() {
  const list = S.activities.filter((a) => !boardFilter || a.domain === boardFilter)
  const cols = STATUSES.map((st) => {
    const cards = list.filter((a) => (a.status || '제안됨') === st)
    return `<div class="col" data-status="${st}">
      <div class="col-h">${st}<span class="n">${cards.length}</span></div>
      <div class="col-list">${cards.map(taskCard).join('')}</div>
    </div>`
  }).join('')
  const used = [...new Set(S.activities.map((a) => a.domain).filter(Boolean))]
  return `
  <div class="page-h">
    <div class="titles"><div class="eyebrow">제안 → 승인 → 예정(캘린더) → 진행 → 완료</div><h1>활동 보드</h1></div>
    ${(() => {
      const n = S.activities.filter((a) => a.date && a.date < S.today && !['완료', '보류'].includes(a.status)).length
      return n ? `<button class="btn sm" data-act="archive-stale" title="날짜가 지난 미완료 활동을 보류로">${icon('hourglass', 13)}지난 활동 ${n}개 정리</button>` : ''
    })()}
    <button class="btn sm" data-act="run" data-job="weekly" ${S.busy.brief ? 'disabled' : ''}>${icon('sparkles', 13, S.busy.brief ? 'spin' : '')}주간 추천 받기</button>
    <button class="btn sm primary" data-act="new-activity">${icon('plus', 14)}활동 추가</button>
  </div>
  <div class="filters">
    <button class="fchip ${!boardFilter ? 'on' : ''}" data-act="filter" data-d="">전체</button>
    ${used.map((d) => `<button class="fchip ${boardFilter === d ? 'on' : ''}" data-act="filter" data-d="${esc(d)}"><span class="dom" style="--c:${A.domainColor(d)}"><i></i></span>${esc(plainDomain(d))}</button>`).join('')}
  </div>
  <div class="board">${cols}</div>
  <p class="muted small">카드를 끌어서 상태를 바꿔요. 날짜를 정하면 '예정됨'이 되고 캘린더·위젯에 나타나요. AI 추천은 항상 '제안됨'으로만 들어와요 — 승인은 직접.</p>`
}

function taskCard(a) {
  const pr = { 높음: 'danger', 중간: 'warn', 낮음: '' }[a.priority] ?? ''
  const overdue = a.date && a.date < S.today && a.status !== '완료'
  return `<article class="task" draggable="true" data-id="${a.id}" data-act="edit-activity">
    <div class="tn">${esc(a.name)}</div>
    ${a.why ? `<div class="tw">${esc(a.why)}</div>` : ''}
    <div class="tm">
      ${a.domain ? `<span class="badge"><span class="dom" style="--c:${A.domainColor(a.domain)}"><i></i></span>${esc(plainDomain(a.domain))}</span>` : ''}
      ${a.priority ? `<span class="badge ${pr}">${esc(a.priority)}</span>` : ''}
      ${a.min ? `<span class="badge">${icon('clock', 11)}${a.min}분</span>` : ''}
      ${a.date ? `<span class="badge ${overdue ? 'danger' : ''}">${icon('calendar-days', 11)}${a.date.slice(5).replace('-', '/')}</span>` : ''}
    </div>
  </article>`
}

// ── 브리핑 ──────────────────────────────────────────────────────────────────
function viewBrief() {
  const n = S.news || {}
  const e = S.english
  const sum = n.summary
  const news = `
  <section class="card">
    <h2>${icon('newspaper', 14)}<span class="grow">최신 정보</span>
      <span class="muted small">${n.fetchedAt ? timeAgo(n.fetchedAt) : ''}</span>
      <button class="icon-btn" data-act="run" data-job="news" title="새로고침">${icon('refresh-cw', 14, S.busy.news ? 'spin' : '')}</button></h2>
    ${sum?.bullets?.length ? `<ul class="summary">${sum.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    ${sum?.pick?.title ? `<div class="pick">${icon('target', 14)}<div><b>${esc(sum.pick.title)}</b><br>${esc(sum.pick.why || '')}</div></div>` : ''}
    ${!S.settings.hasKey ? `<p class="muted small" style="margin:0 0 8px">AI 키를 연결하면 3줄 요약과 '오늘 읽을 1개'를 골라줘요.</p>` : ''}
    ${
      (n.items || []).length
        ? `<ul class="news-list">${n.items
            .slice(0, 20)
            .map(
              (i) =>
                `<li><a href="#" data-act="link" data-url="${esc(i.link)}"><div><div class="nt">${esc(i.title)}</div><div class="ns">${esc(i.source)} · ${timeAgo(i.date)}</div></div></a></li>`
            )
            .join('')}</ul>`
        : `<div class="empty">${S.busy.news ? '모으는 중…' : '아직 수집된 뉴스가 없어요.'}</div>`
    }
    ${(n.errors || []).length ? `<p class="muted small">불러오지 못한 피드: ${n.errors.map((x) => esc(x.name)).join(', ')}</p>` : ''}
  </section>`

  const english = e
    ? `
  <section class="card">
    <h2>${icon('languages', 14)}<span class="grow">오늘의 영어 회화</span>
      ${e.source === 'gemini' || e.source === 'claude' ? '<span class="badge accent">AI 맞춤</span>' : '<span class="badge">기본 표현집</span>'}
      <button class="icon-btn" data-act="run" data-job="english" title="다른 표현">${icon('refresh-cw', 14, S.busy.english ? 'spin' : '')}</button></h2>
    <div class="inline" style="align-items:flex-start">
      <div style="flex:1"><div class="en-big">${esc(e.expression)}</div>
      <div class="en-mean">${esc(e.meaning)}</div>
      ${e.situation ? `<div class="en-sit">${esc(e.situation)}</div>` : ''}</div>
      <button class="btn sm" data-act="say" data-text="${esc(e.expression)}">${icon('volume-2', 14)}듣기</button>
    </div>
    <div class="dialog">${(e.dialogue || [])
      .map(
        (l, i) => `<div class="bubble ${i % 2 ? 'b' : ''}"><span class="who">${esc(l.speaker)}</span>
          <div class="body"><div class="en">${esc(l.en)}</div><div class="ko">${esc(l.ko)}</div></div>
          <button class="icon-btn" data-act="say" data-text="${esc(l.en)}" aria-label="듣기">${icon('volume-2', 14)}</button></div>`
      )
      .join('')}</div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn sm ghost" data-act="say-all">${icon('volume-2', 13)}대화 전체 듣기 (섀도잉)</button>
    </div>
    ${e.variations?.length ? `<div style="margin-top:14px"><div class="lbl muted small">비슷한 표현</div>${e.variations.map((v) => `<span class="badge" style="margin:6px 6px 0 0">${esc(v)}</span>`).join('')}</div>` : ''}
    ${e.tip ? `<div class="tip">${icon('flag', 14)}<div>${esc(e.tip)}</div></div>` : ''}
  </section>`
    : `<section class="card"><h2>${icon('languages', 14)}오늘의 영어 회화</h2><div class="empty"><button class="btn sm" data-act="run" data-job="english">표현 받기</button></div></section>`

  const hist = (S.englishHistory || []).slice(0, -1).reverse().slice(0, 10)
  const past = hist.length
    ? `<section class="card"><h2>지난 표현 복습</h2><ul class="hist">${hist
        .map(
          (h) =>
            `<li><span class="d">${h.date.slice(5).replace('-', '/')}</span><span class="e">${esc(h.expression)}</span><span class="muted small">${esc(h.meaning)}</span><button class="icon-btn" data-act="say" data-text="${esc(h.expression)}">${icon('volume-2', 13)}</button></li>`
        )
        .join('')}</ul></section>`
    : ''

  return `
  <div class="page-h"><div class="titles"><div class="eyebrow">최신 정보 + 영어 회화</div><h1>브리핑</h1></div></div>
  <div class="grid-2"><div class="stack">${news}</div><div class="stack">${english}${past}</div></div>`
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
  <div class="page-h"><div class="titles"><div class="eyebrow">모든 데이터는 이 PC에만 저장돼요</div><h1>설정</h1></div></div>
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

    <section class="card"><h2>${icon('bot', 16)}AI 엔진</h2>
      ${field(
        '엔진',
        `지금: <b>${esc(ENGINE_LABEL[s.provider] || '')}</b><br>자동 = 노트북에 Claude Code 가 있으면 그것(내 Claude 구독), 없으면 Gemini 키, 둘 다 없으면 규칙.`,
        seg('engine', s.engine || 'auto', [['auto', '자동'], ['claude', 'Claude Code'], ['gemini', 'Gemini'], ['off', '끄기']])
      )}
      ${field(
        'Claude Code',
        s.claudeVersion ? `<b style="color:var(--ok)">찾음</b> · ${esc(s.claudeVersion)}` : '못 찾음 — 노트북 터미널에서 <code>claude</code> 설치·로그인 후 [다시 찾기]',
        `<div class="inline"><input class="input" data-set="claudeCmd" value="${esc(s.claudeCmd || 'claude')}" /><button class="btn" data-act="detect-engine">다시 찾기</button></div>`
      )}
      ${field('Claude 모델', '비우면 Claude Code 기본값', `<input class="input" data-set="claudeModel" value="${esc(s.claudeModel || '')}" placeholder="예: sonnet" />`)}
      ${field(
        'Gemini API 키',
        `상태: ${s.hasKey ? `<b style="color:var(--ok)">연결됨</b> (${esc(s.keySource)})` : '<b style="color:var(--warn)">없음</b> — 규칙 기반으로 동작'}<br>기존 neural-flow 의 <code>GOOGLE_API_KEY</code>와 같은 키. OS 키체인으로 암호화해 저장.`,
        `<div class="inline"><input class="input" id="key" type="password" placeholder="${s.hasKey ? '••••••••  (바꾸려면 새 키 입력)' : 'AIza…'}" autocomplete="off" /><button class="btn" data-act="save-key">저장·테스트</button></div>`
      )}
      ${field('모델', '기본 gemini-2.5-flash', `<input class="input" data-set="geminiModel" value="${esc(s.geminiModel)}" />`)}
      ${field('이름', '브리핑에서 부를 이름', `<input class="input" data-set="userName" value="${esc(s.userName)}" />`)}
      ${field('영어 수준', '회화 표현 난이도', `<input class="input" data-set="englishLevel" value="${esc(s.englishLevel)}" />`)}
    </section>

    <section class="card"><h2>${icon('calendar-days', 16)}iCal 주소 (선택 · 읽기 전용)</h2>
      ${field(
        '비공개 iCal 주소',
        `로그인 없이 다른 캘린더(회사·공유)를 더 보고 싶을 때. 구글 캘린더 설정 → '캘린더 통합' → <b>iCal 형식의 비공개 주소</b>. 한 줄에 하나.${(S.remote.errors || []).length ? `<br><span style="color:var(--danger)">오류: ${S.remote.errors.map((e) => esc(e.message)).join(', ')}</span>` : ''}`,
        `<textarea class="input" data-set="icsUrls" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics">${esc((s.icsUrls || []).join('\n'))}</textarea>
         <div class="muted small" style="margin-top:6px">${S.remote.fetchedAt ? `마지막 동기화 ${timeAgo(S.remote.fetchedAt)} · ${S.remote.events.length}개` : ''}</div>`
      )}
    </section>

    <section class="card"><h2>${icon('newspaper', 14)}뉴스 피드 (RSS)</h2>
      ${(s.feeds || [])
        .map(
          (f, i) =>
            `<div class="feed"><b>${esc(f.name)}</b><span class="fu">${esc(f.url)}</span><button class="icon-btn" data-act="del-feed" data-i="${i}" aria-label="삭제">${icon('trash-2', 14)}</button></div>`
        )
        .join('')}
      <div class="inline" style="margin-top:8px"><input class="input" id="feed-name" placeholder="이름" style="max-width:140px" /><input class="input" id="feed-url" placeholder="RSS 주소 (https://…)" /><button class="btn" data-act="add-feed">${icon('plus', 14)}추가</button></div>
    </section>

    <section class="card"><h2>${icon('pin', 14)}바탕화면 위젯</h2>
      ${field('불투명도', '배경화면이 비치는 정도', `<input type="range" min="0.25" max="0.95" step="0.01" data-set="widget.opacity" value="${w.opacity}" />`)}
      ${field('너비', '300 ~ 520px', `<input class="input" type="number" min="300" max="520" step="10" data-set="widget.width" value="${w.width}" style="max-width:120px" />`)}
      ${field('테마', '관리 창에도 함께 적용', seg('widget.theme', w.theme, [['dark', '다크'], ['light', '라이트'], ['auto', '시스템']]))}
      ${field('보여줄 카드', '', `<div class="stack" style="gap:10px">
          <label class="check-line">${sw('widget.showOneThing', w.showOneThing !== false)}오늘의 단 하나</label>
          <label class="check-line">${sw('widget.showCalendar', w.showCalendar !== false)}달력 + 일정</label>
          <label class="check-line">${sw('widget.showEnglish', w.showEnglish)}영어 회화</label>
          <label class="check-line">${sw('widget.showNews', w.showNews)}뉴스</label></div>`)}
      ${field('클릭 통과', '켜면 위젯이 마우스를 무시해요 (순수 배경처럼). 트레이 메뉴에서도 전환.', sw('widget.clickThrough', w.clickThrough))}
      ${field(
        '위치 옮기기',
        `${S.platform === 'darwin' ? '⌘⌥N' : 'Ctrl+Alt+N'} 으로도 전환. ${S.platform === 'win32' ? '' : '고정 상태에서는 OS 특성상 위젯 클릭이 안 돼요 — 편집 모드에서 조작하세요.'}`,
        `<button class="btn" data-act="widget-mode">${S.widgetMode === 'edit' ? '고정하기' : '편집 모드 켜기'}</button>`
      )}
    </section>

    <section class="card"><h2>${icon('clock', 14)}자동 비서 스케줄</h2>
      ${field('아침 브리핑', '오늘의 단 하나 + 영어 표현 + 알림. PC가 꺼져 있었다면 켜질 때 바로 실행.', `<input class="input" type="time" data-set="schedule.briefTime" value="${sc.briefTime}" style="max-width:140px" />`)}
      ${field('저녁 체크인', '단 하나를 아직 안 끝냈을 때만 알림', `<input class="input" type="time" data-set="schedule.checkinTime" value="${sc.checkinTime}" style="max-width:140px" />`)}
      ${field(
        '주간 추천',
        '다음 주 활동을 제안됨으로 추가',
        `<div class="inline"><select class="input" data-set="schedule.weeklyDay" style="max-width:120px">${opt(
          A.WEEKDAYS.map((d, i) => [String(i), `${d}요일`]),
          String(sc.weeklyDay)
        )}</select><input class="input" type="time" data-set="schedule.weeklyTime" value="${sc.weeklyTime}" style="max-width:140px" /></div>`
      )}
      ${field('뉴스 새로고침', '시간 간격', `<input class="input" type="number" min="1" max="24" data-set="schedule.newsEveryHours" value="${sc.newsEveryHours}" style="max-width:120px" />`)}
      ${field('로그인 시 자동 실행', 'PC를 켜면 위젯이 바로 떠요', sw('autoStart', s.autoStart))}
    </section>
  </div>`
}

// ── 모달: 일정 / 활동 ────────────────────────────────────────────────────────
function openModal(html, onSubmit) {
  $modal.innerHTML = html
  $modal.showModal()
  const form = $modal.querySelector('form')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (e.submitter?.value === 'cancel') return $modal.close()
    await onSubmit(Object.fromEntries(new FormData(form)), e.submitter?.value)
    $modal.close()
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
        const r = await nf.commitInput({ kind: 'event', title: f.title, date: f.date, start: f.start || null, minutes: mins > 0 ? mins : 60, target: 'google' })
        return toast(r?.message || '저장했어요')
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
const VIEWS = { today: viewToday, calendar: viewCalendar, board: viewBoard, brief: viewBrief, settings: viewSettings }

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
      return renderAskPreview()
    case 'detect-engine': {
      const v = await nf.detectEngine()
      return toast(v ? `Claude Code 찾음 · ${v}` : 'Claude Code 를 못 찾았어요')
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

nf.onNavigate((v) => go(v))
nf.onChange(refresh)
window.addEventListener('hashchange', () => {
  route = location.hash.slice(1) || 'today'
  render()
})
setInterval(() => S && A.ymd(new Date()) !== S.today && refresh(), 60000)
refresh()
