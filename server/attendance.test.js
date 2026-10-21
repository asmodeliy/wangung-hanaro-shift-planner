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
  assert.equal(compareAttendance({ ...input, overtimeThresholdMinutes: 0 }).overtime[0].minutes, 1)
})
