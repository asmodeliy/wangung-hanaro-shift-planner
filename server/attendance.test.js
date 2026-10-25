import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareAttendance } from './attendance.js'

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
