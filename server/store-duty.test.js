import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assignStoreDuties } from './store-duty.js'

test('매장 당번은 근무조와 그룹 우선순위를 따르며 정육 담당은 제외한다', () => {
  const dates = ['2026-12-01', '2026-12-02', '2026-12-03']
  const shifts = [
    ...['open', 'open', 'open', 'off', 'close'].map((code, i) => ({ date: dates[0], employeeId: i + 1, code })),
    { date: dates[1], employeeId: 2, code: 'open' },
    { date: dates[1], employeeId: 3, code: 'close' },
    { date: dates[2], employeeId: 1, code: 'close' },
    { date: dates[2], employeeId: 3, code: 'full' },
    { date: dates[2], employeeId: 4, code: 'close' },
  ]
  const assignments = assignStoreDuties(dates, shifts, { office: [1], compose: [2], butcher: [3] })
  assert.deepEqual(Object.values(assignments), [
    { morning: 2, afternoon: 5 },
    { morning: 2, afternoon: null },
    { morning: null, afternoon: 4 },
  ])
})
