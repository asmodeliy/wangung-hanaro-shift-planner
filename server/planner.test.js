import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultRules, fallbackMinimumWorkersForDate, generateSchedule, isRequiredOff, minimumWorkersForDate, monthDates, normalizeRules, restTarget, validDate, validateSchedule } from './planner.js'

const employees = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `직원${i + 1}`, employmentType: i < 3 ? '정규직' : '계약직', workRules: structuredClone(defaultRules) }))
const base = () => ({ month: '2026-02', employees: structuredClone(employees), settings: { daysOffPairs: [{ employeeIds: [2, 7] }], weeklyRestPolicy: 'minimum' }, holidays: [] })
function verify(input, result) {
  assert.equal(result.error, undefined)
  assert.equal(result.shifts.length, input.employees.length * monthDates(input.month).length)
  assert.deepEqual(validateSchedule({ ...input, shifts: result.shifts }).issues, [])
  for (const employee of input.employees) assert.equal(result.shifts.filter(s => s.employeeId === employee.id && s.code === 'off').length, result.targetRestDays)
}

test('baseline covers both regular shifts, exact monthly quota and weekly minimum', async () => {
  const input = base()
  verify(input, await generateSchedule(input))
})
test('a regular full-day assignment covers both regular open and close requirements', () => {
  const input = base()
  const date = '2026-02-05'
  const shifts = [{ employeeId: 1, date, code: 'full' }, { employeeId: 4, date, code: 'open' }, { employeeId: 5, date, code: 'close' }]
  const result = validateSchedule({ ...input, shifts })
  assert.ok(!result.issues.some(issue => issue.date === date && issue.text.endsWith('정규직 없음')))
  assert.ok(!result.issues.some(issue => issue.text.startsWith(`${date} 최소 근무인원 미충족`)))
})
test('fill generation preserves a manually assigned full-day shift', async () => {
  const input = base()
  const fullDay = { employeeId: 1, date: '2026-02-05', code: 'full' }
  input.mode = 'fill'
  input.existingShifts = [fullDay]
  const result = await generateSchedule(input)
  verify(input, result)
  assert.ok(result.shifts.some(shift => shift.employeeId === fullDay.employeeId && shift.date === fullDay.date && shift.code === 'full'))
})
test('conflicting approved wishes are adjusted without breaking simultaneous-rest rule', async () => {
  const input = { ...base(), requests: [2, 7].map(employeeId => ({ employeeId, date: '2026-02-05', status: 'approved' })) }
  const result = await generateSchedule(input)
  verify(input, result)
  assert.equal(result.missedRequests.length, 1)
})
test('pending wishes cannot remove required regular coverage', async () => {
  const input = { ...base(), requests: [1, 2, 3].map(employeeId => ({ employeeId, date: '2026-02-05', status: 'pending' })) }
  const result = await generateSchedule(input)
  verify(input, result)
  assert.equal(result.missedRequests.length, 2)
})
test('nine approved wishes cannot exceed an eight-day monthly rest quota', async () => {
  const input = { ...base(), requests: Array.from({ length: 9 }, (_, i) => ({ employeeId: 4, date: `2026-02-${String(i + 1).padStart(2, '0')}`, status: 'approved' })) }
  const result = await generateSchedule(input)
  verify(input, result)
  assert.ok(result.missedRequests.length >= 1)
})
test('employee recurring weekdays and allowed shift types are mandatory', async () => {
  const input = base()
  input.employees[5].workRules.offRules = [{ weekday: 5, occurrences: [2, 4] }, { weekday: 0, occurrences: [2, 4] }]
  input.employees[3].workRules.offRules = [{ weekday: 0, occurrences: [1, 3, 5] }]
  input.employees[4].workRules.allowedShifts = ['open']
  const result = await generateSchedule(input)
  verify(input, result)
  for (const employee of input.employees) for (const shift of result.shifts.filter(s => s.employeeId === employee.id)) {
    if (isRequiredOff(employee, shift.date)) assert.equal(shift.code, 'off')
    if (shift.code !== 'off') assert.ok(employee.workRules.allowedShifts.includes(shift.code))
  }
})
test('fill mode retains every prior work and rest assignment', async () => {
  const input = base()
  const first = await generateSchedule(input)
  const existingShifts = first.shifts.filter((_, i) => i % 3 === 0)
  const result = await generateSchedule({ ...input, mode: 'fill', existingShifts })
  verify(input, result)
  for (const prior of existingShifts) assert.deepEqual(result.shifts.find(s => s.employeeId === prior.employeeId && s.date === prior.date), prior)
})
test('agricultural staff cover an open shift daily and split open/close when at least two work', async () => {
  const input = base()
  input.employees[3].isAgricultural = true
  input.employees[4].isAgricultural = true
  const result = await generateSchedule(input)
  verify(input, result)
  for (const date of monthDates(input.month)) {
    const assigned = result.shifts.filter(shift => shift.date === date && input.employees.find(employee => employee.id === shift.employeeId)?.isAgricultural && shift.code !== 'off')
    assert.ok(assigned.some(shift => shift.code === 'open'), `${date} needs an agricultural opener`)
    if (assigned.length >= 2) assert.ok(assigned.some(shift => shift.code === 'close'), `${date} needs an agricultural closer when at least two work`)
  }
})
test('manual validation identifies missing agricultural open and closer coverage', () => {
  const input = base()
  input.employees[3].isAgricultural = true
  input.employees[4].isAgricultural = true
  const date = '2026-02-02'
  const shifts = [{ employeeId: 4, date, code: 'close' }, { employeeId: 5, date, code: 'close' }]
  const issues = validateSchedule({ ...input, shifts }).issues
  assert.ok(issues.some(issue => issue.text === `${date} 농산 직원 오픈 근무 없음`))
  const onlyOpen = validateSchedule({ ...input, shifts: shifts.map(shift => ({ ...shift, code: 'open' })) }).issues
  assert.ok(onlyOpen.some(issue => issue.text === `${date} 농산 직원 2명 이상 근무 시 마감 근무 없음`))
})
test('regular staff do not close on consecutive days from November 2026 onward', async () => {
  const input = base()
  input.month = '2026-11'
  input.adjacentShifts = [{ employeeId: 1, date: '2026-10-31', code: 'close' }]
  const result = await generateSchedule(input)
  verify(input, result)
  for (const employee of input.employees.filter(item => item.employmentType === '정규직')) {
    for (const date of monthDates(input.month)) {
      if (result.shifts.some(shift => shift.employeeId === employee.id && shift.date === date && shift.code === 'close')) {
        const previous = new Date(`${date}T00:00:00Z`)
        previous.setUTCDate(previous.getUTCDate() - 1)
        const previousDate = previous.toISOString().slice(0, 10)
        assert.notEqual(input.adjacentShifts.some(shift => shift.employeeId === employee.id && shift.date === previousDate && shift.code === 'close') || result.shifts.some(shift => shift.employeeId === employee.id && shift.date === previousDate && shift.code === 'close'), true, `${employee.name} closes on consecutive dates through ${date}`)
      }
    }
  }
})
test('manual validation flags consecutive regular closings starting November 2026', () => {
  const input = base()
  input.month = '2026-11'
  const shifts = [{ employeeId: 1, date: '2026-11-03', code: 'close' }, { employeeId: 1, date: '2026-11-04', code: 'close' }]
  const result = validateSchedule({ ...input, shifts })
  assert.ok(result.issues.some(issue => issue.text === '직원1: 2026-11-04 정규직 마감 연속 배정'))
  const octoberResult = validateSchedule({ ...input, month: '2026-10', shifts: [{ ...shifts[0], date: '2026-10-03' }, { ...shifts[1], date: '2026-10-04' }] })
  assert.ok(!octoberResult.issues.some(issue => issue.text.includes('마감 연속 배정')))
})
test('rebalance keeps locked cells and prioritizes regular coverage on requested dates', async () => {
  const input = { ...base(), month: '2026-10', lockedThroughDate: '2026-10-08' }
  const initial = await generateSchedule(input)
  const locked = initial.shifts.filter(s => s.date <= input.lockedThroughDate || (s.employeeId === 1 && s.date === '2026-10-10')).map(s => ({ ...s, locked: s.date > input.lockedThroughDate }))
  const result = await generateSchedule({ ...input, mode: 'rebalance', existingShifts: locked, prioritizeRegularCoverageDates: ['2026-10-10', '2026-10-16', '2026-10-21'] })
  verify(input, result)
  for (const prior of locked) assert.equal(result.shifts.find(s => s.employeeId === prior.employeeId && s.date === prior.date)?.code, prior.code)
  for (const date of ['2026-10-10', '2026-10-16', '2026-10-21']) for (const code of ['open', 'close']) {
    assert.ok(result.shifts.some(s => s.date === date && s.code === code && employees.find(e => e.id === s.employeeId)?.employmentType === '정규직'))
  }
})
test('rebalance prefers Jinhaegyeong or Chayongho over Ehwajin on regular-gap dates except the exclusion', async () => {
  const input = {
    ...base(), month: '2026-10', holidays: ['2026-10-05', '2026-10-09', '2026-10-12', '2026-10-26'],
    preferEmployeeOffOnRegularGap: { employeeId: 2, excludedDates: ['2026-10-17'] },
  }
  const result = await generateSchedule(input)
  assert.equal(result.error, undefined)
  const gaps = new Set(result.warnings.flatMap(warning => [...warning.matchAll(/(2026-10-\d{2}) (?:오픈|마감) 정규직 없음/g)].map(match => match[1])))
  assert.ok(gaps.size > 0)
  for (const date of gaps) {
    if (date === '2026-10-17') continue
    assert.notEqual(result.shifts.find(shift => shift.employeeId === 2 && shift.date === date)?.code, 'open')
    assert.notEqual(result.shifts.find(shift => shift.employeeId === 2 && shift.date === date)?.code, 'close')
  }
})
test('weekday and holiday targets are five and four, with fallback-only staffing warnings', async () => {
  assert.equal(minimumWorkersForDate('2026-09-30'), 3)
  assert.equal(fallbackMinimumWorkersForDate('2026-09-30'), 3)
  assert.equal(minimumWorkersForDate('2026-10-08', ['2026-10-09']), 5)
  assert.equal(minimumWorkersForDate('2026-10-09', ['2026-10-09']), 4)
  assert.equal(minimumWorkersForDate('2026-10-10', ['2026-10-09']), 4)
  assert.equal(fallbackMinimumWorkersForDate('2026-10-08', ['2026-10-09']), 4)
  assert.equal(fallbackMinimumWorkersForDate('2026-10-10', ['2026-10-09']), 3)
  assert.equal(minimumWorkersForDate('2026-11-02', ['2026-11-03']), 5)
  assert.equal(minimumWorkersForDate('2026-11-01', ['2026-11-03']), 4)
  assert.equal(minimumWorkersForDate('2026-11-03', ['2026-11-03']), 4)
  assert.equal(fallbackMinimumWorkersForDate('2026-11-03', ['2026-11-03']), 3)
  const fixedDay = '2026-10-12'
  const existingShifts = employees.map(employee => ({ employeeId: employee.id, date: fixedDay, code: employee.id <= 3 ? 'off' : employee.id % 2 === 0 ? 'open' : 'close', locked: true }))
  const input = { ...base(), month: '2026-10', holidays: ['2026-10-09'], mode: 'rebalance', lockedThroughDate: '2026-10-08', existingShifts }
  const result = await generateSchedule(input)
  assert.equal(result.error, undefined)
  assert.equal(result.warnings.some(warning => warning.includes(`${fixedDay} 최소 근무인원 미충족`)), false)
  assert.equal(result.shifts.filter(shift => shift.date === fixedDay && ['open', 'close'].includes(shift.code)).length, 4)
  assert.deepEqual(validateSchedule({ ...input, shifts: result.shifts }).issues.filter(issue => issue.date === fixedDay && issue.text.includes('최소 근무인원 미충족')).map(issue => issue.text), [])
})
test('October staffing never drops below the relaxed threshold when three people can cover a fixed Sunday', async () => {
  const fixedDay = '2026-10-17'
  const existingShifts = employees.map(employee => ({ employeeId: employee.id, date: fixedDay, code: employee.id === 1 || employee.id === 3 || employee.id === 4 || employee.id === 5 ? 'off' : employee.id === 6 ? 'open' : 'close', locked: true }))
  const input = { ...base(), month: '2026-10', mode: 'rebalance', lockedThroughDate: '2026-10-08', existingShifts }
  const result = await generateSchedule(input)
  assert.equal(result.error, undefined)
  assert.equal(result.shifts.filter(shift => shift.date === fixedDay && ['open', 'close'].includes(shift.code)).length, 3)
  assert.equal(result.warnings.some(warning => warning.includes(`${fixedDay} 최소 근무인원 미충족`)), false)
  const belowFallback = employees.map(employee => ({ employeeId: employee.id, date: fixedDay, code: employee.id === 1 ? 'open' : employee.id === 7 ? 'close' : 'off' }))
  assert.ok(validateSchedule({ ...input, shifts: belowFallback }).issues.some(issue => issue.text === `${fixedDay} 최소 근무인원 미충족 (2명 / 완화 기준 3명)`))
})
test('minimum staffing remains feasible when regular-only capacity is short', async () => {
  const input = { ...base(), month: '2026-10', holidays: ['2026-10-05', '2026-10-09'] }
  const result = await generateSchedule(input)
  assert.equal(result.error, undefined)
  assert.ok(result.warnings.some(warning => /정규직 오픈·마감 배치가 .*회 부족/.test(warning)))
  for (const date of monthDates(input.month)) assert.ok(result.shifts.filter(s => s.date === date && ['open', 'close'].includes(s.code)).length >= 3)
  for (const employee of input.employees) assert.equal(result.shifts.filter(s => s.employeeId === employee.id && s.code === 'off').length, result.targetRestDays)
})
test('November default keeps the staffing floor and balances daily open and close teams', async () => {
  const input = { ...base(), month: '2026-11', holidays: ['2026-11-03'] }
  const result = await generateSchedule(input)
  assert.equal(result.error, undefined)
  for (const date of monthDates(input.month)) {
    const day = result.shifts.filter(shift => shift.date === date)
    const working = day.filter(shift => shift.code === 'open' || shift.code === 'close').length
    const opens = day.filter(shift => shift.code === 'open').length
    const closes = day.filter(shift => shift.code === 'close').length
    assert.ok(working >= fallbackMinimumWorkersForDate(date, input.holidays), `${date} below fallback floor`)
    assert.ok(Math.abs(opens - closes) <= 1, `${date} open/close teams are imbalanced: ${opens}/${closes}`)
  }
})
test('November balancing compares weekend rest with the previous month', async () => {
  const priorOffDates = ['2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11']
  const adjacentShifts = employees.flatMap(employee => priorOffDates.map(date => ({ employeeId: employee.id, date, code: employee.id === 1 ? 'off' : 'open' })))
  const input = { ...base(), month: '2026-11', holidays: [], adjacentShifts }
  const result = await generateSchedule(input)
  verify(input, result)
  const combinedWeekendOff = employees.map(employee => adjacentShifts.filter(shift => shift.employeeId === employee.id && shift.code === 'off').length + result.shifts.filter(shift => shift.employeeId === employee.id && shift.code === 'off' && [0, 6].includes(new Date(`${shift.date}T00:00:00Z`).getUTCDay())).length)
  assert.ok(Math.max(...combinedWeekendOff) - Math.min(...combinedWeekendOff) <= 3, `combined weekend rest is uneven: ${combinedWeekendOff.join(', ')}`)
})
test('fixed work contradicting required rest fails instead of replacing it', async () => {
  const input = base()
  input.employees[5].workRules.offRules = [{ weekday: 5, occurrences: [2, 4] }]
  const result = await generateSchedule({ ...input, mode: 'fill', existingShifts: [{ employeeId: 6, date: '2026-02-13', code: 'open' }] })
  assert.match(result.error, /정기휴무와 충돌/)
})
test('cross-month week includes already assigned adjacent rest', async () => {
  const input = base()
  input.adjacentShifts = input.employees.flatMap(e => ['2026-01-30', '2026-01-31'].map(date => ({ employeeId: e.id, date, code: 'off' })))
  const result = await generateSchedule(input)
  verify(input, result)
  assert.ok(!validateSchedule({ ...input, shifts: result.shifts }).pending.some(p => p.text.includes('2026-01-26')))
})
test('holiday weekends count once; leap days and real dates validate', () => {
  assert.equal(restTarget(monthDates('2026-02'), ['2026-02-01', '2026-02-02']), 9)
  assert.equal(monthDates('2028-02').length, 29)
  assert.equal(validDate('2026-02-30'), false)
  assert.equal(validDate('2028-02-29'), true)
  assert.throws(() => normalizeRules({ allowedShifts: [], offRules: [] }))
})
