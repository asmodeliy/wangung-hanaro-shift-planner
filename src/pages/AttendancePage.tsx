import { useEffect, useMemo, useState } from 'react'

type AttendanceRow = {
  employeeId: number | null
  employeeName: string
  date: string
  scheduledCode: 'open' | 'close' | 'full' | 'off' | null
  expectedStart: string | null
  expectedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  actualOvertimeMinutes?: number
  status: string
  overtimeMinutes: number
  severity: 'ok' | 'info' | 'warning' | 'critical'
}
type OvertimeRow = { employeeId: number | null; employeeName: string; date: string; scheduledCode: AttendanceRow['scheduledCode']; expectedEnd: string | null; actualEnd: string | null; minutes: number }
type SavedReport = { id: number; fileName: string; createdAt: string; fromDate: string; toDate: string; importedRows: number }
type AttendanceResult = {
  reportId?: number
  fileName?: string
  from: string
  to: string
  importedRows: number
  overtimeThresholdMinutes: number
  overtimeRoundMinutes?: number
  counts: { compared: number; normal: number; needsReview: number; inProgress: number; unexpectedWork: number; unmatched: number; overtime: number; overtimeMinutes: number }
  rows: AttendanceRow[]
  overtime: OvertimeRow[]
  unmatched: { name: string; date: string; checkIn: string | null; checkOut: string | null; reason: string }[]
}

const shiftNames: Record<NonNullable<AttendanceRow['scheduledCode']>, string> = { open: '오픈', close: '마감', full: '종일', off: '휴무' }
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
const pendingUploadKey = 'pending'

function openPendingUploadDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('attendance-upload-cache', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('uploads')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('근태 파일 저장소를 열지 못했습니다.'))
  })
}

async function storePendingUpload(file: File | null): Promise<void> {
  const database = await openPendingUploadDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('uploads', 'readwrite')
    const store = transaction.objectStore('uploads')
    if (!file) store.delete(pendingUploadKey)
    else store.put({ name: file.name, type: file.type, lastModified: file.lastModified, blob: file }, pendingUploadKey)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('근태 파일을 저장하지 못했습니다.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('근태 파일 저장이 취소됐습니다.'))
  }).finally(() => database.close())
}

async function readPendingUpload(): Promise<File | null> {
  const database = await openPendingUploadDb()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('uploads', 'readonly')
    const request = transaction.objectStore('uploads').get(pendingUploadKey)
    request.onsuccess = () => {
      const saved = request.result as { name?: string; type?: string; lastModified?: number; blob?: Blob } | undefined
      resolve(saved?.blob instanceof Blob && saved.name
        ? new File([saved.blob], saved.name, { type: saved.type ?? '', lastModified: saved.lastModified ?? Date.now() })
        : null)
    }
    request.onerror = () => reject(request.error ?? new Error('저장된 근태 파일을 읽지 못했습니다.'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('저장된 근태 파일을 읽지 못했습니다.')) }
  })
}

export function AttendancePage() {
  const [file, setFile] = useState<File | null>(null)
  const [uploadSaved, setUploadSaved] = useState(false)
  const [graceMinutes, setGraceMinutes] = useState(5)
  const [overtimeThresholdMinutes, setOvertimeThresholdMinutes] = useState(30)
  const [overtimeRoundMinutes, setOvertimeRoundMinutes] = useState(30)
  const [result, setResult] = useState<AttendanceResult | null>(null)
  const [reports, setReports] = useState<SavedReport[]>([])
  const [selectedReportId, setSelectedReportId] = useState('')
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [busy, setBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'review'>('all')
  const [dateFilter, setDateFilter] = useState('all')

  const dates = useMemo(() => [...new Set(result?.rows.map(row => row.date) ?? [])], [result])
  const overtimePeople = useMemo(() => {
    const people = new Map<number, { employeeId: number; employeeName: string; count: number }>()
    for (const row of result?.overtime ?? []) {
      if (row.employeeId === null) continue
      const person = people.get(row.employeeId) ?? { employeeId: row.employeeId, employeeName: row.employeeName, count: 0 }
      person.count++
      people.set(row.employeeId, person)
    }
    return [...people.values()]
  }, [result])
  const visibleRows = useMemo(() => (result?.rows ?? []).filter(row =>
    (filter === 'all' || ['warning', 'critical'].includes(row.severity) || (row.overtimeMinutes > 0 && row.overtimeMinutes >= (result?.overtimeThresholdMinutes ?? 30)))
    && (dateFilter === 'all' || row.date === dateFilter),
  ), [result, filter, dateFilter])

  const loadSavedReport = async (id?: number | string) => {
    const listResponse = await fetch('/api/attendance/reports', { credentials: 'same-origin' })
    if (!listResponse.ok) throw new Error('저장된 근태 이력을 불러오지 못했습니다.')
    const savedReports = await listResponse.json() as SavedReport[]
    setReports(savedReports)
    const targetId = id ? String(id) : String(savedReports[0]?.id ?? '')
    setSelectedReportId(targetId)
    if (!targetId) { setResult(null); return }
    const response = await fetch(`/api/attendance/reports/${targetId}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('선택한 근태 이력을 불러오지 못했습니다.')
    const saved = await response.json() as { result: AttendanceResult }
    setResult(saved.result)
    setDateFilter('all')
  }

  useEffect(() => {
    let active = true
    void readPendingUpload()
      .then(savedFile => {
        if (active && savedFile) { setFile(savedFile); setUploadSaved(true) }
      })
      .catch(() => { if (active) setError('이 브라우저에 저장한 근태 파일을 불러오지 못했습니다. 파일을 다시 선택해 주세요.') })
    void fetch('/api/attendance/reports', { credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) throw new Error('저장된 근태 이력을 불러오지 못했습니다.')
        const savedReports = await response.json() as SavedReport[]
        if (!active) return
        setReports(savedReports)
        const latestId = savedReports[0]?.id
        if (!latestId) return
        setSelectedReportId(String(latestId))
        const latestResponse = await fetch(`/api/attendance/reports/${latestId}`, { credentials: 'same-origin' })
        if (!latestResponse.ok) throw new Error('최근 근태 이력을 불러오지 못했습니다.')
        const saved = await latestResponse.json() as { result: AttendanceResult }
        if (active) setResult(saved.result)
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '저장된 근태 이력을 불러오지 못했습니다.') })
      .finally(() => { if (active) setLoadingSaved(false) })
    return () => { active = false }
  }, [])

  const chooseFile = (next: File | null) => {
    setError('')
    if (!next) {
      setFile(null)
      setUploadSaved(false)
      void storePendingUpload(null).catch(() => setError('저장된 근태 파일을 지우지 못했습니다.'))
      return
    }
    if (!/\.xlsx?$/i.test(next.name)) { setFile(null); setError('.xls 또는 .xlsx 근태등록 파일을 선택해 주세요.'); return }
    if (next.size > 10 * 1024 * 1024) { setFile(null); setError('파일은 10MB 이하만 올릴 수 있습니다.'); return }
    setFile(next)
    setUploadSaved(false)
    void storePendingUpload(next)
      .then(() => setUploadSaved(true))
      .catch(() => setError('파일을 이 브라우저에 저장하지 못했습니다. 저장 공간을 확인하거나 다시 선택해 주세요.'))
  }

  const compare = async () => {
    if (!file || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/attendance/compare?graceMinutes=${graceMinutes}&overtimeThresholdMinutes=${overtimeThresholdMinutes}&overtimeRoundMinutes=${overtimeRoundMinutes}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      })
      const body = await response.json().catch(() => null) as AttendanceResult | { error?: string } | null
      if (!response.ok) throw new Error(body && 'error' in body && body.error ? body.error : `근태 비교에 실패했습니다. (${response.status})`)
      const comparison = body as AttendanceResult
      setResult(comparison)
      setDateFilter('all')
      await storePendingUpload(null)
      setUploadSaved(false)
      await loadSavedReport(comparison.reportId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '근태 비교 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const downloadOvertimeSheet = async (employeeId?: number) => {
    if (!result?.overtime.length || exportBusy) return
    setExportBusy(true)
    setError('')
    try {
      const response = await fetch('/api/attendance/overtime-sheet', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: result.from, to: result.to, overtime: result.overtime, ...(employeeId === undefined ? {} : { employeeId }) }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error || `시간외 근무 기록부를 만들지 못했습니다. (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `시간외 근무 기록부_${result.from}_${result.to}.xlsx`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '시간외 근무 기록부를 만들지 못했습니다.')
    } finally {
      setExportBusy(false)
    }
  }

  return <>
    <header className="page-head">
      <div><h1>근태 모니터링</h1><p>지문 근태등록 파일을 근무표와 비교해 출근·퇴근 상태와 확인할 항목을 살펴봅니다.</p></div>
    </header>

    <section className="panel pad attendance-upload">
      <div className="section-head"><div><h2>근태 파일 비교</h2><p className="muted small">구형 엑셀 .xls와 .xlsx를 지원합니다. 선택한 파일은 이 브라우저에 임시 저장되고, 비교 결과는 서버에 최근 24개까지 저장됩니다.</p></div></div>
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
        <label className="field">시간외 분 단위 버림
          <span className="unit"><input type="number" min={0} max={240} step={5} value={overtimeRoundMinutes} onChange={event => setOvertimeRoundMinutes(Math.max(0, Math.min(240, Number(event.target.value) || 0)))}/>분</span>
        </label>
        <button className="btn btn-primary attendance-submit" type="button" disabled={!file || busy} onClick={() => void compare()}>{busy ? '근무표와 비교 중…' : '근태 비교'}</button>
      </div>
      {file && <div className="attendance-selected"><span><b>{file.name}</b><small>{(file.size / 1024).toFixed(1)}KB{uploadSaved ? ' · 이 브라우저에 저장됨' : ''}</small></span><button type="button" className="btn btn-ghost btn-sm" onClick={() => chooseFile(null)}>파일 변경</button></div>}
      {reports.length > 0 && <label className="field attendance-history">저장된 비교 이력
        <select value={selectedReportId} onChange={event => { const id = event.target.value; setSelectedReportId(id); void loadSavedReport(id).catch(cause => setError(cause instanceof Error ? cause.message : '근태 이력을 불러오지 못했습니다.')) }}>
          {reports.map(report => <option key={report.id} value={report.id}>{report.fromDate} ~ {report.toDate} · {report.fileName} · {new Date(report.createdAt).toLocaleString('ko-KR')}</option>)}
        </select>
      </label>}
      {error && <div className="alert alert-error" role="alert"><p>{error}</p></div>}
      {loadingSaved && <p className="muted small attendance-note">저장된 근태 이력을 불러오는 중…</p>}
      <p className="muted small attendance-note">선택한 파일은 새로고침 후에도 이 브라우저에서 이어서 사용할 수 있습니다. ‘근태 비교’를 누르면 결과가 저장되어 비교 이력에서 다시 열 수 있습니다. 시간외 분은 설정한 단위로 버림 처리하며 0분이면 원래 분을 유지합니다. 실제 일정이 과거 근무표와 다르면 운영 설정에서 해당 날짜를 수정 허용한 뒤 근무표를 고쳐 다시 비교하세요.</p>
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
          {result.overtime.length > 0 && <button className="btn btn-primary btn-sm" type="button" disabled={exportBusy} onClick={() => void downloadOvertimeSheet()}>{exportBusy ? '기록부 만드는 중…' : `시간외 근무 기록부 엑셀 다운로드 (${result.overtime.length}건)`}</button>}
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
            <td><span className={`attendance-status status-${row.severity}`}>{row.status}</span>{(row.actualOvertimeMinutes ?? row.overtimeMinutes) > row.overtimeMinutes && <small>실제 초과 {(row.actualOvertimeMinutes ?? row.overtimeMinutes)}분 · 반영 {row.overtimeMinutes}분</small>}</td>
          </tr>)}</tbody>
        </table></div> : <p className="attendance-empty">{filter === 'review' ? '선택한 조건에 확인할 항목이 없습니다.' : '표시할 근태 비교 결과가 없습니다.'}</p>}
      </section>

      {result.overtime.length > 0 && <section className="panel pad attendance-overtime-people">
        <h2>개인별 시간외 근무 기록부</h2>
        <ul>{overtimePeople.map(person => <li key={person.employeeId}><span><b>{person.employeeName}</b><small>{person.count}건</small></span><button className="btn btn-secondary btn-sm" type="button" disabled={exportBusy} onClick={() => void downloadOvertimeSheet(person.employeeId)}>{person.employeeName} 기록부 다운로드</button></li>)}</ul>
      </section>}

      {result.unmatched.length > 0 && <section className="panel pad attendance-unmatched">
        <h2>직원 이름 확인 <span className="count">{result.unmatched.length}</span></h2>
        <p className="muted small">근무표 직원과 이름이 일치하지 않는 지문 기록입니다. 직원 이름이 같거나 다른 경우 직원 목록과 원본 파일을 확인해 주세요.</p>
        <ul>{result.unmatched.map((row, index) => <li key={`${row.date}:${row.name}:${index}`}><b>{row.name}</b><span>{dateLabel(row.date)} · 출근 {row.checkIn ?? '—'} · 퇴근 {row.checkOut ?? '—'}</span><small>{row.reason}</small></li>)}</ul>
      </section>}
    </>}
  </>
}
