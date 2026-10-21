import * as XLSX from '@e965/xlsx'

const maxRows = 10_000
const cleanText = value => {
  if (value && typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('').trim()
  return String(value ?? '').trim()
}

export function normalizeAttendanceName(value) {
  return cleanText(value).normalize('NFKC').replace(/[\s\u200b\u3000]/g, '').toLocaleLowerCase('ko-KR')
}

function parseDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed?.y && parsed?.m && parsed?.d) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    return null
  }
  const text = cleanText(value)
  const match = text.match(/^(\d{4})[./年-]\s*(\d{1,2})[./月-]\s*(\d{1,2})/)
  if (!match) return null
  const [, year, month, day] = match
  const key = `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`
  const date = new Date(`${key}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : null
}

function parseTime(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    const fractionalDay = value >= 1 ? value % 1 : value
    const parsed = XLSX.SSF.parse_date_code(fractionalDay)
    if (!parsed) return null
    return String(parsed.H).padStart(2, '0') + ':' + String(parsed.M).padStart(2, '0')
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`
  const text = cleanText(value)
  const match = text.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(오전|오후)?/)
  if (!match) return null
  const period = match[1] ?? match[4]
  let hours = Number(match[2])
  const minutes = Number(match[3])
  if (hours > 23 || minutes > 59) return null
  if (period === '오후' && hours < 12) hours += 12
  if (period === '오전' && hours === 12) hours = 0
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function columnIndex(headers, aliases) {
  return headers.findIndex(header => aliases.some(alias => header.includes(alias)))
}

export function parseAttendanceWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new Error('근태 파일이 비어 있거나 올바르지 않습니다.')
  let workbook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, bookVBA: false, WTF: false })
  } catch {
    throw new Error('엑셀 파일을 읽을 수 없습니다. 원본 .xls 또는 .xlsx 파일인지 확인해 주세요.')
  }
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName && workbook.Sheets[sheetName]
  if (!sheet) throw new Error('근태 내역이 들어 있는 시트를 찾지 못했습니다.')
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false })
  const headerRow = matrix.slice(0, 50).findIndex(row => {
    const headers = row.map(value => cleanText(value).replace(/\s/g, '').toLocaleLowerCase('ko-KR'))
    return columnIndex(headers, ['이름', '성명', '사원명', '직원명']) >= 0
      && columnIndex(headers, ['근무일자', '일자', '날짜']) >= 0
      && columnIndex(headers, ['출근']) >= 0
      && columnIndex(headers, ['퇴근']) >= 0
  })
  if (headerRow < 0) throw new Error('이름, 근무일자, 출근, 퇴근 열이 있는 근태등록 파일인지 확인해 주세요.')
  const headers = matrix[headerRow].map(value => cleanText(value).replace(/\s/g, '').toLocaleLowerCase('ko-KR'))
  const indices = {
    name: columnIndex(headers, ['이름', '성명', '사원명', '직원명']),
    date: columnIndex(headers, ['근무일자', '일자', '날짜']),
    checkIn: columnIndex(headers, ['출근']),
    checkOut: columnIndex(headers, ['퇴근']),
  }
  const sourceRows = matrix.slice(headerRow + 1).slice(0, maxRows)
  const records = []
  for (const row of sourceRows) {
    const name = cleanText(row[indices.name])
    const date = parseDate(row[indices.date])
    if (!name || !date) continue
    records.push({ name, normalizedName: normalizeAttendanceName(name), date, checkIn: parseTime(row[indices.checkIn]), checkOut: parseTime(row[indices.checkOut]) })
  }
  if (!records.length) throw new Error('근태등록 표에서 직원명과 날짜가 있는 행을 찾지 못했습니다.')
  const grouped = new Map()
  for (const record of records) {
    const key = `${record.normalizedName}:${record.date}`
    const existing = grouped.get(key) ?? { name: record.name, normalizedName: record.normalizedName, date: record.date, checkIns: [], checkOuts: [], rowCount: 0 }
    if (record.checkIn) existing.checkIns.push(record.checkIn)
    if (record.checkOut) existing.checkOuts.push(record.checkOut)
    existing.rowCount++
    grouped.set(key, existing)
  }
  const attendance = [...grouped.values()].map(record => ({
    name: record.name,
    normalizedName: record.normalizedName,
    date: record.date,
    checkIn: record.checkIns.sort()[0] ?? null,
    checkOut: record.checkOuts.sort().at(-1) ?? null,
    rowCount: record.rowCount,
  })).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ko'))
  const dates = attendance.map(record => record.date)
  return { sheetName, importedRows: records.length, attendance, from: dates[0], to: dates.at(-1) }
}

const minutesOfDay = time => time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : null

export function compareAttendance({ report, employees, shifts, graceMinutes = 5, overtimeThresholdMinutes = 30, now = new Date() }) {
  const employeeByName = new Map()
  for (const employee of employees) {
    const key = normalizeAttendanceName(employee.name)
    if (!employeeByName.has(key)) employeeByName.set(key, [])
    employeeByName.get(key).push(employee)
  }
  const employeeById = new Map(employees.map(employee => [Number(employee.id), employee]))
  const dateKeys = []
  for (let date = new Date(`${report.from}T00:00:00Z`), end = new Date(`${report.to}T00:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) dateKeys.push(date.toISOString().slice(0, 10))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const currentMinuteParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number)
  const currentMinute = currentMinuteParts[0] * 60 + currentMinuteParts[1]
  const scheduleByCell = new Map(shifts.map(shift => [`${Number(shift.employeeId)}:${shift.date}`, shift]))
  const actualByCell = new Map()
  const unmatched = []
  for (const record of report.attendance) {
    const candidates = employeeByName.get(record.normalizedName) ?? []
    if (candidates.length !== 1) {
      if (record.checkIn || record.checkOut) unmatched.push({ name: record.name, date: record.date, checkIn: record.checkIn, checkOut: record.checkOut, reason: candidates.length ? '동일한 직원명이 여러 명입니다.' : '직원 목록에서 이름을 찾지 못했습니다.' })
      continue
    }
    const employee = candidates[0]
    const key = `${Number(employee.id)}:${record.date}`
    const existing = actualByCell.get(key)
    if (!existing) actualByCell.set(key, { ...record, employeeId: Number(employee.id) })
    else {
      existing.checkIn = [existing.checkIn, record.checkIn].filter(Boolean).sort()[0] ?? null
      existing.checkOut = [existing.checkOut, record.checkOut].filter(Boolean).sort().at(-1) ?? null
    }
  }
  const rows = []
  const seen = new Set()
  const addRow = ({ employee, date, shift, actual }) => {
    const scheduledCode = shift?.code ?? null
    const actualStart = actual?.checkIn ?? null
    const actualEnd = actual?.checkOut ?? null
    const hasPunch = Boolean(actualStart || actualEnd)
    if (scheduledCode === 'off' && !hasPunch) return
    if (!scheduledCode && !hasPunch) return
    let expectedStart = shift?.start ?? null
    let expectedEnd = shift?.end ?? null
    const status = []
    let severity = 'ok'
    let lateMinutes = 0
    let earlyMinutes = 0
    let overtimeMinutes = 0
    if (!shift) {
      status.push('근무표 미편성')
      severity = 'warning'
    } else if (scheduledCode === 'off') {
      status.push('휴무일 출근')
      severity = 'warning'
    } else {
      const expectedStartMinute = minutesOfDay(expectedStart)
      const expectedEndMinute = minutesOfDay(expectedEnd)
      const inMinute = minutesOfDay(actualStart)
      const outMinute = minutesOfDay(actualEnd)
      if (outMinute !== null && expectedEndMinute !== null && outMinute > expectedEndMinute) overtimeMinutes = outMinute - expectedEndMinute
      if (inMinute === null) {
        if (date > today || (date === today && expectedStartMinute !== null && currentMinute < expectedStartMinute - graceMinutes)) {
          status.push('출근 예정')
          severity = 'info'
        } else {
          status.push(date === today ? '출근 미확인' : '출근 기록 없음')
          severity = 'critical'
        }
      } else if (expectedStartMinute !== null && inMinute - expectedStartMinute > graceMinutes) {
        lateMinutes = inMinute - expectedStartMinute
        status.push(`지각 ${lateMinutes}분`)
        severity = 'warning'
      }
      if (actualEnd) {
        if (outMinute !== null && expectedEndMinute !== null && expectedEndMinute - outMinute > graceMinutes) {
          earlyMinutes = expectedEndMinute - outMinute
          status.push(`조기퇴근 ${earlyMinutes}분`)
          severity = severity === 'critical' ? severity : 'warning'
        }
      } else if (inMinute !== null && date === today && (expectedEndMinute === null || currentMinute <= expectedEndMinute + graceMinutes)) {
        status.push('근무 중')
        if (severity === 'ok') severity = 'info'
      } else if (inMinute !== null) {
        status.push('퇴근 기록 없음')
        severity = 'critical'
      }
      if (!status.length) status.push('정상')
      if (overtimeMinutes >= overtimeThresholdMinutes && overtimeMinutes > 0) {
        status.push(`초과근무 ${overtimeMinutes}분`)
        if (severity === 'ok') severity = 'info'
      }
    }
    rows.push({
      employeeId: employee?.id ?? null,
      employeeName: employee?.name ?? actual?.name ?? '이름 미확인',
      date,
      scheduledCode,
      expectedStart,
      expectedEnd,
      actualStart,
      actualEnd,
      status: status.join(' · '),
      severity,
      lateMinutes,
      earlyMinutes,
      overtimeMinutes,
    })
  }
  for (const date of dateKeys) for (const shift of shifts.filter(item => item.date === date)) {
    const employee = employeeById.get(Number(shift.employeeId))
    if (!employee) continue
    const key = `${Number(employee.id)}:${date}`
    seen.add(key)
    addRow({ employee, date, shift, actual: actualByCell.get(key) })
  }
  for (const [key, actual] of actualByCell) if (!seen.has(key)) {
    addRow({ employee: employeeById.get(actual.employeeId), date: actual.date, shift: scheduleByCell.get(key), actual })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.employeeName.localeCompare(b.employeeName, 'ko')))
  const counts = {
    compared: rows.filter(row => row.scheduledCode && row.scheduledCode !== 'off').length,
    normal: rows.filter(row => row.severity === 'ok').length,
    needsReview: rows.filter(row => ['warning', 'critical'].includes(row.severity)).length,
    inProgress: rows.filter(row => row.status.includes('근무 중')).length,
    unexpectedWork: rows.filter(row => row.status.includes('휴무일 출근') || row.status.includes('근무표 미편성')).length,
    unmatched: unmatched.length,
    overtime: rows.filter(row => row.overtimeMinutes >= overtimeThresholdMinutes && row.overtimeMinutes > 0).length,
    overtimeMinutes: rows.filter(row => row.overtimeMinutes >= overtimeThresholdMinutes && row.overtimeMinutes > 0).reduce((total, row) => total + row.overtimeMinutes, 0),
  }
  const overtime = rows.filter(row => row.overtimeMinutes >= overtimeThresholdMinutes && row.overtimeMinutes > 0).map(row => ({
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    date: row.date,
    scheduledCode: row.scheduledCode,
    expectedEnd: row.expectedEnd,
    actualEnd: row.actualEnd,
    minutes: row.overtimeMinutes,
  }))
  return { from: report.from, to: report.to, importedRows: report.importedRows, overtimeThresholdMinutes, counts, rows, overtime, unmatched }
}
