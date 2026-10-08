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
test('employment type staffing mode applies separate targets, floors, validation and generation', async () => {
  const operations = {
    ...base().settings.operations, staffingMode: 'employmentType',
    weekdayRegularTarget: 2, weekdayRegularMinimum: 1, weekdayContractTarget: 3, weekdayContractMinimum: 2,
    weekendRegularTarget: 2, weekendRegularMinimum: 1, weekendContractTarget: 2, weekendContractMinimum: 1,
  }
  assert.equal(minimumWorkersForDate('2026-02-02', [], operations), 5)
  assert.equal(fallbackMinimumWorkersForDate('2026-02-02', [], operations), 3)
  const date = '2026-02-02'
  const underContract = employees.map(employee => ({ employeeId: employee.id, date, code: employee.id <= 3 ? 'open' : employee.id === 4 ? 'close' : 'off' }))
  const validation = validateSchedule({ ...base(), settings: { ...base().settings, operations }, shifts: underContract })
  assert.ok(validation.issues.some(issue => issue.text.includes(`${date} 계약직 최소 인원 미충족`)))
  const input = { ...base(), settings: { ...base().settings, operations } }
  const result = await generateSchedule(input)
  assert.equal(result.error, undefined)
  const day = result.shifts.filter(shift => shift.date === date && ['open', 'close'].includes(shift.code))
  assert.ok(day.filter(shift => employees.find(employee => employee.id === shift.employeeId).employmentType === '정규직').length >= 1)
  assert.ok(day.filter(shift => employees.find(employee => employee.id === shift.employeeId).employmentType === '계약직').length >= 2)
  assert.deepEqual(validateSchedule({ ...input, shifts: result.shifts }).issues, [])
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
test('fixed work is preserved and a contradictory required rest is reported without blocking generation', async () => {
  const input = base()
  input.employees[5].workRules.offRules = [{ weekday: 5, occurrences: [2, 4] }]
  const result = await generateSchedule({ ...input, mode: 'fill', existingShifts: [{ employeeId: 6, date: '2026-02-13', code: 'open' }] })
  assert.equal(result.error, undefined)
  assert.equal(result.shifts.find(shift => shift.employeeId === 6 && shift.date === '2026-02-13').code, 'open')
  assert.ok(result.warnings.some(warning => warning.includes('정기휴무 필요')))
})
test('conflicting store staffing rules produce a best-effort schedule and identify the shortfalls', async () => {
  const input = {
    ...base(), month: '2026-10', holidays: ['2026-10-03', '2026-10-09'],
    employees: employees.map((employee, index) => ({ ...employee, dutyType: index < 3 ? 'functional' : 'support', produceQualified: false })),
    settings: {
      daysOffPairs: [{ employeeIds: [5, 6] }], weeklyRestPolicy: 'minimum',
      operations: { weekdayTarget: 5, weekendTarget: 4, weekdayMinimum: 4, weekendMinimum: 3, functionalMinOnDuty: 2, supportMaxOff: 2, produceOpenCount: 0, requireRegularEachShift: true },
    },
    mode: 'fill', lockedThroughDate: '2026-10-08',
    existingShifts: [{ employeeId: 3, date: '2026-10-19', code: 'open' }],
  }
  const result = await generateSchedule(input)
  assert.equal(result.error, undefined)
  assert.equal(result.shifts.length, 7 * 31)
  assert.equal(result.shifts.find(shift => shift.employeeId === 3 && shift.date === '2026-10-19').code, 'open')
  assert.ok(result.warnings.some(warning => warning.includes('기준휴무')))
  assert.ok(result.warnings.some(warning => warning.includes('권장 근무인원')))
  assert.ok(!result.warnings.some(warning => warning.includes('동시에 만족할 수 없습니다')))
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
test('manager produce-open exception is honored by schedule validation', () => {
  const input = {
    ...base(), month: '2026-10',
    employees: structuredClone(employees).map(employee => ({ ...employee, produceQualified: employee.id === 1 })),
    settings: { operations: { produceOpenCount: 1 }, produceOpenExceptions: [] },
    shifts: monthDates('2026-10').flatMap(date => employees.map(employee => ({ employeeId: employee.id, date, code: employee.id === 1 ? 'off' : 'open' }))),
  }
  assert.ok(validateSchedule(input).issues.some(issue => issue.date === '2026-10-01' && issue.text.includes('농산 담당 오픈조 부족')))
  input.settings.produceOpenExceptions = ['2026-10-01']
  assert.ok(!validateSchedule(input).issues.some(issue => issue.date === '2026-10-01' && issue.text.includes('농산 담당 오픈조 부족')))
})
