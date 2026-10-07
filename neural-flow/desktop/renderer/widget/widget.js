// 바탕화면 위젯 — 시계 · 오늘의 단 하나 · 월 달력 · 일정 · 뉴스/영어 브리핑
const A = NFAgenda
const { esc, timeAgo, speak } = UI

const root = document.getElementById('root')
let S = null
let selected = null
let view = null // { y, m }
let tab = localStorage.getItem('nf.widget.tab') || 'english'

async function refresh() {
  S = await nf.snapshot()
  document.body.classList.toggle('edit', S.widgetMode === 'edit')
  document.body.classList.toggle('privacy', !!S.privacy)
  if (S.locked) return renderLocked()
  if (!selected || !view) {
    selected = S.today
    const d = A.parseYmd(S.today)
    view = { y: d.getFullYear(), m: d.getMonth() }
  }
  document.documentElement.style.setProperty('--glass-alpha', S.settings.widget.opacity)
  document.body.classList.toggle('edit', S.widgetMode === 'edit')
  render()
}

// ── 조각들 ───────────────────────────────────────────────────────────────────
function clockCard() {
  const now = new Date()
  const dls = A.deadlines({ events: S.events, activities: S.activities }, S.today).filter((d) => d.d >= 0).slice(0, 3)
  const spinning = S.busy.brief || S.busy.news || S.busy.english
  return `
  <section class="card">
    <div class="clock">
      <div>
        <div class="clock-time" id="clock">${A.hm(now)}</div>
        <div class="clock-date">${A.formatKoreanDate(S.today)}</div>
      </div>
      <div class="clock-tools">
        <button class="icon-btn" data-act="quick" title="빠른 입력 (${S.platform === 'darwin' ? '⌘⇧Space' : 'Ctrl+Shift+Space'})">${icon('plus', 16)}</button>
        <button class="icon-btn" data-act="refresh" title="브리핑 새로고침">${icon('refresh-cw', 15, spinning ? 'spin' : '')}</button>
        <button class="icon-btn" data-act="open" data-view="today" title="관리 창 열기">${icon('settings', 15)}</button>
      </div>
    </div>
    ${
      dls.length
        ? `<div class="chips">${dls
            .map(
              (d) =>
                `<span class="chip ${d.d <= 2 ? 'hot' : ''}"><b>${A.dLabel(d.d)}</b><span class="t">${esc(d.title)}</span></span>`
            )
            .join('')}</div>`
        : ''
    }
  </section>`
}

// 코치: 일정을 보고 먼저 건네는 말 (규칙 기반, 매 갱신마다)
function coachCard() {
  const t = S.coachTips || []
  if (!t.length) return ''
  const ic = { warn: 'flag', info: 'clock', good: 'sparkles' }
  return `
  <section class="card coach">
    <div class="card-h">${icon('bot', 13)}<span class="grow">코치</span><button class="link-btn" data-act="ask">물어보기</button></div>
    ${t
      .slice(0, 3)
      .map((x) => `<div class="tip ${x.level}">${icon(ic[x.level] || 'clock', 13)}<span>${esc(x.text)}</span></div>`)
      .join('')}
  </section>`
}

function oneThingCard() {
  const b = S.brief && S.brief.date === S.today ? S.brief : null
  if (!b) {
    return `
    <section class="card">
      <div class="card-h">${icon('sunrise', 13)}<span>오늘의 단 하나</span></div>
      <div class="empty">${S.busy.brief ? '브리핑을 만드는 중…' : `아직 오늘 브리핑이 없어요. <button class="link-btn" data-act="brief">지금 만들기</button>`}</div>
    </section>`
  }
  return `
  <section class="card">
    <div class="card-h">${icon('target', 13)}<span class="grow">오늘의 단 하나</span>${b.source === 'fallback' ? '<span title="AI 엔진 없음 → 규칙 기반">자동 선정</span>' : ''}</div>
    <div class="one">
      <button class="check ${b.done ? 'on' : ''}" data-act="one" aria-label="완료 표시">${icon('check', 14)}</button>
      <div>
        <div class="one-text ${b.done ? 'done' : ''}">${esc(b.one_thing)}</div>
        ${b.one_thing_why ? `<div class="one-why">${esc(b.one_thing_why)}</div>` : ''}
      </div>
    </div>
    ${b.holiness_line ? `<div class="holy">${icon('sparkles', 13)}<span>${esc(b.holiness_line)}</span></div>` : ''}
  </section>`
}

function calendarCard(occ, dayItems) {
  const cells = A.monthGrid(view.y, view.m)
  const map = A.byDay(occ)
  const wd = A.WEEKDAYS.map((w, i) => `<div class="cal-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')
  const days = cells
    .map((c) => {
      const items = map[c.date] || []
      // 매일·평일 반복(루틴)은 점으로 찍지 않는다 — 모든 날에 점이 생겨 의미가 없어짐
      const colors = [...new Set(items.filter((o) => o.repeat !== 'daily' && o.repeat !== 'weekdays').map((o) => o.color))].slice(0, 3)
      const cls = [
        'cal-day',
        c.inMonth ? '' : 'out',
        c.weekday === 0 ? 'sun' : c.weekday === 6 ? 'sat' : '',
        c.date === S.today ? 'today' : '',
        c.date === selected ? 'sel' : '',
      ].join(' ')
      return `<button class="${cls}" data-act="day" data-date="${c.date}" aria-label="${c.date} 일정 ${items.length}개"><span>${c.day}</span>${
        colors.length ? `<div class="dots">${colors.map((c2) => `<i style="background:${c2}"></i>`).join('')}</div>` : ''
      }</button>`
    })
    .join('')
  return `
  <section class="card">
    <div class="cal-head">
      <div class="cal-title">${view.y}년 ${view.m + 1}월</div>
      <button class="icon-btn" data-act="month" data-d="-1" aria-label="이전 달">${icon('chevron-left', 15)}</button>
      <button class="icon-btn" data-act="month" data-d="0" aria-label="오늘">${icon('circle', 9)}</button>
      <button class="icon-btn" data-act="month" data-d="1" aria-label="다음 달">${icon('chevron-right', 15)}</button>
    </div>
    <div class="cal-grid">${wd}${days}</div>
    ${agendaBody(dayItems)}
  </section>`
}

function agendaBody(items) {
  const label = selected === S.today ? '오늘' : A.formatKoreanDate(selected)
  const list = items.length
    ? `<ul class="agenda">${items
        .slice(0, 4)
        .map(
          (o) => `
        <li class="ag ${o.done ? 'done' : ''}">
          <span class="bar" style="background:${o.color}"></span>
          <span class="time">${o.start ? esc(o.start) : '종일'}</span>
          <span class="title">${esc(o.title)}</span>
          ${o.kind === 'remote' ? `<span class="tag">구글</span>` : ''}
          ${
            o.kind !== 'remote'
              ? `<button class="check mini-check ${o.done ? 'on' : ''}" data-act="occ" data-key="${esc(o.key)}" aria-label="완료">${icon('check', 11)}</button>`
              : ''
          }
        </li>`
        )
        .join('')}</ul>${items.length > 4 ? `<div class="foot"><span>외 ${items.length - 4}개 · 관리 창에서 보기</span></div>` : ''}`
    : `<div class="empty">일정이 없어요.</div>`
  return `
  <div class="agenda-wrap">
    <div class="card-h">${icon('calendar-days', 13)}<span class="grow">${esc(label)} · ${items.length}</span>
      <button class="icon-btn" data-act="open" data-view="calendar" title="캘린더에서 추가">${icon('plus', 14)}</button>
    </div>
    ${list}
  </div>`
}

function briefingCard() {
  const w = S.settings.widget
  const tabs = []
  if (w.showEnglish) tabs.push(['english', 'English', 'languages'])
  if (w.showNews) tabs.push(['news', '뉴스', 'newspaper'])
  if (!tabs.length) return ''
  if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0]
  const seg = `<div class="seg">${tabs
    .map(([k, l, ic]) => `<button class="${k === tab ? 'on' : ''}" data-act="tab" data-tab="${k}">${icon(ic, 12)}${l}</button>`)
    .join('')}</div>`
  return `
  <section class="card">
    <div class="card-h"><span class="grow">${seg}</span>
      <button class="icon-btn" data-act="open" data-view="brief" title="브리핑 전체 보기">${icon('external-link', 13)}</button>
    </div>
    ${tab === 'english' ? englishBody() : newsBody()}
  </section>`
}

function englishBody() {
  const e = S.english
  if (!e) return `<div class="empty">${S.busy.english ? '오늘의 표현을 고르는 중…' : '아직 오늘의 표현이 없어요.'}</div>`
  return `
    <div class="en-expr">
      <div class="e">${esc(e.expression)}</div>
      <button class="icon-btn" data-act="say" data-text="${esc(e.expression)}" aria-label="발음 듣기">${icon('volume-2', 15)}</button>
    </div>
    <div class="en-mean">${esc(e.meaning)}</div>
    <div class="dialog">${(e.dialogue || [])
      .slice(0, 2)
      .map(
        (l) => `
      <div class="line"><span class="who">${esc(l.speaker)}</span>
        <div><div class="en">${esc(l.en)}</div><div class="ko">${esc(l.ko)}</div></div>
        <button class="icon-btn play" data-act="say" data-text="${esc(l.en)}" aria-label="듣기">${icon('volume-2', 12)}</button>
      </div>`
      )
      .join('')}</div>`
}

function newsBody() {
  const n = S.news || {}
  const items = (n.items || []).slice(0, 5)
  if (!items.length) return `<div class="empty">${S.busy.news ? '최신 정보를 모으는 중…' : '뉴스가 아직 없어요.'}</div>`
  const sum = n.summary?.bullets?.length ? `<div class="summary">${esc(n.summary.bullets[0])}</div>` : ''
  return `${sum}<ul class="news">${items
    .map(
      (i) =>
        `<li><a href="#" data-act="link" data-url="${esc(i.link)}"><span class="nt">${esc(i.title)}</span><span class="ns">${esc(i.source)} · ${timeAgo(i.date)}</span></a></li>`
    )
    .join('')}</ul>`
}

function editBar() {
  if (S.widgetMode !== 'edit') return ''
  return `<div class="edit-bar">${icon('move', 14)}<span>드래그해서 위치를 옮기세요</span><button data-act="pin">${icon('pin', 12)} 고정</button></div>`
}

// 잠금 상태: 시계만 보여주고 개인 데이터는 숨긴다
function renderLocked() {
  document.documentElement.style.setProperty('--glass-alpha', 0.72)
  root.innerHTML = `
  <section class="card">
    <div class="clock"><div>
      <div class="clock-time" id="clock">${A.hm(new Date())}</div>
      <div class="clock-date">${A.formatKoreanDate(S.today)}</div>
    </div></div>
  </section>
  <section class="card locked">
    ${icon('lock', 18)}<div><b>잠겨 있어요</b><span>${S.sessionLocked && !S.needsLogin ? 'PIN 으로 열면 일정이 보여요' : '본인 구글 계정으로 로그인하면 일정이 보여요'}</span></div>
    <button class="pill-btn" data-act="open" data-view="today">${S.sessionLocked && !S.needsLogin ? '열기' : '로그인'}</button>
  </section>`
}

function render() {
  const occ = A.occurrences(
    { events: S.events, remote: S.remote.events || [], activities: S.activities, doneMap: S.doneMap },
    A.monthGrid(view.y, view.m)[0].date,
    A.monthGrid(view.y, view.m)[41].date
  )
  const dayItems = occ.filter((o) => o.date === selected)
  const sec = S.settings.widget
  root.innerHTML =
    editBar() +
    clockCard() +
    (sec.showOneThing !== false ? oneThingCard() : '') +
    (sec.showCoach !== false ? coachCard() : '') +
    (sec.showCalendar !== false ? calendarCard(occ, dayItems) : '') +
    briefingCard()
}

// ── 상호작용 ─────────────────────────────────────────────────────────────────
root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  e.preventDefault()
  const act = el.dataset.act
  if (act === 'one') return nf.toggleOneThing()
  if (act === 'ask') return nf.openQuick()
  if (act === 'quick') return nf.openQuick()
  if (act === 'occ') return nf.toggleOccurrence(el.dataset.key)
  if (act === 'brief') return nf.run('brief')
  if (act === 'refresh') {
    nf.run('brief').then(() => nf.run('english'))
    return nf.run('news')
  }
  if (act === 'open') return nf.open(el.dataset.view)
  if (act === 'link') return nf.openLink(el.dataset.url)
  if (act === 'say') return speak(el.dataset.text)
  if (act === 'pin') return nf.setWidgetMode('pinned')
  if (act === 'tab') {
    tab = el.dataset.tab
    localStorage.setItem('nf.widget.tab', tab)
    return render()
  }
  if (act === 'day') {
    selected = el.dataset.date
    return render()
  }
  if (act === 'month') {
    const d = Number(el.dataset.d)
    if (d === 0) {
      const t = A.parseYmd(S.today)
      view = { y: t.getFullYear(), m: t.getMonth() }
      selected = S.today
    } else {
      const t = new Date(view.y, view.m + d, 1)
      view = { y: t.getFullYear(), m: t.getMonth() }
    }
    return render()
  }
})

// 내용 높이에 맞춰 창 크기 조절
new ResizeObserver(() => nf.resizeWidget(root.getBoundingClientRect().height)).observe(root)

// 시계: 1초마다 숫자만 갱신, 날짜가 바뀌면 전체 갱신
setInterval(() => {
  const el = document.getElementById('clock')
  if (el) el.textContent = A.hm(new Date())
  if (S && A.ymd(new Date()) !== S.today) {
    selected = null
    view = null
    refresh()
  }
}, 1000)

nf.onChange(refresh)
refresh()
