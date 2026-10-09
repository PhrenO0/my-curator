// Shared validation and editable preview for both input windows.
;(function (root) {
  const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
  const validTime = (v) => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)
  function issues(item) {
    if (!item || !['event', 'task', 'note', 'one_thing'].includes(item.kind)) return ['일정 형식을 확인해 주세요']
    const out = []
    if (!String(item.title || '').trim()) out.push('제목을 입력해 주세요')
    if (item.kind === 'event' && !validDate(item.date)) out.push('날짜를 확인해 주세요')
    if (item.start && !validTime(item.start)) out.push('시작 시각을 확인해 주세요')
    if (item.end && (!validTime(item.end) || !item.start)) out.push('시작·종료 시각을 확인해 주세요')
    if (item.minutes != null && (!Number.isFinite(Number(item.minutes)) || Number(item.minutes) <= 0 || Number(item.minutes) > 1440)) out.push('기간을 확인해 주세요')
    return out
  }
  async function commitBatch(batch, save) {
    if (!Array.isArray(batch.items) || !batch.items.length || batch.items.length > 20) return { ok: false, message: '1~20개 일정을 확인해 주세요' }
    const errors = batch.items.flatMap((x, i) => issues(x).map((e) => `${i + 1}번: ${e}`))
    if (errors.length) return { ok: false, message: errors.join(' · ') }
    const remaining = []
    let saved = 0
    for (const item of batch.items) {
      try {
        const result = await save(item)
        if (result?.ok) saved++
        else remaining.push({ ...item, saveError: result?.message || '저장하지 못했어요' })
      } catch (e) { remaining.push({ ...item, saveError: e.message }) }
    }
    return { ok: !remaining.length, saved, remaining, message: remaining.length ? `${saved}개 저장 · ${remaining.length}개는 확인 후 다시 저장해 주세요` : `${saved}개 일정을 저장했어요` }
  }
  function render(item, account) {
    const esc = root.UI.esc
    const items = item.kind === 'batch' ? item.items : [item]
    return `${item.error ? `<p role="status">${esc(item.error)}</p>` : ''}<div class="input-review">
      ${item.coaching ? `<section><b>입력 조언</b><p>${esc(item.coaching)}</p></section>` : ''}
      <p>${item.source === 'rules' ? '규칙 해석' : 'AI 해석'} · ${items.length}개 · ${account ? 'Google 캘린더' : '앱에만 저장'}</p>
      ${items.map((x, i) => `<fieldset data-review-index="${i}"><legend>${i + 1}번 입력</legend>
        ${x.saveError ? `<p role="alert">${esc(x.saveError)}</p>` : ''}
        ${(x.warnings || []).map((v) => `<p>${esc(v)}</p>`).join('')}
        <label>종류<select data-review-field="kind">${[['event','일정'],['task','할 일'],['note','메모'],['one_thing','직접 정한 할 일']].map(([v,t])=>`<option value="${v}" ${x.kind===v?'selected':''}>${t}</option>`).join('')}</select></label>
        ${[['title','제목','text'],['date','날짜','date'],['start','시작','time'],['end','종료','time'],['minutes','기간(분)','number'],['location','장소','text'],['link','링크','url']].map(([k,t,type])=>`<label>${t}<input type="${type}" data-review-field="${k}" value="${esc(x[k] ?? '')}" /></label>`).join('')}
        <label>반복<select data-review-field="repeat">${[['','반복 없음'],['daily','매일'],['weekdays','평일'],['weekly','매주'],['monthly','매월']].map(([v,t])=>`<option value="${v}" ${x.repeat===v?'selected':''}>${t}</option>`).join('')}</select></label>
        <label>핵심 안내<textarea data-review-field="summary">${esc(x.summary || '')}</textarea></label>
        <label>원문·메모<textarea data-review-field="note">${esc(x.note || '')}</textarea></label>
        <p>시간을 비워 두면 종일 일정으로 저장돼요. 종료·기간이 없으면 1시간으로 저장돼요.</p>
      </fieldset>`).join('')}</div>`
  }
  function read(container, item) {
    const items = item.kind === 'batch' ? item.items : [item]
    for (const field of container.querySelectorAll('[data-review-index]')) {
      const target = items[Number(field.dataset.reviewIndex)]
      for (const input of field.querySelectorAll('[data-review-field]')) {
        const k = input.dataset.reviewField
        target[k] = k === 'minutes' ? input.value ? Number(input.value) : null : input.value || (['date','start','end'].includes(k) ? null : '')
      }
    }
    return item
  }
  const api = { validDate, validTime, issues, commitBatch, render, read }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.NFInputReview = api
})(typeof self === 'undefined' ? globalThis : self)
