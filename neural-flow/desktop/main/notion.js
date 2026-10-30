// Notion Command Center 의 "📅 앞으로 7일" 보드를 읽는다 (읽기 전용).
//
//   페이지 맨 위 블록들 중 '앞으로 7일' 제목 → 그 아래 첫 콜아웃 → 콜아웃 안의 글머리 목록
//   - <b>10.30 금</b>　11:00 [마감] 모두의창업 웹사이트 1차 제작 · 15:00 활동보고서 작성
//
// 보드는 Notion 쪽에서 매일 아침 갱신된다. 앱은 주기적으로 다시 읽기만 한다.

const API = process.env.NF_NOTION_API || 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'
const DEFAULT_PAGE = 'https://www.notion.so/3d8b9019035781acb237e2d609a7f276' // 🧭 Command Center

// URL·ID 어느 쪽이든 32자리 ID 로 (하이픈 없이)
function pageIdOf(input) {
  const s = String(input || '').trim()
  const m = /([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})(?![0-9a-f])/i.exec(s.split('?')[0].split('#')[0])
  return m ? m.slice(1).join('').toLowerCase() : ''
}

const plain = (rich) => (Array.isArray(rich) ? rich.map((r) => r?.plain_text ?? r?.text?.content ?? '').join('') : '')
const textOf = (block) => plain(block?.[block?.type]?.rich_text)

async function children(id, { token, fetchImpl = fetch, max = 300 } = {}) {
  const out = []
  let cursor = ''
  while (out.length < max) {
    const url = `${API}/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION } })
    if (!res.ok) {
      let msg = ''
      try {
        msg = (await res.json())?.message || ''
      } catch {}
      const e = new Error(
        res.status === 401
          ? 'Notion 토큰이 맞지 않아요 — 설정에서 다시 넣어 주세요'
          : res.status === 404
            ? 'Command Center 페이지를 못 찾았어요 — 페이지 ⋯ → 연결에 이 통합을 추가했는지 확인해 주세요'
            : `Notion 응답 오류 ${res.status}${msg ? `: ${msg}` : ''}`
      )
      e.status = res.status
      throw e
    }
    const j = await res.json()
    out.push(...(j.results || []))
    if (!j.has_more || !j.next_cursor) break
    cursor = j.next_cursor
  }
  return out
}

// "10.30" → 오늘에서 가장 가까운 해의 YYYY-MM-DD
function dateOf(md, today) {
  const m = /^(\d{1,2})\.(\d{1,2})$/.exec(md)
  if (!m) return null
  const y = Number(today.slice(0, 4))
  const t = Date.parse(today)
  let best = null
  for (const yy of [y - 1, y, y + 1]) {
    const d = `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
    if (Number.isNaN(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) continue
    if (!best || Math.abs(Date.parse(d) - t) < Math.abs(Date.parse(best) - t)) best = d
  }
  return best
}

// "11:00 [마감] 제목 · 15:00 제목2 · 종일 제목3" → [{ time, tag, title }]
function parseItems(rest) {
  const items = []
  for (const seg of String(rest || '').split(/\s+·\s+/)) {
    const s = seg.trim()
    if (!s) continue
    const m = /^(\d{1,2}:\d{2}|종일)\s+(.*)$/.exec(s)
    if (!m) {
      // 시각 없이 이어지는 조각은 앞 일정 제목의 일부 (제목 안의 " · ")
      if (items.length) items[items.length - 1].title += ` · ${s}`
      else items.push({ time: '', tag: '', title: s })
      continue
    }
    const tagM = /^\[([^\]]{1,8})\]\s*(.*)$/.exec(m[2])
    items.push({ time: m[1] === '종일' ? '종일' : m[1].padStart(5, '0'), tag: tagM ? tagM[1] : '', title: (tagM ? tagM[2] : m[2]).trim() })
  }
  return items
}

// 글머리 한 줄 → { date, label, items }
function parseDay(line, today) {
  const m = /^\s*(\d{1,2}\.\d{1,2})\s*([월화수목금토일])?[\s　]*(.*)$/.exec(line)
  if (!m) return null
  const date = dateOf(m[1], today)
  if (!date) return null
  return { date, label: `${m[1]}${m[2] ? ` ${m[2]}` : ''}`, items: parseItems(m[3]) }
}

// 블록 목록에서 보드 콜아웃 찾기: '앞으로 7일' 제목 뒤의 첫 콜아웃
function findBoard(blocks) {
  const i = blocks.findIndex((b) => /^heading_[123]$/.test(b.type) && /앞으로\s*7\s*일/.test(textOf(b)))
  if (i >= 0) {
    for (const b of blocks.slice(i + 1, i + 6)) {
      if (b.type === 'callout') return b
      if (/^heading_[123]$/.test(b.type)) break
    }
  }
  return blocks.find((b) => b.type === 'callout' && /\d{1,2}\.\d{1,2}\s*[월화수목금토일]?\s*[–-]\s*\d{1,2}\.\d{1,2}/.test(textOf(b))) || null
}

async function fetchBoard({ token, page = DEFAULT_PAGE, today, fetchImpl = fetch } = {}) {
  if (!token) return { ok: false, message: '설정에서 Notion 토큰을 넣어 주세요' }
  const pageId = pageIdOf(page)
  if (!pageId) return { ok: false, message: 'Command Center 페이지 주소가 올바르지 않아요' }
  try {
    const top = await children(pageId, { token, fetchImpl })
    const board = findBoard(top)
    if (!board) return { ok: false, message: "페이지에서 '📅 앞으로 7일' 보드를 못 찾았어요" }
    const inner = board.has_children ? await children(board.id, { token, fetchImpl }) : []
    const days = []
    for (const b of inner) {
      if (b.type !== 'bulleted_list_item') continue
      const d = parseDay(textOf(b), today)
      if (d && !days.some((x) => x.date === d.date)) days.push(d)
    }
    if (!days.length) return { ok: false, message: '보드에 날짜 줄이 없어요' }
    days.sort((a, b) => a.date.localeCompare(b.date))
    const head = textOf(board).replace(/\s+/g, ' ').trim()
    return {
      ok: true,
      board: {
        pageId,
        blockId: String(board.id || '').replace(/-/g, ''),
        range: (/^[^·]+/.exec(head) || [''])[0].trim(),
        note: head.includes('·') ? head.slice(head.indexOf('·') + 1).trim() : '',
        days,
        fetchedAt: new Date().toISOString(),
        editedAt: board.last_edited_time || null,
      },
    }
  } catch (e) {
    return { ok: false, message: e.status ? e.message : `Notion 에 연결하지 못했어요: ${e.message}` }
  }
}

// 누르면 열 주소 — 앱: notion:// (Notion 데스크톱 앱), 웹: https
function openUrls(board, page = DEFAULT_PAGE) {
  const id = board?.pageId || pageIdOf(page)
  const anchor = board?.blockId ? `#${board.blockId}` : ''
  return { app: `notion://www.notion.so/${id}${anchor}`, web: `https://www.notion.so/${id}${anchor}` }
}

module.exports = { fetchBoard, parseDay, parseItems, findBoard, pageIdOf, dateOf, openUrls, DEFAULT_PAGE }
