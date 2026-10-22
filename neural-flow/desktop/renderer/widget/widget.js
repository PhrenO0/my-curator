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
  syncMemo()
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

// ── 쪼갠 할 일 (개념 트리 요약: 진행 막대 + 다음 조각 3개) ──
function plansCard() {
  const plans = (S.plans || []).filter((p) => p.tree && p.progress.done < p.progress.total)
  if (!plans.length) return ''
  const bar = (p) => {
    const n = 10
    const on = p.progress.total ? Math.round((p.progress.done / p.progress.total) * n) : 0
    return `<span class="pbar" aria-label="${p.progress.done}/${p.progress.total}">${'▓'.repeat(on)}${'░'.repeat(n - on)}</span>`
  }
  return `<section class="card plans">
    <div class="card-h">${icon('list-todo', 13)}<span class="grow">쪼갠 할 일</span>
      <button class="icon-btn" data-act="open" data-view="memo" title="트리 전체 보기">${icon('external-link', 13)}</button></div>
    ${plans
      .slice(0, 3)
      .map((p) => {
        const next = []
        p.tree.concepts.forEach((c, ci) => c.steps.forEach((st, si) => !st.done && next.push({ c, st, ci, si })))
        return `<div class="plan">
          <div class="plan-h"><span class="pt">${esc(p.title)}</span>${bar(p)}<span class="pn">${p.progress.done}/${p.progress.total}</span></div>
          ${next
            .slice(0, 3)
            .map((x) => `<button class="step" data-act="step" data-plan="${esc(p.id)}" data-ci="${x.ci}" data-si="${x.si}"><span class="box"></span><span class="st">${esc(x.st.title)}</span><span class="sm">${x.st.minutes}분</span></button>`)
            .join('')}
        </div>`
      })
      .join('')}
  </section>`
}

// ── 메모장 ──
const $memo = document.getElementById('memo')
const $memoWrap = document.getElementById('memo-wrap')
const $memoState = document.getElementById('memo-state')
let memoTimer = null
function syncMemo() {
  $memoWrap.hidden = !S || S.locked
  if (!S || S.locked) return
  if (document.activeElement !== $memo && $memo.value !== (S.memo?.text || '')) $memo.value = S.memo?.text || ''
  const busy = !!S.busy?.memo
  const btn = document.getElementById('memo-organize')
  btn.disabled = busy
  btn.textContent = busy ? '정리 중…' : '정리'
  const pending = (S.memoCandidates || []).length
  if (!memoTimer) $memoState.textContent = pending ? `후보 ${pending}개 확인 대기` : ''
}
function saveMemo() {
  clearTimeout(memoTimer)
  memoTimer = null
  $memoState.textContent = '저장됨'
  return nf.saveMemo($memo.value)
}
// Windows 고정 위젯은 평소 키보드를 받지 않는다 → 누를 때만 잠시 받게 한다
$memo.addEventListener('pointerdown', async () => {
  if (document.activeElement === $memo) return
  await nf.widgetFocus(true)
  $memo.focus()
})
$memo.addEventListener('input', () => {
  $memoState.textContent = '적는 중…'
  nf.setInputActive?.(true).catch(() => {})
  clearTimeout(memoTimer)
  memoTimer = setTimeout(saveMemo, 600)
})
$memo.addEventListener('blur', async () => {
  if (memoTimer) await saveMemo()
  nf.setInputActive?.(false).catch(() => {})
  nf.widgetFocus(false)
})
$memo.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $memo.blur()
})
document.getElementById('memo-organize').addEventListener('click', async () => {
  if (memoTimer) await saveMemo()
  nf.open('memo') // 후보 확인·수락은 관리 창에서
  const r = await nf.organizeMemo()
  if (r && !r.ok) $memoState.textContent = r.message
})

// ── 조각들 ───────────────────────────────────────────────────────────────────
function clockCard() {
  const now = new Date()
  const dls = A.deadlines({ events: S.events, activities: S.activities }, S.today).filter((d) => d.d >= 0).slice(0, 3)
  const spinning = S.busy.calendar
  return `
  <section class="card">
    <div class="clock">
      <div>
        <div class="clock-time" id="clock">${A.hm(now)}</div>
        <div class="clock-date">${A.formatKoreanDate(S.today)}</div>
      </div>
      <div class="clock-tools">
        <button class="icon-btn" data-act="quick" title="빠른 입력 (${S.platform === 'darwin' ? '⌘⇧Space' : 'Ctrl+Shift+Space'})">${icon('plus', 16)}</button>
        <button class="icon-btn" data-act="refresh" title="캘린더 새로고침">${icon('refresh-cw', 15, spinning ? 'spin' : '')}</button>
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
        .join('')}</ul>`
    : `<div class="empty">일정이 없어요.</div>`
  return `
  <div class="agenda-wrap">
    <div class="card-h">${icon('calendar-days', 13)}<span class="grow">${esc(label)} · ${items.length}</span>
      <button class="icon-btn" data-act="open" data-view="calendar" title="캘린더에서 추가">${icon('plus', 14)}</button>
    </div>
    ${list}
  </div>`
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
  const upd = S.update?.available && S.update.version !== S.settings.updates?.skipVersion
  root.innerHTML =
    editBar() +
    (upd
      ? `<button class="update-pill" data-act="open" data-view="update">${icon('sparkles', 13)}<span>${esc(S.update.version)} 새 버전 — 눌러서 업데이트</span></button>`
      : '') +
    clockCard() +
    plansCard() +
    (sec.showCalendar !== false ? calendarCard(occ, dayItems) : '')

}

// ── 상호작용 ─────────────────────────────────────────────────────────────────
root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  e.preventDefault()
  const act = el.dataset.act
  if (act === 'quick') return nf.openQuick()
  if (act === 'occ') return nf.toggleOccurrence(el.dataset.key)
  if (act === 'refresh') {
    return nf.run('calendar')
  }
  if (act === 'open') return nf.open(el.dataset.view)
  if (act === 'step') return nf.togglePlanStep(el.dataset.plan, Number(el.dataset.ci), Number(el.dataset.si))
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
new ResizeObserver(() => nf.resizeWidget(document.getElementById('wrap').getBoundingClientRect().height)).observe(document.getElementById('wrap'))

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
