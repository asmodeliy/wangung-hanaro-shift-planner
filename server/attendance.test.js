import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareAttendance, recompareAttendance, selectAttendanceMonth } from './attendance.js'

test('월별 비교는 선택한 달의 실제 파일 범위와 원본 행 수만 사용한다', () => {
  const report = { from: '2026-10-30', to: '2026-12-01', importedRows: 5, attendance: [
    { date: '2026-10-30', rowCount: 1 },
    { date: '2026-11-03', rowCount: 2 },
    { date: '2026-11-16', rowCount: 1 },
    { date: '2026-12-01', rowCount: 1 },
  ] }
  const selected = selectAttendanceMonth(report, '2026-11')
  assert.equal(selected.from, '2026-11-03')
  assert.equal(selected.to, '2026-11-16')
  assert.equal(selected.importedRows, 3)
  assert.equal(selected.attendance.length, 2)
  assert.throws(() => selectAttendanceMonth(report, '2026-13'), /월/)
  assert.throws(() => selectAttendanceMonth(report, '2027-01'), /없습니다/)
  assert.equal(selectAttendanceMonth(report, ''), report)
})

test('attendance comparison exports scheduled overtime at the configured threshold and excludes shorter overtime', () => {
  const report = {
    from: '2026-11-01',
    to: '2026-11-02',
    importedRows: 2,
    attendance: [
      { name: '테스트 직원', normalizedName: '테스트직원', date: '2026-11-01', checkIn: '09:00', checkOut: '18:29' },
      { name: '테스트 직원', normalizedName: '테스트직원', date: '2026-11-02', checkIn: '09:00', checkOut: '18:30' },
    ],
  }
  const employees = [{ id: 1, name: '테스트 직원' }]
  const shifts = ['2026-11-01', '2026-11-02'].map(date => ({ employeeId: 1, date, code: 'open', start: '09:00', end: '18:00' }))

  const result = compareAttendance({ report, employees, shifts, overtimeThresholdMinutes: 30, now: new Date('2026-11-03T00:00:00Z') })

  assert.equal(result.counts.overtime, 1)
  assert.equal(result.counts.overtimeMinutes, 30)
  assert.deepEqual(result.overtime.map(row => ({ date: row.date, minutes: row.minutes })), [{ date: '2026-11-02', minutes: 30 }])
  assert.match(result.rows.find(row => row.date === '2026-11-02').status, /초과근무 30분/)
  assert.doesNotMatch(result.rows.find(row => row.date === '2026-11-01').status, /초과근무/)
})

test('attendance overtime threshold is adjustable, including zero minutes', () => {
  const report = {
    from: '2026-11-01', to: '2026-11-01', importedRows: 1,
    attendance: [{ name: '테스트 직원', normalizedName: '테스트직원', date: '2026-11-01', checkIn: '09:00', checkOut: '18:01' }],
  }
  const input = { report, employees: [{ id: 1, name: '테스트 직원' }], shifts: [{ employeeId: 1, date: '2026-11-01', code: 'open', start: '09:00', end: '18:00' }] }
  assert.equal(compareAttendance({ ...input, overtimeThresholdMinutes: 30 }).overtime.length, 0)
  assert.equal(compareAttendance({ ...input, overtimeThresholdMinutes: 0, overtimeRoundMinutes: 0 }).overtime[0].minutes, 1)
})

test('attendance overtime is rounded down to the configured unit before it is counted or exported', () => {
  const report = {
    from: '2026-11-01', to: '2026-11-03', importedRows: 3,
    attendance: [29, 59, 60].map((minutes, index) => {
      const total = 18 * 60 + minutes
      return {
        name: '테스트 직원', normalizedName: '테스트직원', date: `2026-11-0${index + 1}`,
        checkIn: '09:00', checkOut: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
      }
    }),
  }
  const input = {
    report,
    employees: [{ id: 1, name: '테스트 직원' }],
    shifts: report.attendance.map(record => ({ employeeId: 1, date: record.date, code: 'open', start: '09:00', end: '18:00' })),
  }

  const rounded = compareAttendance({ ...input, overtimeThresholdMinutes: 30, overtimeRoundMinutes: 30 })
  assert.deepEqual(rounded.overtime.map(record => [record.date, record.minutes]), [['2026-11-02', 30], ['2026-11-03', 60]])
  assert.equal(rounded.counts.overtimeMinutes, 90)
  assert.equal(rounded.rows.find(row => row.date === '2026-11-02').actualOvertimeMinutes, 59)
  assert.equal(compareAttendance({ ...input, overtimeThresholdMinutes: 30, overtimeRoundMinutes: 0 }).overtime[0].minutes, 59)
})

test('saved attendance can be re-compared against the current schedule and rounding settings', () => {
  const savedResult = {
    from: '2026-11-01', to: '2026-11-01', importedRows: 1, graceMinutes: 5,
    overtimeThresholdMinutes: 30, overtimeRoundMinutes: 0,
    rows: [{ employeeId: 1, employeeName: '테스트 직원', date: '2026-11-01', scheduledCode: 'open', expectedStart: '09:00', expectedEnd: '17:00', actualStart: '09:00', actualEnd: '19:29', overtimeMinutes: 149, status: '초과근무 149분', severity: 'info' }],
    overtime: [], unmatched: [{ name: '미등록 직원', date: '2026-11-01', checkIn: '09:01', checkOut: '18:45', reason: '등록된 직원을 찾지 못했습니다.' }],
  }
  const current = recompareAttendance({
    savedResult,
    employees: [{ id: 1, name: '테스트 직원' }],
    shifts: [{ employeeId: 1, date: '2026-11-01', code: 'open', start: '09:00', end: '18:30' }],
    overtimeThresholdMinutes: 30, overtimeRoundMinutes: 30, now: new Date('2026-11-03T00:00:00Z'),
  })
  assert.equal(current.rows[0].expectedEnd, '18:30')
  assert.equal(current.rows[0].actualOvertimeMinutes, 59)
  assert.equal(current.rows[0].overtimeMinutes, 30)
  assert.equal(current.overtime[0].minutes, 30)
  assert.equal(current.graceMinutes, 5)
  assert.equal(current.unmatched[0].name, '미등록 직원')
})

test('실제 근무 수정은 계획을 보존하면서 지문 퇴근과 실제 근무 종료시각으로 시간외를 다시 계산한다', () => {
  const date = '2026-11-01'
  const employees = [{ id: 1, name: '직원' }]
  const shifts = [{ employeeId: 1, date, code: 'open', start: '08:00', end: '17:00' }]
  const report = { from: date, to: date, importedRows: 1, attendance: [{ name: '직원', normalizedName: '직원', date, checkIn: '11:00', checkOut: '20:45' }] }
  const savedResult = compareAttendance({ report, employees, shifts, overtimeRoundMinutes: 30 })
  assert.equal(savedResult.overtime[0].minutes, 210)
  const actualShifts = [{ employeeId: 1, date, code: 'close', start: '11:00', end: '20:00' }]
  const revised = recompareAttendance({ savedResult, employees, shifts, actualShifts, overtimeRoundMinutes: 30 })
  assert.equal(revised.rows[0].plannedCode, 'open')
  assert.equal(revised.rows[0].scheduledCode, 'close')
  assert.equal(revised.rows[0].actualEnd, '20:45')
  assert.equal(revised.overtime[0].expectedEnd, '20:00')
  assert.equal(revised.overtime[0].minutes, 30)
  assert.deepEqual(revised.actualShifts, [{ employeeId: 1, date, code: 'close' }])
  assert.equal(shifts[0].code, 'open')
  const reset = recompareAttendance({ savedResult: revised, employees, shifts, actualShifts: [], overtimeRoundMinutes: 30 })
  assert.equal(reset.overtime[0].minutes, 210)
  const noPunch = compareAttendance({ report: { ...report, attendance: [] }, employees, shifts, now: new Date('2026-11-03T00:00:00Z') })
  const rest = recompareAttendance({ savedResult: noPunch, employees, shifts, actualShifts: [{ employeeId: 1, date, code: 'off', start: null, end: null }] })
  assert.equal(rest.rows[0].scheduledCode, 'off')
  assert.equal(rest.rows[0].status, '휴무')
  assert.equal(rest.rows[0].actualShiftEdited, true)
})
