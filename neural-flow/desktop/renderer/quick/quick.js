// 빠른 입력: Enter → 미리보기, 다시 Enter → 추가, Esc → 닫기
const A = NFAgenda
const { esc } = UI
const $q = document.getElementById('q')
const $body = document.getElementById('body')
document.getElementById('spark').innerHTML = icon('plus', 24)

const KIND = {
  event: ['calendar-plus', '일정'],
  task: ['list-todo', '할 일'],
  one_thing: ['target', '오늘의 단 하나'],
  note: ['sticky-note', '메모'],
}
const EXAMPLES = ['내일 오후 3시 커피챗', '금요일 7시 반 스터디 2시간', '!자소서 1문항 끝내기', '포트폴리오 케이스 정리', '메모: 위젯 아이디어']
let S = null
let item = null
let busy = false

function hints() {
  $body.innerHTML = `<div class="hint">${EXAMPLES.map((x) => `<button class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div class="foot"><span><kbd>Enter</kbd>확인 <kbd>Enter</kbd>추가</span><span><kbd>Esc</kbd>닫기</span></div>`
}

function preview() {
  const [ic, label] = KIND[item.kind] || KIND.task
  const when = item.date ? `${A.formatKoreanDate(item.date)}${item.start ? ` ${item.start}` : item.kind === 'event' ? ' 종일' : ''}` : ''
  const where = { event: S?.account ? '구글 캘린더' : '앱 일정', task: '활동 보드', one_thing: '오늘의 단 하나', note: '메모' }[item.kind]
  $body.innerHTML = `<div class="card"><span class="kind">${icon(ic, 22)}</span>
    <div class="what"><b>${esc(item.title)}</b><span>${esc([label, when, item.minutes ? `${item.minutes}분` : '', `→ ${where}`].filter(Boolean).join(' · '))}</span></div></div>
    <div class="foot"><span><kbd>Enter</kbd>추가 · 고치려면 계속 입력</span><span>${item.source && item.source !== 'rules' ? 'AI 해석' : '규칙 해석'}</span></div>`

}



async function submit() {
  const text = $q.value.trim()
  if (!text || busy) return
  if (item && item._text === text) {
    busy = true
    const r = await nf.commitInput(item)
    busy = false
    $body.innerHTML = `<div class="done">✓ ${esc(r?.message || '추가했어요')}</div>`
    item = null
    $q.value = ''
    setTimeout(() => {
      nf.hideQuick()
      hints()
    }, 900)
    return
  }
  busy = true
  $body.innerHTML = `<div class="msg">해석하는 중…</div>`
  try {
    item = { ...(await nf.previewInput(text)), _text: text }
    preview()
  } catch (e) {
    $body.innerHTML = `<div class="msg">${esc(e.message)}</div>`
  }
  busy = false
}

document.getElementById('bar').addEventListener('submit', (e) => {
  e.preventDefault()
  submit()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    item = null
    $q.value = ''
    hints()
    nf.hideQuick()
  }
})
$q.addEventListener('input', () => {
  if (item && $q.value.trim() !== item._text) {
    item = null
    hints()
  }
})
$body.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-ex]')
  if (ex) {
    $q.value = ex.dataset.ex
    $q.focus()
    submit()
  }
  if (e.target.closest('[data-open]')) {
    nf.open('today')
    nf.hideQuick()
  }
})

async function refresh() {
  S = await nf.snapshot()
  if (S.locked) {
    $q.disabled = true
    $body.innerHTML = `<div class="msg">🔒 로그인이 필요해요<br><button data-open>neural-flow 열기</button></div>`
  } else {
    $q.disabled = false
    if (!item && !$body.innerHTML.includes('done')) hints()
    $q.focus()
  }
}
nf.onNavigate(() => {
  $q.focus()
  $q.select()
})
nf.onChange(() => S && S.locked && refresh())
refresh()
