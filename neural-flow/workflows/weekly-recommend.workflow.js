// neural-flow — 주간 추천 워크플로우 (선택/고급)
//
// 실행: MCP(Notion + Google Calendar)가 연결된 Claude Code 세션에서 Workflow 도구로 호출.
//   Workflow({ scriptPath: "neural-flow/workflows/weekly-recommend.workflow.js" })
//
// 동작: 6대 영역별로 후보 활동을 병렬 생성 → '기능 다이어트' 신디사이저가 이번 주 핵심을 선별 →
//   구조화된 추천 JSON을 반환한다. 캘린더/노션에 실제로 쓰는 일은 메인 세션이 승인 후 수행한다.
//
// 주의: 이 스크립트는 '추천 생성'까지만 한다. 캘린더 시간 점유는 반드시 사용자 승인 게이트를 거친다.

export const meta = {
  name: 'neural-flow-weekly-recommend',
  description: '준상의 6대 영역에서 이번 주 활동을 추천하고 기능 다이어트로 핵심을 선별',
  phases: [
    { title: 'Generate', detail: '영역별 후보 활동 병렬 생성' },
    { title: 'Synthesize', detail: '기능 다이어트 — 주간 핵심 선별' },
  ],
}

const DOMAINS = [
  { key: '💼 커리어·취업', hint: '자소서·포트폴리오·지원·커피챗. 마감 임박 최우선.' },
  { key: '🚀 창업·경제자유', hint: '사이드프로젝트·수익화·투자·시장리서치. North Star 증명.' },
  { key: '✝️ 영성·거룩', hint: '기도·말씀·죄끊기·예배. 거룩=집중의 엔진. 진지하게.' },
  { key: '🫀 건강(신체·정신)', hint: '운동·수면·식사·정서안정·도파민디톡스. 몸의 순환.' },
  { key: '🧠 성장·집중력', hint: '학습·독서·딥워크·회고. 약한 툴(GA4·Amplitude) 보완.' },
  { key: '🔁 생활루틴', hint: '아침/저녁 루틴·정리정돈. 리듬감.' },
]

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          활동명: { type: 'string' },
          세부분류: { type: 'array', items: { type: 'string' } },
          우선순위: { type: 'string', enum: ['높음', '중간', '낮음'] },
          에너지: { type: 'string', enum: ['딥워크(베타파)', '가벼움(알파파)', '루틴'] },
          반복: { type: 'string', enum: ['1회', '매일', '평일', '매주'] },
          예상시간: { type: 'number' },
          왜: { type: 'string' },
        },
        required: ['활동명', '우선순위', '왜'],
      },
    },
  },
  required: ['items'],
}

const CONTEXT = `준상(junsang): 이상적인 삶 = "거룩의 상태 = 집중의 상태". 신앙이 삶의 엔진.
North Star = AI 그로스 콘텐츠 설계자(메시지×시장분석×AI). 약점 = 아이디어 과확장(→줄여라).
이번 주 고정: 캠프 평일 09-18(~6/29), 6/28 촬영, 크리엠 자소서 6/30 마감.`

phase('Generate')
const perDomain = await parallel(
  DOMAINS.map((d) => () =>
    agent(
      `${CONTEXT}\n\n영역 "${d.key}" (${d.hint})에서 이번 주 활동 2~3개를 제안하라.
각 활동에 세부분류·우선순위·에너지·반복·예상시간(분)·왜(비전연결)를 붙여라. 과확장 금지.`,
      { label: `gen:${d.key}`, phase: 'Generate', schema: ITEM_SCHEMA }
    ).then((r) => ({ domain: d.key, items: (r && r.items) || [] }))
  )
)

phase('Synthesize')
const allItems = perDomain.filter(Boolean).flatMap((r) =>
  r.items.map((it) => ({ ...it, 영역: r.domain }))
)

const WEEK_SCHEMA = {
  type: 'object',
  properties: {
    오늘의_단_하나: { type: 'string' },
    이번주_핵심3: { type: 'array', items: { type: 'string' } },
    백로그: { type: 'array', items: { type: 'object' } },
    한줄_코칭: { type: 'string' },
  },
  required: ['오늘의_단_하나', '이번주_핵심3'],
}

const week = await agent(
  `${CONTEXT}\n\n아래 후보 활동들에 '기능 다이어트'를 적용하라. 모두 백로그로 두되,
이번 주 핵심 3개와 오늘의 단 하나(1개)를 못 박아라. 마감 임박 > 고가치 > 영성 순.
후보: ${JSON.stringify(allItems)}`,
  { label: 'synthesize', phase: 'Synthesize', schema: WEEK_SCHEMA }
)

return { 후보: allItems, 선별: week }
