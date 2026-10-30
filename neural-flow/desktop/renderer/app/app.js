// 설정 창 — Notion 연결 · 위젯 · 업데이트. 토큰은 메인 프로세스에만 있고 화면으로 돌아오지 않는다.
let S = null
const $ = (id) => document.getElementById(id)
const get = (obj, key) => key.split('.').reduce((o, k) => o?.[k], obj)
function toast(msg) {
  $('toast').textContent = msg
  clearTimeout(toast.t)
  toast.t = setTimeout(() => ($('toast').textContent = ''), 4000)
}
function ago(iso) {
  if (!iso) return ''
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`
}

async function refresh() {
  S = await nf.snapshot()
  const b = S.board
  $('conn').className = `status ${S.hasToken && b && !S.boardError ? 'ok' : S.boardError ? 'bad' : ''}`
  $('conn').textContent = !S.hasToken
    ? '아직 연결 안 됨'
    : S.refreshing
      ? '읽는 중…'
      : S.boardError
        ? `⚠ ${S.boardError}`
        : b
          ? `✓ 연결됨 · ${b.range} · ${b.days.length}일 · ${ago(b.fetchedAt)} 읽음`
          : '토큰 저장됨 · 아직 읽지 않음'
  for (const el of document.querySelectorAll('[data-key]')) {
    if (document.activeElement === el) continue
    const v = get(S.settings, el.dataset.key)
    if (el.type === 'checkbox') el.checked = !!v
    else el.value = v ?? ''
  }
  $('page').placeholder = S.settings.notion.defaultPage
  const u = S.update
  $('upd').textContent = `현재 v${S.version}${u.checking ? ' · 확인 중…' : u.available ? ` · 새 버전 ${u.version}${u.downloading != null ? ` 받는 중 ${u.downloading}%` : ''}` : u.error ? ` · 확인 실패: ${u.error}` : ''}`
  $('install').hidden = !u.available
}

function patchOf(key, value) {
  const parts = key.split('.')
  return parts.length === 1 ? { [key]: value } : { [parts[0]]: { [parts[1]]: value } }
}
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-key]')
  if (!el) return
  const v = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value
  await nf.saveSettings(patchOf(el.dataset.key, v))
  toast('저장했어요')
})
$('token-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const v = $('token').value.trim()
  if (!v) return toast('토큰을 붙여넣어 주세요')
  const r = await nf.setToken(v)
  if (r?.ok) $('token').value = ''
  toast(r?.ok ? `연결됐어요 — ${r.days}일 보드를 읽었어요` : r?.message || '연결하지 못했어요')
})
$('clear').addEventListener('click', async () => {
  if (!confirm('저장된 Notion 토큰을 지울까요?')) return
  await nf.setToken('')
  toast('토큰을 지웠어요')
})
$('refresh').addEventListener('click', async () => {
  const r = await nf.refresh()
  toast(r?.ok ? `${r.days}일 보드를 다시 읽었어요` : r?.message || '읽지 못했어요')
})
$('open').addEventListener('click', () => nf.openNotion())
$('move').addEventListener('click', () => nf.setWidgetMode('edit'))
$('check').addEventListener('click', () => nf.checkUpdate())
$('install').addEventListener('click', async () => {
  const r = await nf.installUpdate()
  if (r && !r.ok) toast(r.message)
})
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-link]')
  if (!a) return
  e.preventDefault()
  window.open(a.dataset.link) // 메인이 https 만 외부 브라우저로 연다 (notion.so 만 허용)
})

nf.onChange(refresh)
refresh()
