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
  $body.innerHTML = NFInputReview.render(item, S?.account) + `<button class="chip" data-save-input>확인한 내용 저장</button>
    <div class="foot"><span>내용을 수정한 뒤 저장하세요</span><span><kbd>Esc</kbd>닫기</span></div>`
}

async function submit() {
  const shown = $q.value.trim()
  const text = pasted && shown.startsWith('📄') ? pasted : shown
  if (!text || busy) return
  nf.setInputActive?.(true).catch(() => {})
  if (item && item._text === text) {
    busy = true
    NFInputReview.read($body, item)
    let r
    try { r = await nf.commitInput(item) }
    catch (e) { r = { ok: false, message: e.message } }
    busy = false
    if (!r?.ok) {
      if (r?.remaining?.length) item = { ...item, kind: 'batch', items: r.remaining }
      preview()
      $body.insertAdjacentHTML('afterbegin', `<p role="alert">${esc(r?.message || '저장하지 못했어요')}</p>`)
      return
    }
    $body.innerHTML = `<div class="done">✓ ${esc(r.message)}</div>`
    item = null
    pasted = null
    $q.value = ''
    nf.setInputActive?.(false).catch(() => {})
    setTimeout(() => {
      nf.hideQuick()
      hints()
    }, 900)
    return
  }
  busy = true
  $body.innerHTML = `<div class="msg">${text === pasted ? '일정 정보를 읽는 중…' : '해석하는 중…'}</div>`
  try {
    const result = await nf.previewInput(text)
    if (!result) throw new Error('해석을 완료하지 못했어요. 다시 시도해 주세요')
    item = { ...result, _text: text }
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
    pasted = null
    nf.setInputActive?.(false).catch(() => {})
    nf.hideQuick()
  }
})
$q.addEventListener('input', () => {
  nf.setInputActive?.(!!$q.value.trim()).catch(() => {})
  if (!$q.value.trim().startsWith('📄')) pasted = null
  if (!item && !$q.value.trim()) hints()
  if (item && $q.value.trim() !== item._text && item._text !== pasted) {
    item = null
    hints()
  }
})
// 여러 줄 공문을 붙여넣으면 한 줄 입력창 대신 원문 전체로 해석한다
let pasted = null
$q.addEventListener('paste', (e) => {
  const t = e.clipboardData?.getData('text') || ''
  if (!/\n/.test(t.trim())) return
  e.preventDefault()
  nf.setInputActive?.(true).catch(() => {})
  pasted = t
  $q.value = `📄 ${t.trim().split(/\r?\n/)[0].slice(0, 40)}… (공문 ${t.trim().split(/\r?\n/).length}줄)`
  item = null
  submit()
})

$body.addEventListener('click', (e) => {
  if (e.target.closest('[data-save-input]')) return submit()
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
