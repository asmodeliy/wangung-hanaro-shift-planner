import { useMemo, useState } from 'react'

type AttendanceRow = {
  employeeId: number | null
  employeeName: string
  date: string
  scheduledCode: 'open' | 'close' | 'full' | 'off' | null
  expectedStart: string | null
  expectedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  status: string
  overtimeMinutes: number
  severity: 'ok' | 'info' | 'warning' | 'critical'
}
type OvertimeRow = { employeeId: number | null; employeeName: string; date: string; scheduledCode: AttendanceRow['scheduledCode']; expectedEnd: string | null; actualEnd: string | null; minutes: number }
type AttendanceResult = {
  from: string
  to: string
  importedRows: number
  overtimeThresholdMinutes: number
  counts: { compared: number; normal: number; needsReview: number; inProgress: number; unexpectedWork: number; unmatched: number; overtime: number; overtimeMinutes: number }
  rows: AttendanceRow[]
  overtime: OvertimeRow[]
  unmatched: { name: string; date: string; checkIn: string | null; checkOut: string | null; reason: string }[]
}

const shiftNames: Record<NonNullable<AttendanceRow['scheduledCode']>, string> = { open: '오픈', close: '마감', full: '종일', off: '휴무' }
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })

export function AttendancePage() {
  const [file, setFile] = useState<File | null>(null)
  const [graceMinutes, setGraceMinutes] = useState(5)
  const [overtimeThresholdMinutes, setOvertimeThresholdMinutes] = useState(30)
  const [result, setResult] = useState<AttendanceResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'review'>('all')
  const [dateFilter, setDateFilter] = useState('all')

  const dates = useMemo(() => [...new Set(result?.rows.map(row => row.date) ?? [])], [result])
  const visibleRows = useMemo(() => (result?.rows ?? []).filter(row =>
    (filter === 'all' || ['warning', 'critical'].includes(row.severity) || (row.overtimeMinutes > 0 && row.overtimeMinutes >= (result?.overtimeThresholdMinutes ?? 30)))
    && (dateFilter === 'all' || row.date === dateFilter),
  ), [result, filter, dateFilter])

  const chooseFile = (next: File | null) => {
    setError('')
    setResult(null)
    setDateFilter('all')
    if (!next) { setFile(null); return }
    if (!/\.xlsx?$/i.test(next.name)) { setFile(null); setError('.xls 또는 .xlsx 근태등록 파일을 선택해 주세요.'); return }
    if (next.size > 10 * 1024 * 1024) { setFile(null); setError('파일은 10MB 이하만 올릴 수 있습니다.'); return }
    setFile(next)
  }

  const compare = async () => {
    if (!file || busy) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch(`/api/attendance/compare?graceMinutes=${graceMinutes}&overtimeThresholdMinutes=${overtimeThresholdMinutes}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      const body = await response.json().catch(() => null) as AttendanceResult | { error?: string } | null
      if (!response.ok) throw new Error(body && 'error' in body && body.error ? body.error : `근태 비교에 실패했습니다. (${response.status})`)
      setResult(body as AttendanceResult)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '근태 비교 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const downloadOvertimeSheet = async () => {
    if (!result?.overtime.length) return
    const XLSX = await import('@e965/xlsx')
    const rows: (string | number)[][] = [
      ['시간외 근무 확인표'],
      [`기간: ${result.from} ~ ${result.to}`],
      [`작성 기준: 예정 퇴근 이후 ${result.overtimeThresholdMinutes}분 이상 (기준 미만 제외, 초과 시간은 분 단위로 기록)`],
      [],
      ['날짜', '직원명', '예정 근무', '예정 퇴근', '실제 퇴근', '초과근무(분)', '확인·비고'],
      ...result.overtime.map(row => [row.date, row.employeeName, row.scheduledCode ? shiftNames[row.scheduledCode] : '근무표 없음', row.expectedEnd ?? '', row.actualEnd ?? '', row.minutes, '']),
      [],
      ['합계', '', '', '', '', result.counts.overtimeMinutes, '확인 후 결재'],
    ]
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }]
    sheet['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 24 }]
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, '시간외근무')
    XLSX.writeFile(book, `시간외근무표_${result.from}_${result.to}.xlsx`)
  }

  return <>
    <header className="page-head">
      <div><h1>근태 모니터링</h1><p>지문 근태등록 파일을 근무표와 비교해 출근·퇴근 상태와 확인할 항목을 살펴봅니다.</p></div>
    </header>

    <section className="panel pad attendance-upload">
      <div className="section-head"><div><h2>근태 파일 비교</h2><p className="muted small">구형 엑셀 .xls와 .xlsx를 지원합니다. 파일은 비교 처리 후 저장하지 않습니다.</p></div></div>
      <div className="attendance-controls">
        <label className="field attendance-file">근태등록 엑셀 파일
          <input type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => chooseFile(event.currentTarget.files?.[0] ?? null)}/>
        </label>
        <label className="field attendance-grace">지각·조기퇴근 허용
          <span className="unit"><input type="number" min={0} max={60} value={graceMinutes} onChange={event => setGraceMinutes(Math.max(0, Math.min(60, Number(event.target.value) || 0)))}/>분</span>
        </label>
        <label className="field attendance-overtime-threshold">시간외 근무표 기준
          <span className="unit"><input type="number" min={0} max={240} step={5} value={overtimeThresholdMinutes} onChange={event => setOvertimeThresholdMinutes(Math.max(0, Math.min(240, Number(event.target.value) || 0)))}/>분</span>
        </label>
        <button className="btn btn-primary attendance-submit" type="button" disabled={!file || busy} onClick={() => void compare()}>{busy ? '근무표와 비교 중…' : '근태 비교'}</button>
      </div>
      {file && <div className="attendance-selected"><span><b>{file.name}</b><small>{(file.size / 1024).toFixed(1)}KB</small></span><button type="button" className="btn btn-ghost btn-sm" onClick={() => chooseFile(null)}>파일 변경</button></div>}
      {error && <div className="alert alert-error" role="alert"><p>{error}</p></div>}
      <p className="muted small attendance-note">파일을 올리면 등록된 근무표와 자동 비교합니다. 예정 퇴근보다 기준 이상 늦게 퇴근한 기록은 결과에 표시하고 시간외 근무표 엑셀로 내려받을 수 있습니다. 오늘 출근 기록은 있지만 퇴근 기록이 없으면 ‘근무 중’으로 표시합니다.</p>
    </section>

    {result && <>
      <section className="attendance-summary" aria-label="근태 비교 요약">
        <div className="panel attendance-stat"><span>비교 기간</span><strong>{result.from === result.to ? dateLabel(result.from) : `${result.from} ~ ${result.to}`}</strong><small>엑셀 {result.importedRows}행 · 근무 예정 {result.counts.compared}건</small></div>
        <div className="panel attendance-stat"><span>정상</span><strong>{result.counts.normal}<small>건</small></strong></div>
        <div className={`panel attendance-stat ${result.counts.needsReview ? 'has-warning' : ''}`}><span>확인 필요</span><strong>{result.counts.needsReview}<small>건</small></strong></div>
        <div className="panel attendance-stat"><span>근무 중</span><strong>{result.counts.inProgress}<small>명</small></strong></div>
        <div className={`panel attendance-stat ${result.counts.unexpectedWork ? 'has-warning' : ''}`}><span>예정 외 출근</span><strong>{result.counts.unexpectedWork}<small>건</small></strong></div>
        <div className={`panel attendance-stat ${result.counts.unmatched ? 'has-warning' : ''}`}><span>직원 미매칭</span><strong>{result.counts.unmatched}<small>명</small></strong></div>
        <div className={`panel attendance-stat ${result.counts.overtime ? 'has-warning' : ''}`}><span>시간외 근무</span><strong>{result.counts.overtime}<small>건</small></strong><small>총 {result.counts.overtimeMinutes}분</small></div>
      </section>

      <section className="panel attendance-results">
        <div className="section-head attendance-result-head">
          <div><h2>근태 비교 결과 <span className="count">{visibleRows.length}</span></h2><p className="muted small">근무표가 없는 날짜의 출근도 별도 확인 항목으로 표시합니다.</p></div>
          {result.overtime.length > 0 && <button className="btn btn-primary btn-sm" type="button" onClick={downloadOvertimeSheet}>시간외 근무표 엑셀 다운로드 ({result.overtime.length}건)</button>}
          <div className="attendance-filters">
            <label className="field">결과 보기<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">전체 결과</option><option value="review">확인 필요</option></select></label>
            {dates.length > 1 && <label className="field">날짜<select value={dateFilter} onChange={event => setDateFilter(event.target.value)}><option value="all">전체 기간</option>{dates.map(date => <option key={date} value={date}>{dateLabel(date)}</option>)}</select></label>}
          </div>
        </div>
        {visibleRows.length ? <div className="attendance-table-wrap"><table className="attendance-table">
          <thead><tr><th scope="col">날짜</th><th scope="col">직원</th><th scope="col">근무 예정</th><th scope="col">지문 기록</th><th scope="col">판정</th></tr></thead>
          <tbody>{visibleRows.map((row, index) => <tr key={`${row.date}:${row.employeeId ?? row.employeeName}:${index}`}>
            <td>{dateLabel(row.date)}</td><th scope="row">{row.employeeName}</th>
            <td>{row.scheduledCode ? <><b>{shiftNames[row.scheduledCode]}</b><small>{row.expectedStart && row.expectedEnd ? `${row.expectedStart}–${row.expectedEnd}` : '시간 정보 없음'}</small></> : <span className="muted">근무표 없음</span>}</td>
            <td><span>출근 {row.actualStart ?? '—'}</span><small>퇴근 {row.actualEnd ?? '—'}</small></td>
            <td><span className={`attendance-status status-${row.severity}`}>{row.status}</span></td>
          </tr>)}</tbody>
        </table></div> : <p className="attendance-empty">{filter === 'review' ? '선택한 조건에 확인할 항목이 없습니다.' : '표시할 근태 비교 결과가 없습니다.'}</p>}
      </section>

      {result.unmatched.length > 0 && <section className="panel pad attendance-unmatched">
        <h2>직원 이름 확인 <span className="count">{result.unmatched.length}</span></h2>
        <p className="muted small">근무표 직원과 이름이 일치하지 않는 지문 기록입니다. 직원 이름이 같거나 다른 경우 직원 목록과 원본 파일을 확인해 주세요.</p>
        <ul>{result.unmatched.map((row, index) => <li key={`${row.date}:${row.name}:${index}`}><b>{row.name}</b><span>{dateLabel(row.date)} · 출근 {row.checkIn ?? '—'} · 퇴근 {row.checkOut ?? '—'}</span><small>{row.reason}</small></li>)}</ul>
      </section>}
    </>}
  </>
}
