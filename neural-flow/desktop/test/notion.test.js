// Notion "앞으로 7일" 보드 읽기 단위 테스트 (node --test). 실제 Notion 은 부르지 않는다.
const test = require('node:test')
const assert = require('node:assert/strict')
const notion = require('../main/notion.js')

const today = '2026-10-30'
const rt = (...parts) => parts.map((t) => ({ plain_text: t }))
const bullet = (...parts) => ({ type: 'bulleted_list_item', has_children: false, bulleted_list_item: { rich_text: rt(...parts) } })

// 실제 Command Center 구조 (2026-10-30 기준)
const PAGE = [
  { id: 'p1', type: 'paragraph', paragraph: { rich_text: rt('적고, 돌아보고, 쌓는다') } },
  { id: 'c1', type: 'column_list', has_children: true, column_list: {} },
  { id: 'h1', type: 'heading_3', heading_3: { rich_text: rt('✍️ 오늘') } },
  { id: 'h7', type: 'heading_3', heading_3: { rich_text: rt('📅 앞으로 7일') } },
  { id: 'aaaa-bbbb', type: 'callout', has_children: true, last_edited_time: '2026-10-29T22:00:00.000Z', callout: { rich_text: rt('10.30 금 – 11.05 목', ' · 정규 수업 제외 · 매일 아침 자동 갱신') } },
  { id: 'h8', type: 'heading_3', heading_3: { rich_text: rt('🏆 성취 아카이브') } },
]
const BOARD = [
  bullet('10.30 금', "　11:00 [마감] 모두의창업 웹사이트 1차 제작 · 15:00 '우리함께' 10월 활동보고서 작성 · 18:00 2차 정산금 입금 확인"),
  bullet('10.31 토', '　09:00 AI_TOP_100 예선 입장·사전준비 · 10:00 [필수] AI_TOP_100 예선'),
  bullet('11.01 일', '　08:00 모창 ai 사용 · 23:59 [마감] 국민대 캠타 CRE-AI-TIVE 참가 신청'),
  bullet('11.02 월', '　19:00 지속가능도시론 2차 퀴즈 준비 · 21:00 [마감] 도시빅데이터분석 프로젝트 제안서 · 종일 도시빅데이터분석 기획안'),
  bullet('11.03 화', '　종일 영캠 모임'),
  { type: 'paragraph', paragraph: { rich_text: rt('과제안내: 대중교통현장관찰조사 …') } },
  bullet('11.05 목', '　13:30 도빅분 프로젝트 중간 체크인(예정) · 종일 예비군'),
  bullet('중간고사 피드백'),
]

function fakeFetch(map, calls = []) {
  return async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization, ver: opts.headers['Notion-Version'] })
    const id = /blocks\/([^/]+)\/children/.exec(url)[1]
    if (!map[id]) return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    return { ok: true, status: 200, json: async () => ({ results: map[id], has_more: false }) }
  }
}

test('페이지 주소·ID → 32자리 ID', () => {
  assert.equal(notion.pageIdOf('https://app.notion.com/p/3d8b9019035781acb237e2d609a7f276?pvs=204'), '3d8b9019035781acb237e2d609a7f276')
  assert.equal(notion.pageIdOf('https://www.notion.so/Command-Center-3d8b9019035781acb237e2d609a7f276#abc'), '3d8b9019035781acb237e2d609a7f276')
  assert.equal(notion.pageIdOf('3d8b9019-0357-81ac-b237-e2d609a7f276'), '3d8b9019035781acb237e2d609a7f276')
  assert.equal(notion.pageIdOf('https://example.com'), '')
})

test('한 줄 파싱: 시각·[마감]/[필수] 태그·종일·제목 안의 가운뎃점', () => {
  const d = notion.parseDay("10.30 금　11:00 [마감] 모두의창업 웹사이트 1차 제작 · 15:00 '우리함께' 활동보고서", today)
  assert.equal(d.date, '2026-10-30')
  assert.equal(d.label, '10.30 금')
  assert.deepEqual(d.items, [
    { time: '11:00', tag: '마감', title: '모두의창업 웹사이트 1차 제작' },
    { time: '15:00', tag: '', title: "'우리함께' 활동보고서" },
  ])
  assert.deepEqual(notion.parseItems('9:00 회의 · 메모 · 종일 영캠'), [
    { time: '09:00', tag: '', title: '회의 · 메모' },
    { time: '종일', tag: '', title: '영캠' },
  ])
  assert.equal(notion.parseDay('중간고사 피드백', today), null)
  // 연말 → 새해 날짜는 내년으로
  assert.equal(notion.dateOf('1.02', '2026-12-30'), '2027-01-02')
  assert.equal(notion.dateOf('2.30', today), null)
})

test('보드 읽기: 제목 뒤 콜아웃 → 날짜 줄만, 토큰은 헤더로만', async () => {
  const calls = []
  const r = await notion.fetchBoard({ token: 'ntn_x', page: 'https://www.notion.so/3d8b9019035781acb237e2d609a7f276', today, fetchImpl: fakeFetch({ '3d8b9019035781acb237e2d609a7f276': PAGE, 'aaaa-bbbb': BOARD }, calls) })
  assert.ok(r.ok, r.message)
  assert.equal(r.board.range, '10.30 금 – 11.05 목')
  assert.equal(r.board.note, '정규 수업 제외 · 매일 아침 자동 갱신')
  assert.equal(r.board.blockId, 'aaaabbbb')
  assert.deepEqual(r.board.days.map((d) => d.date), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05'])
  assert.equal(r.board.days[1].items[1].tag, '필수')
  assert.deepEqual(r.board.days[3].items.map((x) => x.time), ['19:00', '21:00', '종일'])
  assert.ok(calls.every((c) => c.auth === 'Bearer ntn_x' && c.ver === '2022-06-28' && !c.url.includes('ntn_x')))
  assert.deepEqual(notion.openUrls(r.board), { app: 'notion://www.notion.so/3d8b9019035781acb237e2d609a7f276#aaaabbbb', web: 'https://www.notion.so/3d8b9019035781acb237e2d609a7f276#aaaabbbb' })
})

test('오류: 토큰 없음 · 401 · 404(연결 안 됨) · 보드 없음', async () => {
  assert.match((await notion.fetchBoard({ token: '', today })).message, /토큰/)
  const f401 = async () => ({ ok: false, status: 401, json: async () => ({}) })
  assert.match((await notion.fetchBoard({ token: 't', today, fetchImpl: f401 })).message, /토큰이 맞지 않/)
  assert.match((await notion.fetchBoard({ token: 't', today, fetchImpl: fakeFetch({}) })).message, /연결/)
  const noBoard = fakeFetch({ '3d8b9019035781acb237e2d609a7f276': PAGE.slice(0, 3) })
  assert.match((await notion.fetchBoard({ token: 't', today, fetchImpl: noBoard })).message, /앞으로 7일/)
  const boom = async () => {
    throw new Error('ENOTFOUND')
  }
  assert.match((await notion.fetchBoard({ token: 't', today, fetchImpl: boom })).message, /연결하지 못했어요: ENOTFOUND/)
})

test('여러 쪽으로 나뉜 응답도 끝까지 읽음', async () => {
  let n = 0
  const paged = async (url) => {
    n++
    const id = /blocks\/([^/]+)\/children/.exec(url)[1]
    if (id === 'aaaa-bbbb') return { ok: true, json: async () => ({ results: BOARD, has_more: false }) }
    return url.includes('start_cursor=c2')
      ? { ok: true, json: async () => ({ results: PAGE.slice(3), has_more: false }) }
      : { ok: true, json: async () => ({ results: PAGE.slice(0, 3), has_more: true, next_cursor: 'c2' }) }
  }
  const r = await notion.fetchBoard({ token: 't', today, fetchImpl: paged })
  assert.ok(r.ok)
  assert.equal(n, 3)
})
