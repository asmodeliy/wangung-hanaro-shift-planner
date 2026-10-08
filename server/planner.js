import GLPK from 'glpk.js/node'

export const codes = ['open', 'close', 'off']
export const defaultRules = { allowedShifts: ['open', 'close'], offRules: [] }
export function normalizeRules(value = defaultRules) {
  const allowedShifts = value.allowedShifts
  const offRules = value.offRules ?? []
  if (!Array.isArray(allowedShifts) || !allowedShifts.length || allowedShifts.some(code => !['open', 'close'].includes(code))) throw new Error('가능한 근무를 하나 이상 선택해 주세요.')
  if (!Array.isArray(offRules) || offRules.length > 14 || offRules.some(rule => !Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6 || !Array.isArray(rule.occurrences) || !rule.occurrences.length || rule.occurrences.some(n => !Number.isInteger(n) || n < 1 || n > 5))) throw new Error('정기휴무 요일과 순서를 확인해 주세요.')
  return { allowedShifts: [...new Set(allowedShifts)], offRules: offRules.map(rule => ({ weekday: rule.weekday, occurrences: [...new Set(rule.occurrences)].sort() })) }
}
export function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
}
export function seoulDateKey(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
export function monthDates(month) {
  const [year, number] = month.split('-').map(Number)
  return Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}
export function isRequiredOff(employee, date) {
  const day = new Date(`${date}T00:00:00Z`)
  return (employee.workRules ?? defaultRules).offRules.some(rule => rule.weekday === day.getUTCDay() && rule.occurrences.includes(Math.floor((day.getUTCDate() - 1) / 7) + 1))
}
export function weekDates(date) {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7)
  return Array.from({ length: 7 }, (_, i) => new Date(day.getTime() + i * 86400000).toISOString().slice(0, 10))
}
export function restTarget(dates, holidays) {
  const holidaySet = new Set(holidays.map(item => typeof item === 'string' ? item : item.date))
  return dates.filter(date => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) || holidaySet.has(date)).length
}
export function minimumWorkersForDate(date, holidays = []) {
  if (date < '2026-10-01') return 3
  const holidaySet = new Set(holidays.map(item => typeof item === 'string' ? item : item.date))
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return weekday === 0 || weekday === 6 || holidaySet.has(date) ? 4 : 5
}
export function fallbackMinimumWorkersForDate(date, holidays = []) {
  if (date < '2026-10-01') return 3
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const isHoliday = holidays.some(item => (typeof item === 'string' ? item : item.date) === date)
  return weekday === 0 || weekday === 6 || isHoliday ? 3 : 4
}
export function validateSchedule({ month, employees, settings, holidays, shifts, adjacentShifts = [] }) {
  const dates = monthDates(month)
  const target = restTarget(dates, holidays)
  const entries = new Map([...adjacentShifts, ...shifts].map(s => [`${s.employeeId}:${s.date}`, s.code]))
  const issues = []
  const pending = []
  const stats = []
  for (const date of dates) {
    const workingCount = employees.filter(e => ['open', 'close'].includes(entries.get(`${e.id}:${date}`))).length
    const fallback = fallbackMinimumWorkersForDate(date, holidays)
    if (workingCount < fallback) issues.push({ date, text: `${date} 최소 근무인원 미충족 (${workingCount}명 / 완화 기준 ${fallback}명)` })
    for (const code of ['open', 'close']) if (!employees.some(e => e.employmentType === '정규직' && entries.get(`${e.id}:${date}`) === code)) issues.push({ date, text: `${date} ${code === 'open' ? '오픈' : '마감'} 정규직 없음` })
    for (const pair of settings.daysOffPairs) if (pair.employeeIds.every(id => employees.some(e => e.id === id)) && pair.employeeIds.every(id => entries.get(`${id}:${date}`) === 'off')) issues.push({ date, text: `${date} 동시휴무 제한 위반` })
  }
  for (const employee of employees) {
    const rule = employee.workRules ?? defaultRules
    const counts = Object.fromEntries(codes.map(code => [code, dates.filter(date => entries.get(`${employee.id}:${date}`) === code).length]))
    stats.push({ employeeId: employee.id, target, ...counts })
    if (counts.off !== target) issues.push({ employeeId: employee.id, text: `${employee.name}: 기준휴무 ${target}일 / 배정 ${counts.off}일` })
    for (const date of dates) {
      const code = entries.get(`${employee.id}:${date}`)
      if (!code) issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 미편성` })
      else if (code !== 'off' && !rule.allowedShifts.includes(code)) issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 불가능한 근무 배정` })
      if (isRequiredOff(employee, date) && code !== 'off') issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 정기휴무 필요` })
    }
  }
  return { targetRestDays: target, issues, pending, stats }
}

export async function generateSchedule(input) {
  const { month, employees, settings, holidays, existingShifts = [], adjacentShifts = [], adjacentHolidays = [], mode = 'replace' } = input
  const glpk = await GLPK()
  const dates = monthDates(month)
  const target = restTarget(dates, holidays)
  const previousMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7)
  if (!employees.length) return { error: '재직 중인 직원을 먼저 등록해 주세요.' }
  if (employees.length < 3) return { error: '하루 최소 3명 근무 조건을 적용하려면 재직 직원이 3명 이상 필요합니다.' }
  const lp = { name: 'monthly_shifts', objective: { direction: glpk.GLP_MIN, name: 'preferences_and_balance', vars: [] }, subjectTo: [], binaries: [], bounds: [] }
  let index = 0
  const add = (vars, type, lb, ub) => lp.subjectTo.push({ name: `c${index++}`, vars, bnds: { type, lb, ub } })
  const variable = (id, date, code, coef = 1) => ({ name: `s_${id}_${date.replaceAll('-', '')}_${code}`, coef })
  const eq = (vars, value) => add(vars, glpk.GLP_FX, value, value)
  const lo = (vars, value) => add(vars, glpk.GLP_LO, value, 0)
  const up = (vars, value) => add(vars, glpk.GLP_UP, 0, value)
  const lockedThroughDate = input.lockedThroughDate ?? seoulDateKey()
  const fixed = new Map(existingShifts.filter(s => mode === 'fill' || s.date <= lockedThroughDate || (mode === 'rebalance' && s.locked)).map(s => [`${s.employeeId}:${s.date}`, s.code]))
  const weeks = [...new Map(dates.map(date => [weekDates(date)[0], weekDates(date)])).values()]
  const requests = (input.requests ?? []).filter(r => r.status !== 'rejected' && employees.some(e => e.id === r.employeeId) && dates.includes(r.date))
  const regularStaffingSlacks = []
  const dailyStaffingSlacks = []
  const fallbackStaffingSlacks = []
  const dailyShiftImbalanceSlacks = []
  for (const employee of employees) {
    const existingOffDates = dates.filter(date => fixed.get(`${employee.id}:${date}`) === 'off')
    const requiredOffDates = dates.filter(date => isRequiredOff(employee, date))
    const overlapDates = existingOffDates.filter(date => requiredOffDates.includes(date))
    const pinnedOffDates = [...new Set([...existingOffDates, ...requiredOffDates])]
    if (pinnedOffDates.length > target) {
      const dateList = requiredOffDates.length ? ` 정기휴무 날짜: ${requiredOffDates.join(', ')}.` : ''
      return { error: `${employee.name}: 기존 휴무 ${existingOffDates.length}일과 정기휴무 ${requiredOffDates.length}일 중 겹치는 ${overlapDates.length}일을 제외하면 총 ${pinnedOffDates.length}일로, 월 기준 ${target}일보다 ${pinnedOffDates.length - target}일 많습니다.${dateList} 기존 근무표는 수정하지 않았습니다. 빈칸을 채우려면 기존 휴무 또는 정기휴무를 조정해 주세요.` }
    }
    const conflict = dates.find(date => isRequiredOff(employee, date) && fixed.has(`${employee.id}:${date}`) && fixed.get(`${employee.id}:${date}`) !== 'off')
    if (conflict) return { error: `${employee.name}: ${conflict} 기존 배정이 정기휴무와 충돌합니다. 해당 칸을 비우거나 수정해 주세요.` }
  }
  // Preferences are optimized only after all staffing, rest and employee rules hold.
  const preferenceScale = 1000 * employees.length * dates.length
  const approvedWeight = requests.length + 1
  for (const employee of employees) {
    const rules = employee.workRules ?? defaultRules
    for (const date of dates) {
      const vars = codes.map(code => variable(employee.id, date, code))
      lp.binaries.push(...vars.map(v => v.name))
      eq(vars, 1)
      for (const code of ['open', 'close']) if (!rules.allowedShifts.includes(code)) eq([variable(employee.id, date, code)], 0)
      if (isRequiredOff(employee, date)) eq([variable(employee.id, date, 'off')], 1)
      const pinned = fixed.get(`${employee.id}:${date}`)
      if (pinned) eq([variable(employee.id, date, pinned)], 1)
      // Small random tie-break permits a different, equally valid regeneration.
      lp.objective.vars.push(variable(employee.id, date, 'open', Math.random() * 0.001))
    }
    eq(dates.map(date => variable(employee.id, date, 'off')), target)
    for (const week of weeks) {
      const inside = week.filter(date => dates.includes(date))
      const vars = inside.map(date => variable(employee.id, date, 'off'))
      const spread = `spread_${employee.id}_${week[0].replaceAll('-', '')}`
      const expectedOff = target * inside.length / dates.length
      lp.bounds.push({ name: spread, type: glpk.GLP_LO, lb: 0, ub: 0 })
      up([...vars, { name: spread, coef: -1 }], expectedOff)
      lo([...vars, { name: spread, coef: 1 }], expectedOff)
      lp.objective.vars.push({ name: spread, coef: 2500 })
    }
    const deviation = `balance_${employee.id}`
    const priorBalance = adjacentShifts.filter(shift => shift.employeeId === employee.id && shift.date.startsWith(`${previousMonth}-`)).reduce((sum, shift) => sum + (shift.code === 'open' ? 1 : shift.code === 'close' ? -1 : 0), 0)
    const balance = dates.flatMap(date => [variable(employee.id, date, 'open', 1), variable(employee.id, date, 'close', -1)])
    lo([...balance, { name: deviation, coef: 1 }], -priorBalance)
    lo([...balance.map(v => ({ ...v, coef: -v.coef })), { name: deviation, coef: 1 }], priorBalance)
    lp.bounds.push({ name: deviation, type: glpk.GLP_LO, lb: 0, ub: 0 })
    lp.objective.vars.push({ name: deviation, coef: 1 })
  }
  for (const request of requests) lp.objective.vars.push(variable(request.employeeId, request.date, 'off', -preferenceScale * (request.status === 'approved' ? approvedWeight : 1)))
  const addFairnessPenalty = (name, expression, constant, target, weight) => {
    const deviation = `fair_${name}`
    lp.bounds.push({ name: deviation, type: glpk.GLP_LO, lb: 0, ub: 0 })
    up([...expression, { name: deviation, coef: -1 }], target - constant)
    up([...expression.map(item => ({ ...item, coef: -item.coef })), { name: deviation, coef: -1 }], constant - target)
    lp.objective.vars.push({ name: deviation, coef: weight })
  }
  const priorShifts = adjacentShifts.filter(shift => shift.date.startsWith(`${previousMonth}-`))
  const priorHolidays = new Set(adjacentHolidays.filter(item => (typeof item === 'string' ? item : item.date).startsWith(`${previousMonth}-`)).map(item => typeof item === 'string' ? item : item.date))
  for (const shift of priorShifts) if ([0, 6].includes(new Date(`${shift.date}T00:00:00Z`).getUTCDay())) priorHolidays.add(shift.date)
  const currentHolidayDates = dates.filter(date => priorHolidays.has(date) || [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) || holidays.some(item => (typeof item === 'string' ? item : item.date) === date))
  for (const employee of employees) lp.objective.vars.push({ name: `balance_${employee.id}`, coef: 5000 })
  const priorOffTotal = employees.reduce((sum, employee) => sum + priorShifts.filter(shift => shift.employeeId === employee.id && shift.code === 'off' && priorHolidays.has(shift.date)).length, 0)
  const expectedCurrentHolidayOff = employees.length * target * currentHolidayDates.length / dates.length
  const holidayOffTarget = (priorOffTotal + expectedCurrentHolidayOff) / employees.length
  for (const employee of employees) {
    const baseline = priorShifts.filter(shift => shift.employeeId === employee.id && shift.code === 'off' && priorHolidays.has(shift.date)).length
    addFairnessPenalty(`${employee.id}_holiday_off`, currentHolidayDates.map(date => variable(employee.id, date, 'off')), baseline, holidayOffTarget, 8000)
  }
  for (const date of dates) {
    const dayKey = date.replaceAll('-', '')
    const shiftImbalance = `open_close_imbalance_${dayKey}`
    lp.bounds.push({ name: shiftImbalance, type: glpk.GLP_LO, lb: 0, ub: 0 })
    dailyShiftImbalanceSlacks.push({ name: shiftImbalance, coef: 1 })
    lo([...employees.map(employee => variable(employee.id, date, 'open')), ...employees.map(employee => ({ ...variable(employee.id, date, 'close'), coef: -1 })), { name: shiftImbalance, coef: 1 }], 0)
    lo([...employees.map(employee => variable(employee.id, date, 'close')), ...employees.map(employee => ({ ...variable(employee.id, date, 'open'), coef: -1 })), { name: shiftImbalance, coef: 1 }], 0)
    const staffingShortfall = `missing_staff_${dayKey}`
    lp.bounds.push({ name: staffingShortfall, type: glpk.GLP_LO, lb: 0, ub: 0 })
    dailyStaffingSlacks.push({ name: staffingShortfall, coef: 1 })
    lo([...employees.flatMap(employee => ['open', 'close'].map(code => variable(employee.id, date, code))), { name: staffingShortfall, coef: 1 }], minimumWorkersForDate(date, holidays))
    const fallbackShortfall = `missing_fallback_staff_${dayKey}`
    lp.bounds.push({ name: fallbackShortfall, type: glpk.GLP_LO, lb: 0, ub: 0 })
    fallbackStaffingSlacks.push({ name: fallbackShortfall, coef: 1 })
    lo([...employees.flatMap(employee => ['open', 'close'].map(code => variable(employee.id, date, code))), { name: fallbackShortfall, coef: 1 }], fallbackMinimumWorkersForDate(date, holidays))
    for (const code of ['open', 'close']) {
      const slack = `missing_regular_${date.replaceAll('-', '')}_${code}`
      lp.binaries.push(slack)
      regularStaffingSlacks.push({ name: slack, coef: 1 })
      // Preserve both shifts, even if the monthly rest quota makes regular-only coverage impossible.
      lo(employees.map(e => variable(e.id, date, code)), 1)
      lo([...employees.filter(e => e.employmentType === '정규직').map(e => variable(e.id, date, code)), { name: slack, coef: 1 }], 1)
    }
    for (const pair of settings.daysOffPairs) if (pair.employeeIds.length === 2 && pair.employeeIds.every(id => employees.some(e => e.id === id))) up(pair.employeeIds.map(id => variable(id, date, 'off')), 1)
  }
  const staffingSolution = glpk.solve({ ...lp, objective: { direction: glpk.GLP_MIN, name: 'fallback_then_target_staffing_shortfall_then_regular_gaps', vars: [...fallbackStaffingSlacks.map(item => ({ ...item, coef: 1_000_000_000 })), ...dailyStaffingSlacks.map(item => ({ ...item, coef: 1_000_000 })), ...regularStaffingSlacks.map(item => ({ ...item, coef: 1_000 }))] } }, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: 12, mipgap: 0 })
  if (![glpk.GLP_OPT, glpk.GLP_FEAS].includes(staffingSolution.result.status)) return { error: staffingSolution.result.status === glpk.GLP_NOFEAS ? '월별 휴무, 주간 휴무, 직원별 정기휴무 및 기존 배정을 동시에 만족할 수 없습니다. 기존 근무표는 유지됩니다.' : '제한 시간 안에 조건을 만족하는 기본 근무표를 찾지 못했습니다. 기존 근무표는 유지됩니다.' }
  const minimumStaffingGaps = Math.round(regularStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
  const minimumDailyStaffingShortfall = Math.round(dailyStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
  const minimumFallbackStaffingShortfall = Math.round(fallbackStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
  eq(fallbackStaffingSlacks, minimumFallbackStaffingShortfall)
  eq(regularStaffingSlacks, minimumStaffingGaps)
  eq(dailyStaffingSlacks, minimumDailyStaffingShortfall)
  for (const item of dailyShiftImbalanceSlacks) lp.objective.vars.push({ ...item, coef: 2_000_000 })
  for (const date of input.prioritizeRegularCoverageDates ?? []) {
    if (!dates.includes(date)) continue
    for (const code of ['open', 'close']) lp.objective.vars.push({ name: `missing_regular_${date.replaceAll('-', '')}_${code}`, coef: 25_000_000 })
  }
  const gapPreference = input.preferEmployeeOffOnRegularGap
  const gapEmployee = employees.find(employee => employee.id === gapPreference?.employeeId && employee.employmentType === '정규직')
  if (gapEmployee) {
    const excludedDates = new Set(gapPreference.excludedDates ?? [])
    for (const date of dates) {
      if (excludedDates.has(date)) continue
      const dayKey = date.replaceAll('-', '')
      const gap = `regular_gap_${dayKey}`
      const worksDuringGap = `preferred_employee_works_on_gap_${dayKey}`
      const openGap = `missing_regular_${dayKey}_open`
      const closeGap = `missing_regular_${dayKey}_close`
      lp.binaries.push(gap, worksDuringGap)
      // gap is the OR of the day's open/close regular-staffing gaps.
      lo([{ name: gap, coef: 1 }, { name: openGap, coef: -1 }], 0)
      lo([{ name: gap, coef: 1 }, { name: closeGap, coef: -1 }], 0)
      up([{ name: gap, coef: 1 }, { name: openGap, coef: -1 }, { name: closeGap, coef: -1 }], 0)
      const works = ['open', 'close'].map(code => variable(gapEmployee.id, date, code))
      // Penalize only when this employee works on a day with at least one gap.
      up([{ name: worksDuringGap, coef: 1 }, { name: gap, coef: -1 }], 0)
      up([{ name: worksDuringGap, coef: 1 }, ...works.map(v => ({ ...v, coef: -1 }))], 0)
      lo([{ name: worksDuringGap, coef: 1 }, { name: gap, coef: -1 }, ...works.map(v => ({ ...v, coef: -1 }))], -1)
      lp.objective.vars.push({ name: worksDuringGap, coef: 1_000_000 })
    }
  }
  const optimizedSolution = glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: 8, mipgap: 0 })
  const optimal = [glpk.GLP_OPT, glpk.GLP_FEAS].includes(optimizedSolution.result.status)
  const solution = optimal ? optimizedSolution : staffingSolution
  const shifts = employees.flatMap(employee => dates.map(date => ({ employeeId: employee.id, date, code: codes.find(code => solution.result.vars[variable(employee.id, date, code).name] > 0.5) })))
  const validation = validateSchedule({ ...input, shifts })
  const regularCoverageGaps = validation.issues.filter(issue => /^\d{4}-\d{2}-\d{2} (오픈|마감) 정규직 없음$/.test(issue.text))
  const dailyStaffingIssues = validation.issues.filter(issue => /^\d{4}-\d{2}-\d{2} 최소 근무인원 미충족/.test(issue.text))
  const hardIssues = validation.issues.filter(issue => !regularCoverageGaps.includes(issue) && !dailyStaffingIssues.includes(issue))
  if (hardIssues.length) return { error: `검증 실패: ${hardIssues.slice(0, 3).map(i => i.text).join(' · ')}` }
  const missedRequests = requests.filter(r => !shifts.some(s => s.employeeId === r.employeeId && s.date === r.date && s.code === 'off'))
  const regularStaffingGaps = regularCoverageGaps
  const staffingWarning = minimumStaffingGaps ? `${target}일 월 휴무를 유지해 정규직 오픈·마감 배치가 ${regularStaffingGaps.length}회 부족합니다. ${regularCoverageGaps.map(issue => issue.text).join(' · ')} 해당 근무는 가능한 직원으로 편성했습니다.` : ''
  return { shifts, targetRestDays: target, optimal, missedRequests, minimumDailyStaffingShortfall, minimumFallbackStaffingShortfall, warnings: [...dailyStaffingIssues.map(issue => issue.text), ...(staffingWarning ? [staffingWarning] : []), ...(!optimal ? ['기본 근무표에서 정규직 배치 부족은 최소화했지만 제한 시간으로 희망휴무와 근무 균등 배분을 최적화하지 못했습니다.'] : []), ...missedRequests.map(r => `${employees.find(e => e.id === r.employeeId).name}: ${r.date} 희망휴무 미반영 (필수조건 우선)`), ...validation.pending.map(i => i.text)] }
}
