// 바탕화면 위젯 — Notion Command Center 의 "📅 앞으로 7일" 보드. 누르면 Notion 앱에서 열린다.
const root = document.getElementById('root')
const WD = ['일', '월', '화', '수', '목', '금', '토']
let S = null

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
function ago(iso) {
  if (!iso) return ''
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`
}
const tagClass = (t) => (/마감/.test(t) ? 'due' : /필수/.test(t) ? 'must' : 'etc')

async function refresh() {
  S = await nf.snapshot()
  document.documentElement.style.setProperty('--glass-alpha', S.settings.widget.opacity)
  document.body.classList.toggle('edit', S.widgetMode === 'edit')
  render()
}

function item(x) {
  return `<li class="it ${x.tag ? tagClass(x.tag) : ''}"><span class="tm">${esc(x.time || '')}</span>${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}<span class="tt">${esc(x.title)}</span></li>`
}

function day(d) {
  const n = dayDiff(S.today, d.date)
  const wd = new Date(`${d.date}T12:00:00`).getDay()
  const rel = n === 0 ? '오늘' : n === 1 ? '내일' : ''
  const due = d.items.filter((x) => /마감/.test(x.tag)).length
  return `<section class="day ${n === 0 ? 'today' : ''} ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">
    <div class="dh"><b>${esc(d.label)}</b>${rel ? `<span class="rel">${rel}</span>` : ''}${due ? `<span class="dc">마감 ${due}</span>` : ''}</div>
    ${d.items.length ? `<ul>${d.items.map(item).join('')}</ul>` : '<p class="empty">일정 없음</p>'}
  </section>`
}

function render() {
  const b = S.board
  const head = `<div class="hd">
      <span class="ti">📅 앞으로 7일</span>
      <span class="sub">${b ? esc(b.range) : ''}</span>
      <button class="ib" data-act="refresh" title="지금 새로고침" ${S.refreshing ? 'disabled' : ''}>${icon('refresh-cw', 13, S.refreshing ? 'spin' : '')}</button>
      <button class="ib" data-act="settings" title="설정">${icon('settings', 13)}</button>
    </div>`
  const edit = S.widgetMode === 'edit' ? `<div class="edit-bar">${icon('move', 14)}<span>드래그해서 옮기세요</span><button data-act="pin">${icon('pin', 12)} 고정</button></div>` : ''
  let body
  if (!b) {
    body = `<div class="setup"><p>${S.hasToken ? esc(S.boardError || '보드를 읽는 중이에요…') : 'Notion 을 연결하면 Command Center 의 <b>앞으로 7일</b> 보드가 여기에 떠요.'}</p>
      <button class="btn" data-act="settings">${S.hasToken ? '설정 열기' : 'Notion 연결하기'}</button></div>`
  } else {
    // 보드가 아침에 갱신되기 전이면 지난 날짜가 남아 있다 → 오늘부터만
    const days = b.days.filter((d) => d.date >= S.today)
    const stale = b.days.length && b.days[0].date < S.today
    body = `<div class="days" data-act="open" title="눌러서 Notion 에서 열기">${days.length ? days.map(day).join('') : '<p class="empty">보드에 오늘 이후 날짜가 없어요</p>'}</div>
      <div class="ft"><span>${stale ? 'Notion 보드가 아직 오늘로 갱신 전 · ' : ''}${S.boardError ? `⚠ ${esc(S.boardError)} · ` : ''}${esc(ago(b.fetchedAt))} 읽음</span>
      <button class="lk" data-act="open">${icon('external-link', 12)} Notion 에서 열기</button></div>`
  }
  root.innerHTML = `${edit}<article class="card board">${head}${body}</article>`
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]')
  if (!el || el.disabled) return
  const act = el.dataset.act
  if (S?.widgetMode === 'edit' && act === 'open') return // 옮기는 중에는 열지 않는다
  if (act === 'open') return nf.openNotion()
  if (act === 'refresh') return nf.refresh()
  if (act === 'settings') return nf.openSettings()
  if (act === 'pin') return nf.setWidgetMode('pinned')
})

nf.onChange(refresh)
refresh()
setInterval(refresh, 60 * 1000) // 자정이 지나면 '오늘' 표시가 바뀌게
new ResizeObserver(() => nf.resizeWidget(document.getElementById('wrap').getBoundingClientRect().height)).observe(document.getElementById('wrap'))
