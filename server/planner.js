import GLPK from 'glpk.js/node'

export const codes = ['open', 'close', 'off']
export const defaultRules = { allowedShifts: ['open', 'close'], offRules: [] }
export const defaultOperationRules = {
  weekdayTarget: 5, weekendTarget: 4, weekdayMinimum: 4, weekendMinimum: 3,
  functionalMinOnDuty: 2, supportMaxOff: 2, produceOpenCount: 0,
  requireRegularEachShift: true, maxConsecutiveWorkDays: 0,
  maxWishDaysPerEmployee: 0, supportMaxRequestsPerDate: 2, requestDueDay: 15, publishDay: 20,
}
function operationRules(settings) { return { ...defaultOperationRules, ...(settings?.operations ?? {}) } }
function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9
  return () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4294967296 }
}
function weekendOrHoliday(date, holidays = []) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return weekday === 0 || weekday === 6 || holidays.some(item => (typeof item === 'string' ? item : item.date) === date)
}
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
export function minimumWorkersForDate(date, holidays = [], operations) {
  if (!operations && date < '2026-10-01') return 3
  const rules = { ...defaultOperationRules, ...(operations ?? {}) }
  return weekendOrHoliday(date, holidays) ? rules.weekendTarget : rules.weekdayTarget
}
export function fallbackMinimumWorkersForDate(date, holidays = [], operations) {
  if (!operations && date < '2026-10-01') return 3
  const rules = { ...defaultOperationRules, ...(operations ?? {}) }
  return weekendOrHoliday(date, holidays) ? rules.weekendMinimum : rules.weekdayMinimum
}
export function validateSchedule({ month, employees, settings, holidays, shifts, adjacentShifts = [] }) {
  const dates = monthDates(month)
  const target = restTarget(dates, holidays)
  const entries = new Map([...adjacentShifts, ...shifts].map(s => [`${s.employeeId}:${s.date}`, s.code]))
  const issues = []
  const pending = []
  const warnings = []
  const stats = []
  const rules = operationRules(settings)
  const functionalEmployees = employees.filter(employee => employee.dutyType === 'functional')
  const supportEmployees = employees.filter(employee => employee.dutyType === 'support')
  const produceEmployees = employees.filter(employee => employee.produceQualified)
  for (const date of dates) {
    const workingCount = employees.filter(e => ['open', 'close'].includes(entries.get(`${e.id}:${date}`))).length
    const fallback = fallbackMinimumWorkersForDate(date, holidays, settings.operations)
    const preferred = minimumWorkersForDate(date, holidays, settings.operations)
    if (workingCount < fallback) issues.push({ date, text: `${date} 최소 근무인원 미충족 (${workingCount}명 / 완화 기준 ${fallback}명)` })
    else if (workingCount < preferred) warnings.push({ date, text: `${date} 권장 근무인원 미달 (${workingCount}명 / 목표 ${preferred}명, 최소 운영 기준 충족)` })
    for (const code of ['open', 'close']) if (rules.requireRegularEachShift && !employees.some(e => e.employmentType === '정규직' && entries.get(`${e.id}:${date}`) === code)) issues.push({ date, text: `${date} ${code === 'open' ? '오픈' : '마감'} 정규직 없음` })
    for (const pair of settings.daysOffPairs ?? []) if (pair.employeeIds.every(id => employees.some(e => e.id === id)) && pair.employeeIds.every(id => entries.get(`${id}:${date}`) === 'off')) issues.push({ date, text: `${date} 동시휴무 제한 위반` })
    const functionalOn = functionalEmployees.filter(employee => ['open', 'close'].includes(entries.get(`${employee.id}:${date}`))).length
    const supportOff = supportEmployees.filter(employee => entries.get(`${employee.id}:${date}`) === 'off').length
    const produceOpen = produceEmployees.filter(employee => entries.get(`${employee.id}:${date}`) === 'open').length
    if (rules.functionalMinOnDuty > 0 && functionalEmployees.length >= rules.functionalMinOnDuty && functionalOn < rules.functionalMinOnDuty) issues.push({ date, text: `${date} 일반직 출근 부족 (${functionalOn}명 / 필요 ${rules.functionalMinOnDuty}명)` })
    if (supportEmployees.length > 0 && supportOff > rules.supportMaxOff) issues.push({ date, text: `${date} 계약직 휴무 초과 (${supportOff}명 / 최대 ${rules.supportMaxOff}명)` })
    if (rules.produceOpenCount > 0 && !(settings.produceOpenExceptions ?? []).includes(date) && produceEmployees.length >= rules.produceOpenCount && produceOpen < rules.produceOpenCount) issues.push({ date, text: `${date} 농산 담당 오픈조 부족 (필요 ${rules.produceOpenCount}명)` })
  }
  for (const employee of employees) {
    const rule = employee.workRules ?? defaultRules
    const counts = Object.fromEntries(codes.map(code => [code, dates.filter(date => entries.get(`${employee.id}:${date}`) === code).length]))
    const weekendWork = dates.filter(date => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
      return (weekday === 0 || weekday === 6) && ['open', 'close'].includes(entries.get(`${employee.id}:${date}`))
    }).length
    let longestConsecutive = 0
    let currentConsecutive = 0
    const priorDate = new Date(`${dates[0]}T00:00:00Z`)
    priorDate.setUTCDate(priorDate.getUTCDate() - 1)
    while (entries.get(`${employee.id}:${priorDate.toISOString().slice(0, 10)}`) === 'open' || entries.get(`${employee.id}:${priorDate.toISOString().slice(0, 10)}`) === 'close') {
      currentConsecutive++
      priorDate.setUTCDate(priorDate.getUTCDate() - 1)
    }
    longestConsecutive = currentConsecutive
    for (const date of dates) {
      if (['open', 'close'].includes(entries.get(`${employee.id}:${date}`))) {
        currentConsecutive++
        longestConsecutive = Math.max(longestConsecutive, currentConsecutive)
      } else currentConsecutive = 0
    }
    if (rules.maxConsecutiveWorkDays > 0 && longestConsecutive > rules.maxConsecutiveWorkDays) issues.push({ employeeId: employee.id, text: `${employee.name}: 최장 연속근무 ${longestConsecutive}일 (설정 ${rules.maxConsecutiveWorkDays}일 초과)` })
    stats.push({ employeeId: employee.id, target, ...counts, weekendWork, longestConsecutive })
    if (counts.off !== target) issues.push({ employeeId: employee.id, text: `${employee.name}: 기준휴무 ${target}일 / 배정 ${counts.off}일` })
    for (const date of dates) {
      const code = entries.get(`${employee.id}:${date}`)
      if (!code) issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 미편성` })
      else if (code !== 'off' && !rule.allowedShifts.includes(code)) issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 불가능한 근무 배정` })
      if (isRequiredOff(employee, date) && code !== 'off') issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 정기휴무 필요` })
    }
  }
  return { targetRestDays: target, issues, pending, warnings, stats }
}

function fallbackAssignments({ month, employees, settings, holidays, existingShifts, lockedThroughDate, mode, seed }) {
  const random = seededRandom(seed)
  const dates = monthDates(month)
  const target = restTarget(dates, holidays)
  const operations = operationRules(settings)
  const fixed = new Map(existingShifts.filter(s => mode === 'fill' || s.date <= lockedThroughDate || (mode === 'rebalance' && s.locked)).map(s => [`${s.employeeId}:${s.date}`, s.code]))
  const cells = new Map()
  for (const employee of employees) for (const date of dates) {
    const key = `${employee.id}:${date}`
    const pinned = fixed.get(key)
    cells.set(key, pinned ?? (isRequiredOff(employee, date) ? 'off' : null))
  }
  const dayOffCount = date => employees.filter(employee => cells.get(`${employee.id}:${date}`) === 'off').length
  for (const employee of employees) {
    let count = dates.filter(date => cells.get(`${employee.id}:${date}`) === 'off').length
    while (count < target) {
      const candidates = dates.filter(date => !fixed.has(`${employee.id}:${date}`) && cells.get(`${employee.id}:${date}`) !== 'off' && !isRequiredOff(employee, date) && employees.length - dayOffCount(date) > fallbackMinimumWorkersForDate(date, holidays, settings?.operations))
      if (!candidates.length) break
      const tieBreak = new Map(candidates.map(date => [date, random()]))
      candidates.sort((a, b) => dayOffCount(b) - dayOffCount(a) || tieBreak.get(a) - tieBreak.get(b))
      cells.set(`${employee.id}:${candidates[0]}`, 'off')
      count++
    }
  }
  for (const date of dates) {
    const workers = employees.filter(employee => cells.get(`${employee.id}:${date}`) !== 'off')
    const hasShift = (employee, code) => cells.get(`${employee.id}:${date}`) === code
    for (const code of ['open', 'close']) if (operations.requireRegularEachShift && !employees.some(employee => employee.employmentType === '정규직' && hasShift(employee, code))) {
      const regular = workers.find(employee => employee.employmentType === '정규직' && !fixed.has(`${employee.id}:${date}`))
      if (regular) cells.set(`${regular.id}:${date}`, code)
    }
    while (operations.produceOpenCount > 0 && workers.filter(employee => employee.produceQualified && hasShift(employee, 'open')).length < operations.produceOpenCount) {
      const candidate = workers.find(employee => employee.produceQualified && !fixed.has(`${employee.id}:${date}`))
      if (!candidate) break
      cells.set(`${candidate.id}:${date}`, 'open')
    }
    let opens = employees.filter(employee => hasShift(employee, 'open')).length
    let closes = employees.filter(employee => hasShift(employee, 'close')).length
    for (const employee of workers) if (!cells.get(`${employee.id}:${date}`)) {
      const code = opens === closes ? (random() < 0.5 ? 'open' : 'close') : opens < closes ? 'open' : 'close'
      cells.set(`${employee.id}:${date}`, code)
      if (code === 'open') opens++; else closes++
    }
  }
  return employees.flatMap(employee => dates.map(date => ({ employeeId: employee.id, date, code: cells.get(`${employee.id}:${date}`) ?? 'open' })))
}

export async function generateSchedule(input) {
  const { month, employees, settings, holidays, existingShifts = [], adjacentShifts = [], adjacentHolidays = [], mode = 'replace' } = input
  const glpk = await GLPK()
  const dates = monthDates(month)
  const target = restTarget(dates, holidays)
  const rules = operationRules(settings)
  const random = seededRandom(input.seed)
  const previousMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7)
  const functionalEmployees = employees.filter(employee => employee.dutyType === 'functional')
  const supportEmployees = employees.filter(employee => employee.dutyType === 'support')
  const produceEmployees = employees.filter(employee => employee.produceQualified)
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
  const ruleViolationSlacks = []
  const weeklyRestSlacks = []
  const weekendFairnessSlacks = []
  // Preferences are optimized only after all staffing, rest and employee rules hold.
  const preferenceScale = 1000 * employees.length * dates.length
  const approvedWeight = requests.length + 1
  for (const employee of employees) {
    const rules = employee.workRules ?? defaultRules
    for (const date of dates) {
      const vars = codes.map(code => variable(employee.id, date, code))
      lp.binaries.push(...vars.map(v => v.name))
      eq(vars, 1)
      for (const code of ['open', 'close']) if (!rules.allowedShifts.includes(code)) ruleViolationSlacks.push(variable(employee.id, date, code))
      if (isRequiredOff(employee, date)) {
        const missed = `miss_required_off_${employee.id}_${date.replaceAll('-', '')}`
        lo([{ ...variable(employee.id, date, 'off'), coef: 1 }, { name: missed, coef: 1 }], 1)
        ruleViolationSlacks.push({ name: missed, coef: 1 })
      }
      const pinned = fixed.get(`${employee.id}:${date}`)
      if (pinned) eq([variable(employee.id, date, pinned)], 1)
      // Seeded tie-break keeps each alternative reproducible while exploring another valid arrangement.
      for (const code of codes) lp.objective.vars.push(variable(employee.id, date, code, random() * 0.1))
    }
    const monthlyOver = `monthly_rest_over_${employee.id}`
    const monthlyUnder = `monthly_rest_under_${employee.id}`
    lp.bounds.push({ name: monthlyOver, type: glpk.GLP_LO, lb: 0, ub: 0 }, { name: monthlyUnder, type: glpk.GLP_LO, lb: 0, ub: 0 })
    eq([...dates.map(date => variable(employee.id, date, 'off')), { name: monthlyUnder, coef: 1 }, { name: monthlyOver, coef: -1 }], target)
    ruleViolationSlacks.push({ name: monthlyOver, coef: 1 }, { name: monthlyUnder, coef: 1 })
    for (const week of weeks) {
      const inside = week.filter(date => dates.includes(date))
      const vars = inside.map(date => variable(employee.id, date, 'off'))
      const spread = `spread_${employee.id}_${week[0].replaceAll('-', '')}`
      const expectedOff = target * inside.length / dates.length
      lp.bounds.push({ name: spread, type: glpk.GLP_LO, lb: 0, ub: 0 })
      weeklyRestSlacks.push({ name: spread, coef: 1 })
      up([...vars, { name: spread, coef: -1 }], expectedOff)
      lo([...vars, { name: spread, coef: 1 }], expectedOff)
      lp.objective.vars.push({ name: spread, coef: 2500 })
    }
    if (operationRules(settings).maxConsecutiveWorkDays > 0) {
      const limit = operationRules(settings).maxConsecutiveWorkDays
      for (let startIndex = -limit; startIndex < dates.length; startIndex++) {
        let priorWork = 0
        const currentDates = []
        for (let offset = 0; offset <= limit; offset++) {
          const dayIndex = startIndex + offset
          if (dayIndex < 0) {
            const date = new Date(`${dates[0]}T00:00:00Z`)
            date.setUTCDate(date.getUTCDate() + dayIndex)
            const code = adjacentShifts.find(shift => shift.employeeId === employee.id && shift.date === date.toISOString().slice(0, 10))?.code
            if (code === 'open' || code === 'close') priorWork++
          } else if (dayIndex < dates.length) currentDates.push(dates[dayIndex])
        }
        if (currentDates.length) {
          const excess = `consecutive_excess_${employee.id}_${startIndex + limit + 1}`
          lp.bounds.push({ name: excess, type: glpk.GLP_LO, lb: 0, ub: 0 })
          up([...currentDates.flatMap(date => ['open', 'close'].map(code => variable(employee.id, date, code))), { name: excess, coef: -1 }], limit - priorWork)
          ruleViolationSlacks.push({ name: excess, coef: 1 })
        }
      }
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
    weekendFairnessSlacks.push({ name: deviation, coef: 1 })
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
    lo([...employees.flatMap(employee => ['open', 'close'].map(code => variable(employee.id, date, code))), { name: staffingShortfall, coef: 1 }], minimumWorkersForDate(date, holidays, settings.operations))
    const fallbackShortfall = `missing_fallback_staff_${dayKey}`
    lp.bounds.push({ name: fallbackShortfall, type: glpk.GLP_LO, lb: 0, ub: 0 })
    fallbackStaffingSlacks.push({ name: fallbackShortfall, coef: 1 })
    lo([...employees.flatMap(employee => ['open', 'close'].map(code => variable(employee.id, date, code))), { name: fallbackShortfall, coef: 1 }], fallbackMinimumWorkersForDate(date, holidays, settings.operations))
    for (const code of ['open', 'close']) {
      const slack = `missing_regular_${date.replaceAll('-', '')}_${code}`
      regularStaffingSlacks.push({ name: slack, coef: 1 })
      // Preserve both shifts, even if the monthly rest quota makes regular-only coverage impossible.
      lo(employees.map(e => variable(e.id, date, code)), 1)
      if (rules.requireRegularEachShift) lo([...employees.filter(e => e.employmentType === '정규직').map(e => variable(e.id, date, code)), { name: slack, coef: 1 }], 1)
    }
    if (rules.functionalMinOnDuty > 0 && functionalEmployees.length >= rules.functionalMinOnDuty) {
      const shortage = `functional_short_${dayKey}`
      lp.bounds.push({ name: shortage, type: glpk.GLP_LO, lb: 0, ub: 0 })
      lo([...functionalEmployees.flatMap(employee => ['open', 'close'].map(code => variable(employee.id, date, code))), { name: shortage, coef: 1 }], rules.functionalMinOnDuty)
      ruleViolationSlacks.push({ name: shortage, coef: 1 })
    }
    if (supportEmployees.length > 0) {
      const excess = `support_off_excess_${dayKey}`
      lp.bounds.push({ name: excess, type: glpk.GLP_LO, lb: 0, ub: 0 })
      up([...supportEmployees.map(employee => variable(employee.id, date, 'off')), { name: excess, coef: -1 }], rules.supportMaxOff)
      ruleViolationSlacks.push({ name: excess, coef: 1 })
    }
    if (rules.produceOpenCount > 0 && !(settings.produceOpenExceptions ?? []).includes(date) && produceEmployees.length >= rules.produceOpenCount) {
      const shortage = `produce_open_short_${dayKey}`
      lp.bounds.push({ name: shortage, type: glpk.GLP_LO, lb: 0, ub: 0 })
      lo([...produceEmployees.map(employee => variable(employee.id, date, 'open')), { name: shortage, coef: 1 }], rules.produceOpenCount)
      ruleViolationSlacks.push({ name: shortage, coef: 1 })
    }
    for (const [pairIndex, pair] of (settings.daysOffPairs ?? []).entries()) if (pair.employeeIds.length === 2 && pair.employeeIds.every(id => employees.some(e => e.id === id))) {
      const overlap = `paired_off_overlap_${pairIndex}_${dayKey}`
      lp.bounds.push({ name: overlap, type: glpk.GLP_LO, lb: 0, ub: 0 })
      up([...pair.employeeIds.map(id => variable(id, date, 'off')), { name: overlap, coef: -1 }], 1)
      ruleViolationSlacks.push({ name: overlap, coef: 1 })
    }
  }
  const timeLimit = input.alternativeSearch ? 2 : 12
  const staffingSolution = glpk.solve({ ...lp, objective: { direction: glpk.GLP_MIN, name: 'staffing_floors_then_rule_violations', vars: [...fallbackStaffingSlacks.map(item => ({ ...item, coef: 1_000_000_000 })), ...dailyStaffingSlacks.map(item => ({ ...item, coef: 1_000 })), ...ruleViolationSlacks.map(item => ({ ...item, coef: 10_000 })), ...dailyShiftImbalanceSlacks.map(item => ({ ...item, coef: 100 })), ...regularStaffingSlacks.map(item => ({ ...item, coef: 100 })), ...weeklyRestSlacks.map(item => ({ ...item, coef: 25 })), ...weekendFairnessSlacks.map(item => ({ ...item, coef: 25 }))] } }, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: timeLimit, mipgap: 0 })
  if (![glpk.GLP_OPT, glpk.GLP_FEAS].includes(staffingSolution.result.status)) {
    const shifts = fallbackAssignments({ month, employees, settings, holidays, existingShifts, lockedThroughDate, mode, seed: input.seed })
    const validation = validateSchedule({ ...input, shifts })
    return { shifts, targetRestDays: target, optimal: false, missedRequests: [], minimumDailyStaffingShortfall: 0, minimumFallbackStaffingShortfall: 0, warnings: [...validation.issues.map(issue => issue.text), ...validation.warnings.map(issue => issue.text), '자동편성 계산 한계에 도달해 기존 배정과 가능한 근무 인원을 기준으로 기본 근무표를 만들었습니다. 표시된 휴무·인원 기준을 확인해 주세요.'] }
  }
  const minimumStaffingGaps = Math.round(regularStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
  const minimumDailyStaffingShortfall = Math.round(dailyStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
  const minimumFallbackStaffingShortfall = Math.round(fallbackStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
  const minimumRuleViolations = Math.round(ruleViolationSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
  const minimumDailyImbalance = Math.round(dailyShiftImbalanceSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
  const minimumWeeklyRestSpread = weeklyRestSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0)
  const minimumWeekendFairnessDeviation = weekendFairnessSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0)
  eq(fallbackStaffingSlacks, minimumFallbackStaffingShortfall)
  eq(regularStaffingSlacks, minimumStaffingGaps)
  eq(dailyStaffingSlacks, minimumDailyStaffingShortfall)
  eq(ruleViolationSlacks, minimumRuleViolations)
  eq(dailyShiftImbalanceSlacks, minimumDailyImbalance)
  eq(weeklyRestSlacks, minimumWeeklyRestSpread)
  eq(weekendFairnessSlacks, minimumWeekendFairnessDeviation)
  lp.objective.vars.push(...ruleViolationSlacks)
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
  const optimizedSolution = glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: input.alternativeSearch ? 2 : 10, mipgap: 0 })
  const optimal = optimizedSolution.result.status === glpk.GLP_OPT
  const solution = optimal ? optimizedSolution : staffingSolution
  const shifts = employees.flatMap(employee => dates.map(date => ({ employeeId: employee.id, date, code: codes.find(code => solution.result.vars[variable(employee.id, date, code).name] > 0.5) })))
  const validation = validateSchedule({ ...input, shifts })
  const regularCoverageGaps = validation.issues.filter(issue => /^\d{4}-\d{2}-\d{2} (오픈|마감) 정규직 없음$/.test(issue.text))
  const dailyStaffingIssues = validation.issues.filter(issue => /^\d{4}-\d{2}-\d{2} 최소 근무인원 미충족/.test(issue.text))
  const missedRequests = requests.filter(r => !shifts.some(s => s.employeeId === r.employeeId && s.date === r.date && s.code === 'off'))
  const staffingWarning = regularCoverageGaps.length ? `${target}일 월 휴무를 유지해 정규직 오픈·마감 배치가 ${regularCoverageGaps.length}회 부족합니다. ${regularCoverageGaps.map(issue => issue.text).join(' · ')} 해당 근무는 가능한 직원으로 편성했습니다.` : ''
  return { shifts, targetRestDays: target, optimal, missedRequests, minimumDailyStaffingShortfall, minimumFallbackStaffingShortfall, warnings: [...validation.issues.map(issue => issue.text), ...validation.warnings.map(issue => issue.text), ...dailyStaffingIssues.map(issue => issue.text), ...(staffingWarning ? [staffingWarning] : []), ...(!optimal ? ['필수 운영 기준을 우선한 편성을 만들었습니다. 계산 시간 제한으로 희망휴무와 근무 형평성의 최종 조정은 완료되지 않았습니다.'] : []), ...missedRequests.map(r => `${employees.find(e => e.id === r.employeeId).name}: ${r.date} 희망휴무 미반영 (필수조건 우선)`), ...validation.pending.map(i => i.text)] }
}
