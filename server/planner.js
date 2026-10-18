import GLPK from 'glpk.js/node'

export const codes = ['open', 'close', 'full', 'off']
export const defaultRules = { allowedShifts: ['open', 'close'], offRules: [] }
export const defaultRulePriorities = { consecutiveClose: 1, fullCloseAdjacent: 2, daysOffPairs: 3, minimumStaffing: 4, regularCoverage: 5, weekendRegularFullShift: 6, monthlyRest: 7, employeeRules: 8, produceOpening: 9, produceCoverage: 3, functionalMinimum: 10, supportRestLimit: 11, approvedRequests: 12, pendingRequests: 13, maxConsecutiveWork: 14, weeklyRestBalance: 15, weekendRestFairness: 16, shiftRotation: 17, openCloseBalance: 18, fullShiftGeneration: 19 }
export const defaultOperationRules = {
  minimumEmployeesForGeneration: 3,
  monthlyRestMode: 'weekendHolidayCount', monthlyRestDays: 8,
  weekdayTarget: 5, weekendTarget: 4, weekdayMinimum: 4, weekendMinimum: 3,
  staffingMode: 'combined',
  weekdayRegularTarget: 2, weekdayRegularMinimum: 1, weekdayContractTarget: 3, weekdayContractMinimum: 3,
  weekendRegularTarget: 2, weekendRegularMinimum: 1, weekendContractTarget: 2, weekendContractMinimum: 2,
  functionalMinOnDuty: 2, supportMaxOff: 2, produceOpenCount: 0,
  requireRegularEachShift: true, weekendRegularFullShift: true, requireProduceOpener: true, preventSimultaneousProduceRest: true, noConsecutiveClose: true, noFullCloseAdjacent: true, maxConsecutiveWorkDays: 0,
  maxWishDaysPerEmployee: 0, supportMaxRequestsPerDate: 2, requestDueDay: 15, publishDay: 20,
  allowFullShiftGeneration: true, approvedWishWeight: 3, pendingWishWeight: 1,
  weeklyRestBalanceWeight: 100, weekendRestFairnessWeight: 100, shiftRotationWeight: 100, openCloseBalanceWeight: 100,
  rulePriorities: defaultRulePriorities,
}
function operationRules(settings) { return { ...defaultOperationRules, ...settings?.operations, rulePriorities: { ...defaultRulePriorities, ...settings?.operations?.rulePriorities } } }
const priorityFactor = (rules, key) => 1 + (19 - Math.max(1, Math.min(19, Number(rules.rulePriorities?.[key]) || defaultRulePriorities[key]))) * 0.2
// The close-rotation rules only apply to regular (일반직) staff.
const closeRotationApplies = employee => employee.employmentType === '정규직'
function shiftDay(date, offset) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + offset)
  return next.toISOString().slice(0, 10)
}
/** Describes why `next` may not follow `previous` for a regular employee, or returns null when the pair is allowed. */
export function closeRotationConflict(previous, next, rules) {
  if (rules.noConsecutiveClose && previous === 'close' && next === 'close') return '마감 연속 근무'
  if (rules.noFullCloseAdjacent && ((previous === 'full' && next === 'close') || (previous === 'close' && next === 'full'))) return '종일·마감 연속 배치'
  return null
}
function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9
  return () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4294967296 }
}
function weekendOrHoliday(date, holidays = []) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return weekday === 0 || weekday === 6 || holidays.some(item => (typeof item === 'string' ? item : item.date) === date)
}
function employmentStaffingRules(date, holidays, operations) {
  if (operations.staffingMode !== 'employmentType') return null
  const prefix = weekendOrHoliday(date, holidays) ? 'weekend' : 'weekday'
  return [
    { employmentType: '정규직', target: operations[`${prefix}RegularTarget`], minimum: operations[`${prefix}RegularMinimum`] },
    { employmentType: '계약직', target: operations[`${prefix}ContractTarget`], minimum: operations[`${prefix}ContractMinimum`] },
  ]
}
export function normalizeRules(value = defaultRules) {
  const allowedShifts = value.allowedShifts
  const offRules = value.offRules ?? []
  if (!Array.isArray(allowedShifts) || !allowedShifts.length || allowedShifts.some(code => !['open', 'close'].includes(code))) throw new Error('가능한 근무를 하나 이상 선택해 주세요.')
  if (!Array.isArray(offRules) || offRules.some(rule => !Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6 || !Array.isArray(rule.occurrences) || !rule.occurrences.length || rule.occurrences.some(n => !Number.isInteger(n) || n < 1 || n > 5))) throw new Error('정기휴무 요일과 순서를 확인해 주세요.')
  const occurrencesByWeekday = new Map()
  for (const rule of offRules) {
    const occurrences = occurrencesByWeekday.get(rule.weekday) ?? new Set()
    for (const occurrence of rule.occurrences) occurrences.add(occurrence)
    occurrencesByWeekday.set(rule.weekday, occurrences)
  }
  return { allowedShifts: [...new Set(allowedShifts)], offRules: [...occurrencesByWeekday].sort(([a], [b]) => a - b).map(([weekday, occurrences]) => ({ weekday, occurrences: [...occurrences].sort((a, b) => a - b) })) }
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
export function restTarget(dates, holidays, operations) {
  const rules = { ...defaultOperationRules, ...operations }
  if (rules.monthlyRestMode === 'fixed') return rules.monthlyRestDays
  const holidaySet = new Set(holidays.map(item => typeof item === 'string' ? item : item.date))
  return dates.filter(date => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) || holidaySet.has(date)).length
}
export function minimumWorkersForDate(date, holidays = [], operations) {
  const rules = { ...defaultOperationRules, ...operations }
  const separated = employmentStaffingRules(date, holidays, rules)
  if (separated) return separated.reduce((sum, rule) => sum + rule.target, 0)
  return weekendOrHoliday(date, holidays) ? rules.weekendTarget : rules.weekdayTarget
}
export function fallbackMinimumWorkersForDate(date, holidays = [], operations) {
  const rules = { ...defaultOperationRules, ...operations }
  const separated = employmentStaffingRules(date, holidays, rules)
  if (separated) return separated.reduce((sum, rule) => sum + rule.minimum, 0)
  return weekendOrHoliday(date, holidays) ? rules.weekendMinimum : rules.weekdayMinimum
}
export function validateSchedule({ month, employees, settings, holidays, shifts, adjacentShifts = [] }) {
  const dates = monthDates(month)
  const target = restTarget(dates, holidays, settings.operations)
  const entries = new Map([...adjacentShifts, ...shifts].map(s => [`${s.employeeId}:${s.date}`, s.code]))
  const issues = []
  const pending = []
  const warnings = []
  const stats = []
  const rules = operationRules(settings)
  const works = code => ['open', 'close', 'full'].includes(code)
  const covers = (assigned, shift) => assigned === shift || assigned === 'full'
  const functionalEmployees = employees.filter(employee => employee.dutyType === 'functional')
  const supportEmployees = employees.filter(employee => employee.dutyType === 'support')
  const produceEmployees = employees.filter(employee => employee.produceQualified)
  const produceBackups = employees.filter(employee => employee.produceBackup)
  const agriculturalEmployees = employees.filter(employee => employee.produceQualified || employee.produceBackup)
  for (const date of dates) {
    const workingCount = employees.filter(e => works(entries.get(`${e.id}:${date}`))).length
    const fallback = fallbackMinimumWorkersForDate(date, holidays, settings.operations)
    const preferred = minimumWorkersForDate(date, holidays, settings.operations)
    if (workingCount < fallback) issues.push({ date, text: `${date} 최소 근무인원 미충족 (${workingCount}명 / 완화 기준 ${fallback}명)` })
    else if (workingCount < preferred) warnings.push({ date, text: `${date} 권장 근무인원 미달 (${workingCount}명 / 목표 ${preferred}명, 최소 운영 기준 충족)` })
    for (const staffingRule of employmentStaffingRules(date, holidays, rules) ?? []) {
      const count = employees.filter(employee => employee.employmentType === staffingRule.employmentType && works(entries.get(`${employee.id}:${date}`))).length
      const label = staffingRule.employmentType
      if (count < staffingRule.minimum) issues.push({ date, text: `${date} ${label} 최소 인원 미충족 (${count}명 / 완화 기준 ${staffingRule.minimum}명)` })
      else if (count < staffingRule.target) warnings.push({ date, text: `${date} ${label} 목표 인원 미달 (${count}명 / 목표 ${staffingRule.target}명, 최소 기준 충족)` })
    }
    for (const code of ['open', 'close']) if (rules.requireRegularEachShift && !employees.some(e => e.employmentType === '정규직' && covers(entries.get(`${e.id}:${date}`), code))) issues.push({ date, text: `${date} ${code === 'open' ? '오픈' : '마감'} 정규직 없음` })
    if (rules.weekendRegularFullShift && rules.allowFullShiftGeneration && [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
      const regularFullCount = employees.filter(employee => employee.employmentType === '정규직' && entries.get(`${employee.id}:${date}`) === 'full').length
      if (regularFullCount > 1) issues.push({ date, text: `${date} 주말 정규직 종일근무 ${regularFullCount}명 (최대 1명)` })
    }
    for (const shift of shifts.filter(item => item.date === date && item.code === 'full')) {
      const employee = employees.find(item => item.id === shift.employeeId)
      const isWeekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())
      if (!rules.weekendRegularFullShift || !isWeekend || employee?.employmentType !== '정규직') {
        issues.push({ employeeId: shift.employeeId, date, text: `${employee?.name ?? `직원 ${shift.employeeId}`}: ${date} 종일근무는 주말 정규직만 가능합니다.` })
      }
    }
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (rules.weekendRegularFullShift && rules.allowFullShiftGeneration && (weekday === 6 || (weekday === 0 && !dates.includes(shiftDay(date, -1))))) {
      const saturdayKey = weekday === 6 ? date : shiftDay(date, -1)
      const sundayKey = weekday === 6 ? shiftDay(date, 1) : date
      for (const employee of employees.filter(employee => employee.employmentType === '정규직')) {
        if (entries.get(`${employee.id}:${saturdayKey}`) === 'full' && entries.get(`${employee.id}:${sundayKey}`) === 'full') {
          issues.push({ date: saturdayKey, text: `${saturdayKey}~${sundayKey} ${employee.name} 주말 연속 종일근무` })
        }
      }
    }
    for (const pair of settings.daysOffPairs ?? []) if (pair.employeeIds.every(id => employees.some(e => e.id === id)) && pair.employeeIds.every(id => entries.get(`${id}:${date}`) === 'off')) issues.push({ date, text: `${date} 동시휴무 제한 위반` })
    if (rules.preventSimultaneousProduceRest && agriculturalEmployees.length > 1 && agriculturalEmployees.every(employee => !works(entries.get(`${employee.id}:${date}`)))) issues.push({ date, text: `${date} 농산 담당·대직자 동시 휴무` })
    const functionalOn = functionalEmployees.filter(employee => works(entries.get(`${employee.id}:${date}`))).length
    const functionalFull = functionalEmployees.some(employee => entries.get(`${employee.id}:${date}`) === 'full')
    const supportOff = supportEmployees.filter(employee => entries.get(`${employee.id}:${date}`) === 'off').length
    const produceOpen = produceEmployees.filter(employee => covers(entries.get(`${employee.id}:${date}`), 'open')).length
    const backupOpen = produceBackups.filter(employee => covers(entries.get(`${employee.id}:${date}`), 'open')).length
    if (rules.requireProduceOpener && (produceEmployees.length || produceBackups.length) && !(settings.produceOpenExceptions ?? []).includes(date) && produceOpen + backupOpen === 0) issues.push({ date, text: `${date} 농산 담당자 또는 대직자 오픈 근무 없음` })
    if (rules.functionalMinOnDuty > 0 && functionalEmployees.length >= rules.functionalMinOnDuty && !functionalFull && functionalOn < rules.functionalMinOnDuty) issues.push({ date, text: `${date} 일반직 출근 부족 (${functionalOn}명 / 필요 ${rules.functionalMinOnDuty}명, 재직 일반직 ${functionalEmployees.length}명)` })
    if (supportEmployees.length > 0 && supportOff > rules.supportMaxOff) issues.push({ date, text: `${date} 계약직 휴무 초과 (${supportOff}명 / 최대 ${rules.supportMaxOff}명)` })
    if (rules.produceOpenCount > 0 && !(settings.produceOpenExceptions ?? []).includes(date) && produceEmployees.length >= rules.produceOpenCount && produceOpen < rules.produceOpenCount) issues.push({ date, text: `${date} 농산 담당 오픈조 부족 (${produceOpen}명 / 필요 ${rules.produceOpenCount}명, 재직 담당 ${produceEmployees.length}명)` })
  }
  if (rules.weekendRegularFullShift && rules.allowFullShiftGeneration) for (const employee of employees.filter(item => item.employmentType === '정규직')) {
    const fullByWeek = new Map()
    for (const shift of [...adjacentShifts, ...shifts].filter(item => item.employeeId === employee.id && item.code === 'full')) {
      const weekStart = weekDates(shift.date)[0]
      if (!fullByWeek.has(weekStart)) fullByWeek.set(weekStart, [])
      fullByWeek.get(weekStart).push(shift.date)
    }
    for (const [weekStart, fullDates] of fullByWeek) if (fullDates.length > 1 && fullDates.some(date => dates.includes(date))) {
      issues.push({ employeeId: employee.id, date: fullDates.at(-1), text: `${employee.name}: ${weekStart} 주간 종일근무 ${fullDates.length}회 (최대 1회)` })
    }
  }
  for (const employee of employees) {
    const rule = employee.workRules ?? defaultRules
    const counts = Object.fromEntries(codes.map(code => [code, dates.filter(date => entries.get(`${employee.id}:${date}`) === code).length]))
    counts.open += counts.full
    counts.close += counts.full
    const weekendWork = dates.filter(date => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
      return (weekday === 0 || weekday === 6) && works(entries.get(`${employee.id}:${date}`))
    }).length
    let longestConsecutive = 0
    let currentConsecutive = 0
    const priorDate = new Date(`${dates[0]}T00:00:00Z`)
    priorDate.setUTCDate(priorDate.getUTCDate() - 1)
    while (works(entries.get(`${employee.id}:${priorDate.toISOString().slice(0, 10)}`))) {
      currentConsecutive++
      priorDate.setUTCDate(priorDate.getUTCDate() - 1)
    }
    longestConsecutive = currentConsecutive
    for (const date of dates) {
      if (works(entries.get(`${employee.id}:${date}`))) {
        currentConsecutive++
        longestConsecutive = Math.max(longestConsecutive, currentConsecutive)
      } else currentConsecutive = 0
    }
    if (rules.maxConsecutiveWorkDays > 0 && longestConsecutive > rules.maxConsecutiveWorkDays) issues.push({ employeeId: employee.id, text: `${employee.name}: 최장 연속근무 ${longestConsecutive}일 (설정 ${rules.maxConsecutiveWorkDays}일 초과)` })
    if (closeRotationApplies(employee)) for (const date of [...dates, shiftDay(dates.at(-1), 1)]) {
      const previous = shiftDay(date, -1)
      const reason = closeRotationConflict(entries.get(`${employee.id}:${previous}`), entries.get(`${employee.id}:${date}`), rules)
      if (reason) issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${previous} → ${date} ${reason}` })
    }
    stats.push({ employeeId: employee.id, target, ...counts, weekendWork, longestConsecutive })
    if (counts.off !== target) issues.push({ employeeId: employee.id, text: `${employee.name}: 기준휴무 ${target}일 / 배정 ${counts.off}일` })
    for (const date of dates) {
      const code = entries.get(`${employee.id}:${date}`)
      if (!code) issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 미편성` })
      else if (code === 'full' && !['open', 'close'].every(shift => rule.allowedShifts.includes(shift))) issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 불가능한 근무 배정` })
      else if (code !== 'off' && code !== 'full' && !rule.allowedShifts.includes(code)) issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 불가능한 근무 배정` })
      if (isRequiredOff(employee, date) && code !== 'off') issues.push({ employeeId: employee.id, date, text: `${employee.name}: ${date} 정기휴무 필요` })
    }
  }
  return { targetRestDays: target, issues, pending, warnings, stats }
}

export async function generateSchedule(input) {
  const { month, employees, settings, holidays, existingShifts = [], adjacentShifts = [], adjacentHolidays = [], mode = 'replace' } = input
  const glpk = await GLPK()
  const dates = monthDates(month)
  const target = restTarget(dates, holidays, settings.operations)
  const rules = operationRules(settings)
  const random = seededRandom(input.seed)
  const previousMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7)
  const functionalEmployees = employees.filter(employee => employee.dutyType === 'functional')
  const supportEmployees = employees.filter(employee => employee.dutyType === 'support')
  const produceEmployees = employees.filter(employee => employee.produceQualified)
  const produceBackups = employees.filter(employee => employee.produceBackup)
  const agriculturalEmployees = employees.filter(employee => employee.produceQualified || employee.produceBackup)
  if (!employees.length) return { error: '재직 중인 직원을 먼저 등록해 주세요.' }
  if (rules.minimumEmployeesForGeneration > 0 && employees.length < rules.minimumEmployeesForGeneration) return { error: `자동 편성에는 재직 직원 ${rules.minimumEmployeesForGeneration}명 이상이 필요합니다.` }
  const lp = { name: 'monthly_shifts', objective: { direction: glpk.GLP_MIN, name: 'preferences_and_balance', vars: [] }, subjectTo: [], binaries: [], bounds: [] }
  let index = 0
  const add = (vars, type, lb, ub) => lp.subjectTo.push({ name: `c${index++}`, vars, bnds: { type, lb, ub } })
  const variable = (id, date, code, coef = 1) => ({ name: `s_${id}_${date.replaceAll('-', '')}_${code}`, coef })
  const eq = (vars, value) => add(vars, glpk.GLP_FX, value, value)
  const lo = (vars, value) => add(vars, glpk.GLP_LO, value, 0)
  const up = (vars, value) => add(vars, glpk.GLP_UP, 0, value)
  const lockedThroughDate = input.lockedThroughDate ?? seoulDateKey()
  const fixed = new Map(existingShifts.filter(s => mode === 'fill' || s.date <= lockedThroughDate || (mode === 'rebalance' && s.locked)).map(s => [`${s.employeeId}:${s.date}`, s.code]))
  // Locked input conflicts must be explained before optimization, never hidden
  // behind a greedy replacement that breaks unrelated rules.
  const fixedConflicts = []
  for (const date of dates) for (const pair of settings.daysOffPairs ?? []) {
    if (rules.rulePriorities.daysOffPairs <= 3 && pair.employeeIds.length > 1 && pair.employeeIds.every(id => employees.some(e => e.id === id) && fixed.get(`${id}:${date}`) === 'off')) {
      fixedConflicts.push(`${date} ${pair.employeeIds.map(id => employees.find(e => e.id === id).name).join('·')} 동시휴무 금지와 고정휴무 충돌`)
    }
  }
  for (const date of dates) {
    const regulars = employees.filter(e => e.employmentType === '정규직')
    if (rules.requireRegularEachShift && regulars.length && regulars.every(e => fixed.get(`${e.id}:${date}`) === 'off')) fixedConflicts.push(`${date} 정규직 전원이 고정휴무입니다`)
    for (const employee of regulars) {
      const previousDate = shiftDay(date, -1)
      const previous = fixed.get(`${employee.id}:${previousDate}`) ?? (!dates.includes(previousDate) ? adjacentShifts.find(s => s.employeeId === employee.id && s.date === previousDate)?.code : undefined)
      const current = fixed.get(`${employee.id}:${date}`)
      const reason = closeRotationConflict(previous, current, rules)
      const key = previous === 'close' && current === 'close' ? 'consecutiveClose' : 'fullCloseAdjacent'
      if (reason && rules.rulePriorities[key] <= 3) fixedConflicts.push(`${date} ${employee.name} 고정근무의 ${reason}`)
    }
  }
  if (fixedConflicts.length) return { error: `고정된 조건을 함께 충족할 수 없습니다. ${fixedConflicts.join(' · ')}`, conflicts: fixedConflicts }
  const weeks = [...new Map(dates.map(date => [weekDates(date)[0], weekDates(date)])).values()]
  const requests = (input.requests ?? []).filter(r => r.status !== 'rejected' && employees.some(e => e.id === r.employeeId) && dates.includes(r.date))
  const regularStaffingSlacks = []
  const dailyStaffingSlacks = []
  const fallbackStaffingSlacks = []
  const splitFallbackStaffingSlacks = []
  const splitTargetStaffingSlacks = []
  const dailyShiftImbalanceSlacks = []
  const regularShiftImbalanceSlacks = []
  const ruleViolationSlacks = []
  const weeklyRestSlacks = []
  const weekendFairnessSlacks = []
  const seededTieBreakVars = []
  const preferredGapPenalties = []
  const requestPreferenceVars = []
  const requestPreferenceObjectiveVars = []
  // Preferences are optimized only after all staffing, rest and employee rules hold.
  const preferenceScale = 1000 * employees.length * dates.length
  const approvedWeight = rules.approvedWishWeight
  const pendingWeight = rules.pendingWishWeight
  for (const employee of employees) {
    const employeeRules = employee.workRules ?? defaultRules
    for (const date of dates) {
      const vars = codes.map(code => variable(employee.id, date, code))
      lp.binaries.push(...vars.map(v => v.name))
      eq(vars, 1)
      for (const code of ['open', 'close']) if (!employeeRules.allowedShifts.includes(code)) ruleViolationSlacks.push({ ...variable(employee.id, date, code), priorityKey: 'employeeRules' })
      if (isRequiredOff(employee, date)) {
        const missed = `miss_required_off_${employee.id}_${date.replaceAll('-', '')}`
        lo([{ ...variable(employee.id, date, 'off'), coef: 1 }, { name: missed, coef: 1 }], 1)
        ruleViolationSlacks.push({ name: missed, coef: 1, priorityKey: 'employeeRules' })
      }
      const pinned = fixed.get(`${employee.id}:${date}`)
      if (pinned) eq([variable(employee.id, date, pinned)], 1)
      else {
        const operations = operationRules(settings)
        const weekendFullAllowed = operations.weekendRegularFullShift && operations.allowFullShiftGeneration && employee.employmentType === '정규직' && [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())
        if (!weekendFullAllowed || !['open', 'close'].every(code => employeeRules.allowedShifts.includes(code))) eq([variable(employee.id, date, 'full')], 0)
      }
      // Seeded tie-break keeps each alternative reproducible while exploring another valid arrangement.
      for (const code of codes) {
        const tieBreak = variable(employee.id, date, code, random() * 0.1)
        lp.objective.vars.push(tieBreak)
        seededTieBreakVars.push(tieBreak)
      }
    }
    const monthlyOver = `monthly_rest_over_${employee.id}`
    const monthlyUnder = `monthly_rest_under_${employee.id}`
    const pinnedOffCount = dates.filter(date => fixed.get(`${employee.id}:${date}`) === 'off').length
    const pinnedOffExceedsTarget = pinnedOffCount > target
    lp.bounds.push(
      { name: monthlyOver, type: pinnedOffExceedsTarget ? glpk.GLP_LO : glpk.GLP_FX, lb: 0, ub: 0 },
      { name: monthlyUnder, type: glpk.GLP_LO, lb: 0, ub: 0 },
    )
    eq([...dates.map(date => variable(employee.id, date, 'off')), { name: monthlyUnder, coef: 1 }, { name: monthlyOver, coef: -1 }], target)
    ruleViolationSlacks.push({ name: monthlyOver, coef: 1, priorityKey: 'monthlyRest' }, { name: monthlyUnder, coef: 1, priorityKey: 'monthlyRest' })
    for (const week of weeks) {
      const inside = week.filter(date => dates.includes(date))
      const vars = inside.map(date => variable(employee.id, date, 'off'))
      const spread = `spread_${employee.id}_${week[0].replaceAll('-', '')}`
      const expectedOff = target * inside.length / dates.length
      lp.bounds.push({ name: spread, type: glpk.GLP_LO, lb: 0, ub: 0 })
      weeklyRestSlacks.push({ name: spread, coef: 1 })
      up([...vars, { name: spread, coef: -1 }], expectedOff)
      lo([...vars, { name: spread, coef: 1 }], expectedOff)
      lp.objective.vars.push({ name: spread, coef: 25 * rules.weeklyRestBalanceWeight / 100 })
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
          if (code === 'open' || code === 'close' || code === 'full') priorWork++
          } else if (dayIndex < dates.length) currentDates.push(dates[dayIndex])
        }
        if (currentDates.length) {
          const excess = `consecutive_excess_${employee.id}_${startIndex + limit + 1}`
          lp.bounds.push({ name: excess, type: glpk.GLP_LO, lb: 0, ub: 0 })
          up([...currentDates.flatMap(date => ['open', 'close', 'full'].map(code => variable(employee.id, date, code))), { name: excess, coef: -1 }], limit - priorWork)
          ruleViolationSlacks.push({ name: excess, coef: 1, priorityKey: 'maxConsecutiveWork' })
        }
      }
    }
    if (closeRotationApplies(employee)) {
      // These enabled rotation rules remain hard constraints; the priority table
      // scores rules that can safely be relaxed when staffing rules conflict.
      const operations = operationRules(settings)
      const pairs = []
      if (operations.noConsecutiveClose) pairs.push(['close', 'close'])
      if (operations.noFullCloseAdjacent) pairs.push(['full', 'close'], ['close', 'full'])
      for (const date of dates) {
        const previousDate = shiftDay(date, -1)
        const previousPinned = fixed.get(`${employee.id}:${previousDate}`)
          ?? (dates.includes(previousDate) ? undefined : adjacentShifts.find(shift => shift.employeeId === employee.id && shift.date === previousDate)?.code)
        const currentPinned = fixed.get(`${employee.id}:${date}`)
        const previousInMonth = dates.includes(previousDate)
        for (const [first, second] of pairs) {
          if (previousPinned && currentPinned) continue
          const priorityKey = first === 'close' && second === 'close' ? 'consecutiveClose' : 'fullCloseAdjacent'
          const strict = operations.rulePriorities[priorityKey] <= 3
          if (previousPinned) {
            if (previousPinned === first) {
              if (strict) eq([variable(employee.id, date, second)], 0)
              else {
                const violation = `rotation_violation_${employee.id}_${date.replaceAll('-', '')}_${first}_${second}`
                lp.bounds.push({ name: violation, type: glpk.GLP_LO, lb: 0, ub: 0 })
                up([{ ...variable(employee.id, date, second), coef: 1 }, { name: violation, coef: -1 }], 0)
                ruleViolationSlacks.push({ name: violation, coef: 1, priorityKey })
              }
            }
            continue
          } else if (currentPinned) {
            if (currentPinned === second && previousInMonth) {
              if (strict) eq([variable(employee.id, previousDate, first)], 0)
              else {
                const violation = `rotation_violation_${employee.id}_${date.replaceAll('-', '')}_${first}_${second}`
                lp.bounds.push({ name: violation, type: glpk.GLP_LO, lb: 0, ub: 0 })
                up([{ ...variable(employee.id, previousDate, first), coef: 1 }, { name: violation, coef: -1 }], 0)
                ruleViolationSlacks.push({ name: violation, coef: 1, priorityKey })
              }
            }
            continue
          }
          if (previousInMonth) {
            if (strict) up([variable(employee.id, previousDate, first), variable(employee.id, date, second)], 1)
            else {
              const violation = `rotation_violation_${employee.id}_${date.replaceAll('-', '')}_${first}_${second}`
              lp.bounds.push({ name: violation, type: glpk.GLP_LO, lb: 0, ub: 0 })
              up([variable(employee.id, previousDate, first), variable(employee.id, date, second), { name: violation, coef: -1 }], 1)
              ruleViolationSlacks.push({ name: violation, coef: 1, priorityKey })
            }
          }
        }
      }
    }
    // Preserve rotation rules at the following month's boundary as well.
    if (closeRotationApplies(employee)) {
      const next = adjacentShifts.find(shift => shift.employeeId === employee.id && shift.date === shiftDay(dates.at(-1), 1))?.code
      for (const code of codes) if (closeRotationConflict(code, next, rules)) eq([variable(employee.id, dates.at(-1), code)], 0)
    }
    const deviation = `balance_${employee.id}`
    const priorBalance = adjacentShifts.filter(shift => shift.employeeId === employee.id && shift.date.startsWith(`${previousMonth}-`)).reduce((sum, shift) => sum + (shift.code === 'open' ? 1 : shift.code === 'close' ? -1 : 0), 0)
    const balance = dates.flatMap(date => [variable(employee.id, date, 'open', 1), variable(employee.id, date, 'close', -1)])
    lo([...balance, { name: deviation, coef: 1 }], -priorBalance)
    lo([...balance.map(v => ({ ...v, coef: -v.coef })), { name: deviation, coef: 1 }], priorBalance)
    lp.bounds.push({ name: deviation, type: glpk.GLP_LO, lb: 0, ub: 0 })
    lp.objective.vars.push({ name: deviation, coef: 1 })
  }
  for (const request of requests) {
    const approved = request.status === 'approved'
    const weight = (approved ? approvedWeight : pendingWeight) * priorityFactor(rules, approved ? 'approvedRequests' : 'pendingRequests')
    const preference = variable(request.employeeId, request.date, 'off', -preferenceScale * weight)
    lp.objective.vars.push(preference)
    requestPreferenceObjectiveVars.push(preference)
    requestPreferenceVars.push({ ...preference, coef: -Math.min(1, weight / 100) })
  }
  const addFairnessPenalty = (name, expression, constant, target, weight) => {
    const deviation = `fair_${name}`
    lp.bounds.push({ name: deviation, type: glpk.GLP_LO, lb: 0, ub: 0 })
    up([...expression, { name: deviation, coef: -1 }], target - constant)
    up([...expression.map(item => ({ ...item, coef: -item.coef })), { name: deviation, coef: -1 }], constant - target)
    lp.objective.vars.push({ name: deviation, coef: weight * priorityFactor(rules, 'weekendRestFairness') })
    weekendFairnessSlacks.push({ name: deviation, coef: 1 })
  }
  const priorShifts = adjacentShifts.filter(shift => shift.date.startsWith(`${previousMonth}-`))
  const priorHolidays = new Set(adjacentHolidays.filter(item => (typeof item === 'string' ? item : item.date).startsWith(`${previousMonth}-`)).map(item => typeof item === 'string' ? item : item.date))
  for (const shift of priorShifts) if ([0, 6].includes(new Date(`${shift.date}T00:00:00Z`).getUTCDay())) priorHolidays.add(shift.date)
  const currentHolidayDates = dates.filter(date => priorHolidays.has(date) || [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) || holidays.some(item => (typeof item === 'string' ? item : item.date) === date))
  for (const employee of employees) if (rules.shiftRotationWeight > 0) lp.objective.vars.push({ name: `balance_${employee.id}`, coef: 50 * rules.shiftRotationWeight * priorityFactor(rules, 'shiftRotation') })
  const priorOffTotal = employees.reduce((sum, employee) => sum + priorShifts.filter(shift => shift.employeeId === employee.id && shift.code === 'off' && priorHolidays.has(shift.date)).length, 0)
  const expectedCurrentHolidayOff = employees.length * target * currentHolidayDates.length / dates.length
  const holidayOffTarget = (priorOffTotal + expectedCurrentHolidayOff) / employees.length
  for (const employee of employees) {
    const baseline = priorShifts.filter(shift => shift.employeeId === employee.id && shift.code === 'off' && priorHolidays.has(shift.date)).length
    if (rules.weekendRestFairnessWeight > 0) addFairnessPenalty(`${employee.id}_holiday_off`, currentHolidayDates.map(date => variable(employee.id, date, 'off')), baseline, holidayOffTarget, 80 * rules.weekendRestFairnessWeight)
  }
  for (const date of dates) {
    const dayKey = date.replaceAll('-', '')
    const shiftImbalance = `open_close_imbalance_${dayKey}`
    lp.bounds.push({ name: shiftImbalance, type: glpk.GLP_LO, lb: 0, ub: 0 })
    dailyShiftImbalanceSlacks.push({ name: shiftImbalance, coef: 1 })
    lo([...employees.map(employee => variable(employee.id, date, 'open')), ...employees.map(employee => ({ ...variable(employee.id, date, 'close'), coef: -1 })), { name: shiftImbalance, coef: 1 }], 0)
    lo([...employees.map(employee => variable(employee.id, date, 'close')), ...employees.map(employee => ({ ...variable(employee.id, date, 'open'), coef: -1 })), { name: shiftImbalance, coef: 1 }], 0)
    const regularShiftImbalance = `regular_open_close_imbalance_${dayKey}`
    lp.bounds.push({ name: regularShiftImbalance, type: glpk.GLP_LO, lb: 0, ub: 0 })
    regularShiftImbalanceSlacks.push({ name: regularShiftImbalance, coef: 1 })
    const regulars = employees.filter(employee => employee.employmentType === '정규직')
    lo([...regulars.map(employee => variable(employee.id, date, 'open')), ...regulars.map(employee => ({ ...variable(employee.id, date, 'close'), coef: -1 })), { name: regularShiftImbalance, coef: 1 }], 0)
    lo([...regulars.map(employee => variable(employee.id, date, 'close')), ...regulars.map(employee => ({ ...variable(employee.id, date, 'open'), coef: -1 })), { name: regularShiftImbalance, coef: 1 }], 0)
    const staffingShortfall = `missing_staff_${dayKey}`
    lp.bounds.push({ name: staffingShortfall, type: glpk.GLP_LO, lb: 0, ub: 0 })
    dailyStaffingSlacks.push({ name: staffingShortfall, coef: 1 })
    lo([...employees.flatMap(employee => ['open', 'close', 'full'].map(code => variable(employee.id, date, code))), { name: staffingShortfall, coef: 1 }], minimumWorkersForDate(date, holidays, settings.operations))
    const fallbackShortfall = `missing_fallback_staff_${dayKey}`
    lp.bounds.push({ name: fallbackShortfall, type: glpk.GLP_LO, lb: 0, ub: 0 })
    fallbackStaffingSlacks.push({ name: fallbackShortfall, coef: 1 })
    lo([...employees.flatMap(employee => ['open', 'close', 'full'].map(code => variable(employee.id, date, code))), { name: fallbackShortfall, coef: 1 }], fallbackMinimumWorkersForDate(date, holidays, settings.operations))
    for (const staffingRule of employmentStaffingRules(date, holidays, operationRules(settings)) ?? []) {
      const eligible = employees.filter(employee => employee.employmentType === staffingRule.employmentType)
      const fallbackGap = `missing_${staffingRule.employmentType}_${dayKey}`
      const targetGap = `target_${staffingRule.employmentType}_${dayKey}`
      lp.bounds.push({ name: fallbackGap, type: glpk.GLP_LO, lb: 0, ub: 0 }, { name: targetGap, type: glpk.GLP_LO, lb: 0, ub: 0 })
      const staffVars = eligible.flatMap(employee => ['open', 'close', 'full'].map(code => variable(employee.id, date, code)))
      lo([...staffVars, { name: fallbackGap, coef: 1 }], staffingRule.minimum)
      lo([...staffVars, { name: targetGap, coef: 1 }], staffingRule.target)
      splitFallbackStaffingSlacks.push({ name: fallbackGap, coef: 1 })
      splitTargetStaffingSlacks.push({ name: targetGap, coef: 1 })
    }
    for (const code of ['open', 'close']) {
      const slack = `missing_regular_${date.replaceAll('-', '')}_${code}`
      regularStaffingSlacks.push({ name: slack, coef: 1 })
      lp.bounds.push({ name: slack, type: glpk.GLP_LO, lb: 0, ub: 0 })
      // Preserve both shifts, even if the monthly rest quota makes regular-only coverage impossible.
      lo(employees.flatMap(e => [variable(e.id, date, code), variable(e.id, date, 'full')]), 1)
      if (rules.requireRegularEachShift) {
        lo([...employees.filter(e => e.employmentType === '정규직').flatMap(e => [variable(e.id, date, code), variable(e.id, date, 'full')]), { name: slack, coef: 1 }], 1)
      }
    }
    if (rules.requireRegularEachShift) {
      // A monthly quota can make regular coverage of both shifts impossible,
      // but a day with every regular off is avoidable and must never be emitted.
      lo(employees.filter(e => e.employmentType === '정규직').flatMap(e => ['open', 'close', 'full'].map(code => variable(e.id, date, code))), 1)
    }
    if (rules.weekendRegularFullShift && rules.allowFullShiftGeneration && [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
      const regularFullShifts = employees.filter(employee => employee.employmentType === '정규직').map(employee => variable(employee.id, date, 'full'))
      up(regularFullShifts, 1)
    }
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (rules.weekendRegularFullShift && rules.allowFullShiftGeneration && weekday === 6) {
      // Full shifts are only possible on Saturday and Sunday, so this paired-day
      // limit is also the one-full-shift-per-employee-per-week limit.
      const sundayKey = shiftDay(date, 1)
      if (dates.includes(sundayKey)) {
        for (const employee of employees.filter(employee => employee.employmentType === '정규직')) {
          up([variable(employee.id, date, 'full'), variable(employee.id, sundayKey, 'full')], 1)
        }
      } else {
        const nextWeekendFulls = adjacentShifts.filter(shift => shift.date === sundayKey && shift.code === 'full').map(shift => shift.employeeId)
        for (const employeeId of nextWeekendFulls) if (employees.some(employee => employee.id === employeeId && employee.employmentType === '정규직')) eq([variable(employeeId, date, 'full')], 0)
      }
    } else if (rules.weekendRegularFullShift && rules.allowFullShiftGeneration && weekday === 0 && !dates.includes(shiftDay(date, -1))) {
      const previousWeekendFulls = adjacentShifts.filter(shift => shift.date === shiftDay(date, -1) && shift.code === 'full').map(shift => shift.employeeId)
      for (const employeeId of previousWeekendFulls) if (employees.some(employee => employee.id === employeeId && employee.employmentType === '정규직')) eq([variable(employeeId, date, 'full')], 0)
    }
    if (rules.requireProduceOpener && (produceEmployees.length || produceBackups.length) && !(settings.produceOpenExceptions ?? []).includes(date)) {
      const missing = `missing_produce_open_${dayKey}`
      lp.bounds.push({ name: missing, type: glpk.GLP_LO, lb: 0, ub: 0 })
      const produceOpeners = produceEmployees.flatMap(employee => [variable(employee.id, date, 'open'), variable(employee.id, date, 'full')])
      const backupOpeners = produceBackups.flatMap(employee => [variable(employee.id, date, 'open'), variable(employee.id, date, 'full')])
      lo([...produceOpeners, ...backupOpeners, { name: missing, coef: 1 }], 1)
      ruleViolationSlacks.push({ name: missing, coef: 1, priorityKey: 'produceOpening' })
    }
    if (rules.functionalMinOnDuty > 0 && functionalEmployees.length >= rules.functionalMinOnDuty) {
      const shortage = `functional_short_${dayKey}`
      lp.bounds.push({ name: shortage, type: glpk.GLP_LO, lb: 0, ub: 0 })
      lo([...functionalEmployees.flatMap(employee => [variable(employee.id, date, 'open'), variable(employee.id, date, 'close'), variable(employee.id, date, 'full', rules.functionalMinOnDuty)]), { name: shortage, coef: 1 }], rules.functionalMinOnDuty)
      ruleViolationSlacks.push({ name: shortage, coef: 1, priorityKey: 'functionalMinimum' })
    }
    if (supportEmployees.length > 0) {
      const excess = `support_off_excess_${dayKey}`
      lp.bounds.push({ name: excess, type: glpk.GLP_LO, lb: 0, ub: 0 })
      up([...supportEmployees.map(employee => variable(employee.id, date, 'off')), { name: excess, coef: -1 }], rules.supportMaxOff)
      ruleViolationSlacks.push({ name: excess, coef: 1, priorityKey: 'supportRestLimit' })
    }
    if (rules.produceOpenCount > 0 && produceEmployees.length >= rules.produceOpenCount && !(settings.produceOpenExceptions ?? []).includes(date)) {
      const shortage = `produce_open_short_${dayKey}`
      lp.bounds.push({ name: shortage, type: glpk.GLP_LO, lb: 0, ub: 0 })
      lo([...produceEmployees.flatMap(employee => [variable(employee.id, date, 'open'), variable(employee.id, date, 'full')]), { name: shortage, coef: 1 }], rules.produceOpenCount)
      ruleViolationSlacks.push({ name: shortage, coef: 1, priorityKey: 'produceOpening' })
    }
    const allAgriculturalStaffPinnedOff = agriculturalEmployees.length > 1 && agriculturalEmployees.every(employee => fixed.get(`${employee.id}:${date}`) === 'off')
    if (rules.preventSimultaneousProduceRest && agriculturalEmployees.length > 1 && !allAgriculturalStaffPinnedOff) {
      const shortage = `produce_simultaneous_off_${dayKey}`
      lp.bounds.push({ name: shortage, type: glpk.GLP_LO, lb: 0, ub: 0 })
      const produceWork = agriculturalEmployees.flatMap(employee => ['open', 'close', 'full'].map(code => variable(employee.id, date, code)))
      lo([...produceWork, { name: shortage, coef: 1 }], 1)
      ruleViolationSlacks.push({ name: shortage, coef: 1, priorityKey: 'produceCoverage' })
    }
    for (const [pairIndex, pair] of (settings.daysOffPairs ?? []).entries()) if (pair.employeeIds.length === 2 && pair.employeeIds.every(id => employees.some(e => e.id === id))) {
      if (rules.rulePriorities.daysOffPairs <= 3) up(pair.employeeIds.map(id => variable(id, date, 'off')), 1)
      else {
        const overlap = `paired_off_overlap_${pairIndex}_${dayKey}`
        lp.bounds.push({ name: overlap, type: glpk.GLP_LO, lb: 0, ub: 0 })
        up([...pair.employeeIds.map(id => variable(id, date, 'off')), { name: overlap, coef: -1 }], 1)
        ruleViolationSlacks.push({ name: overlap, coef: 1, priorityKey: 'daysOffPairs' })
      }
    }
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
      lo([{ name: gap, coef: 1 }, { name: openGap, coef: -1 }], 0)
      lo([{ name: gap, coef: 1 }, { name: closeGap, coef: -1 }], 0)
      up([{ name: gap, coef: 1 }, { name: openGap, coef: -1 }, { name: closeGap, coef: -1 }], 0)
      const works = ['open', 'close'].map(code => variable(gapEmployee.id, date, code))
      up([{ name: worksDuringGap, coef: 1 }, { name: gap, coef: -1 }], 0)
      up([{ name: worksDuringGap, coef: 1 }, ...works.map(v => ({ ...v, coef: -1 }))], 0)
      lo([{ name: worksDuringGap, coef: 1 }, { name: gap, coef: -1 }, ...works.map(v => ({ ...v, coef: -1 }))], -1)
      preferredGapPenalties.push({ name: worksDuringGap, coef: 1 })
    }
  }
  // The manager's alternative picker runs three independent plans at once. Keep that
  // interactive path responsive; explicit one-shot generation gets the longer budget.
  const quickAlternativeSearch = input.alternativeSearch === true
  const staffingTimeLimit = quickAlternativeSearch ? 4 : 12
  const finalTimeLimit = quickAlternativeSearch ? 3 : 10
  const mipGap = quickAlternativeSearch ? 0.02 : 0
  const weightedRuleViolations = ruleViolationSlacks.map(({ priorityKey, ...item }) => ({ ...item, coef: 10_000 * priorityFactor(rules, priorityKey ?? 'employeeRules') }))
  const priorityRanked = (items, ruleKey, baseWeight) => items.map(item => ({ ...item, coef: baseWeight * priorityFactor(rules, ruleKey) }))
  const enforceTopPriority = (items, ruleKey) => {
    if (rules.rulePriorities[ruleKey] > 3) return
    for (const item of items) eq([{ name: item.name, coef: 1 }], 0)
  }
  enforceTopPriority([...fallbackStaffingSlacks, ...splitFallbackStaffingSlacks, ...dailyStaffingSlacks, ...splitTargetStaffingSlacks], 'minimumStaffing')
  enforceTopPriority(regularStaffingSlacks, 'regularCoverage')
  for (const item of ruleViolationSlacks) if (rules.rulePriorities[item.priorityKey ?? 'employeeRules'] <= 3) enforceTopPriority([item], item.priorityKey ?? 'employeeRules')
  const violationGroups = new Map()
  for (const item of ruleViolationSlacks) {
    const key = item.priorityKey ?? 'employeeRules'
    if (!violationGroups.has(key)) violationGroups.set(key, [])
    violationGroups.get(key).push({ name: item.name, coef: item.coef })
  }
  const ruleViolationNames = new Set(ruleViolationSlacks.map(item => item.name))
  const tieBreakVars = seededTieBreakVars.filter(item => !ruleViolationNames.has(item.name))
  const staffingObjective = { direction: glpk.GLP_MIN, name: 'staffing_floors_then_rule_violations', vars: [...priorityRanked(fallbackStaffingSlacks, 'minimumStaffing', 1_000_000_000), ...priorityRanked(splitFallbackStaffingSlacks, 'minimumStaffing', 1_000_000_000), ...priorityRanked(dailyStaffingSlacks, 'minimumStaffing', 1_000), ...priorityRanked(splitTargetStaffingSlacks, 'minimumStaffing', 1_000), ...weightedRuleViolations, ...priorityRanked(dailyShiftImbalanceSlacks, 'openCloseBalance', rules.openCloseBalanceWeight), ...priorityRanked(regularShiftImbalanceSlacks, 'openCloseBalance', rules.openCloseBalanceWeight), ...priorityRanked(regularStaffingSlacks, 'regularCoverage', 5_000), ...priorityRanked(weeklyRestSlacks, 'weeklyRestBalance', 25 * rules.weeklyRestBalanceWeight / 100), ...priorityRanked(weekendFairnessSlacks, 'weekendRestFairness', 25 * rules.weekendRestFairnessWeight / 100), ...preferredGapPenalties.map(item => ({ ...item, coef: 100 })), ...tieBreakVars] }
  // First seek a schedule satisfying every enabled rule and staffing target.
  // Only a proven conflict or an exhausted strict search allows priority-based
  // relaxation. A weighted sum alone can sacrifice a rule even when zero
  // violations are possible.
  const strictNames = new Set([...ruleViolationSlacks, ...regularStaffingSlacks, ...dailyStaffingSlacks, ...fallbackStaffingSlacks, ...splitFallbackStaffingSlacks, ...splitTargetStaffingSlacks].map(item => item.name))
  const strictConstraints = [...strictNames].map((name, i) => ({ name: `strict_${i}`, vars: [{ name, coef: 1 }], bnds: { type: glpk.GLP_FX, lb: 0, ub: 0 } }))
  const strictSolution = glpk.solve({ ...lp, objective: { direction: glpk.GLP_MIN, name: 'all_rules_feasible', vars: [] }, subjectTo: [...lp.subjectTo, ...strictConstraints] }, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: quickAlternativeSearch ? 10 : 15, mipgap: 0.05 })
  const strictFeasible = [glpk.GLP_OPT, glpk.GLP_FEAS].includes(strictSolution.result.status)
  if (!strictFeasible && strictSolution.result.status !== glpk.GLP_NOFEAS) {
    return { error: '계산 시간 안에 모든 규칙을 충족하는 근무표를 찾지 못했습니다. 다시 탐색해 주세요. 기존 근무표는 유지했습니다.' }
  }
  if (strictFeasible) lp.subjectTo.push(...strictConstraints)
  let staffingSolution = strictFeasible ? strictSolution : glpk.solve({ ...lp, objective: staffingObjective }, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: staffingTimeLimit, mipgap: mipGap })
  if (quickAlternativeSearch && ![glpk.GLP_OPT, glpk.GLP_FEAS].includes(staffingSolution.result.status)) {
    // Concurrent alternatives can exhaust the short first pass before it finds
    // any usable incumbent. Retry this candidate with more time before falling
    // back to a greedy schedule that may miss monthly rest targets.
    staffingSolution = glpk.solve({ ...lp, objective: staffingObjective }, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: 15, mipgap: 0.02 })
  }
  if (![glpk.GLP_OPT, glpk.GLP_FEAS].includes(staffingSolution.result.status)) {
    const infeasible = staffingSolution.result.status === glpk.GLP_NOFEAS
    return { error: infeasible
      ? '고정 근무·승인휴무와 필수 규칙을 함께 충족할 수 없습니다. 고정 입력 또는 상위 우선순위 규칙을 확인해 주세요. 기존 근무표는 유지했습니다.'
      : '계산 시간 안에 조건을 충족하는 근무표를 찾지 못했습니다. 다시 탐색해 주세요. 기존 근무표는 유지했습니다.' }
  }
  // Strict feasibility proves zero rule/staffing gaps, not optimal fairness.
  const staffingIsOptimal = !strictFeasible && staffingSolution.result.status === glpk.GLP_OPT
  if (staffingIsOptimal) {
    const minimumStaffingGaps = Math.round(regularStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
    const minimumDailyStaffingShortfall = Math.round(dailyStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
    const minimumFallbackStaffingShortfall = Math.round(fallbackStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
    const minimumSplitFallbackShortfall = Math.round(splitFallbackStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
    const minimumSplitTargetShortfall = Math.round(splitTargetStaffingSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
    const minimumDailyImbalance = Math.round(dailyShiftImbalanceSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
    const minimumRegularShiftImbalance = Math.round(regularShiftImbalanceSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0))
    const minimumWeeklyRestSpread = weeklyRestSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0)
    const minimumWeekendFairnessDeviation = weekendFairnessSlacks.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0)
    eq(fallbackStaffingSlacks, minimumFallbackStaffingShortfall)
    eq(splitFallbackStaffingSlacks, minimumSplitFallbackShortfall)
    eq(splitTargetStaffingSlacks, minimumSplitTargetShortfall)
    eq(regularStaffingSlacks, minimumStaffingGaps)
    eq(dailyStaffingSlacks, minimumDailyStaffingShortfall)
    for (const group of violationGroups.values()) eq(group, Math.round(group.reduce((sum, item) => sum + (staffingSolution.result.vars[item.name] ?? 0), 0)))
    if (rules.openCloseBalanceWeight > 0) eq(dailyShiftImbalanceSlacks, minimumDailyImbalance)
    if (rules.openCloseBalanceWeight > 0) eq(regularShiftImbalanceSlacks, minimumRegularShiftImbalance)
    if (rules.weeklyRestBalanceWeight > 0) eq(weeklyRestSlacks, minimumWeeklyRestSpread)
    if (rules.weekendRestFairnessWeight > 0) eq(weekendFairnessSlacks, minimumWeekendFairnessDeviation)
  } else if (!strictFeasible) {
    // A feasible incumbent is not proof that its slack values are minimal. Keep
    // those variables free and let the final solve improve rule compliance.
    const requestPreferenceSet = new Set(requestPreferenceObjectiveVars)
    lp.objective.vars = lp.objective.vars.filter(item => !requestPreferenceSet.has(item))
    lp.objective.vars.push(
      ...fallbackStaffingSlacks.map(item => ({ ...item, coef: 1_000_000_000 })),
      ...splitFallbackStaffingSlacks.map(item => ({ ...item, coef: 1_000_000_000 })),
      ...dailyStaffingSlacks.map(item => ({ ...item, coef: 100_000_000 })),
      ...splitTargetStaffingSlacks.map(item => ({ ...item, coef: 10_000_000 })),
      ...weightedRuleViolations,
      ...regularStaffingSlacks.map(item => ({ ...item, coef: 1_000_000_000 })),
      ...dailyShiftImbalanceSlacks.map(item => ({ ...item, coef: rules.openCloseBalanceWeight })),
      ...regularShiftImbalanceSlacks.map(item => ({ ...item, coef: rules.openCloseBalanceWeight })),
      ...priorityRanked(weeklyRestSlacks, 'weeklyRestBalance', 25 * rules.weeklyRestBalanceWeight / 100),
      ...priorityRanked(weekendFairnessSlacks, 'weekendRestFairness', 25 * rules.weekendRestFairnessWeight / 100),
    )
    lp.objective.vars.push(...requestPreferenceVars)
  }
  if (staffingIsOptimal) lp.objective.vars.push(...ruleViolationSlacks)
  for (const item of dailyShiftImbalanceSlacks) if (rules.openCloseBalanceWeight > 0) lp.objective.vars.push({ ...item, coef: 20_000 * rules.openCloseBalanceWeight * priorityFactor(rules, 'openCloseBalance') })
  for (const item of regularShiftImbalanceSlacks) if (rules.openCloseBalanceWeight > 0) lp.objective.vars.push({ ...item, coef: 20_000 * rules.openCloseBalanceWeight * priorityFactor(rules, 'openCloseBalance') })
  for (const date of input.prioritizeRegularCoverageDates ?? []) {
    if (!dates.includes(date)) continue
    for (const code of ['open', 'close']) lp.objective.vars.push({ name: `missing_regular_${date.replaceAll('-', '')}_${code}`, coef: 25_000_000 })
  }
  lp.objective.vars.push(...preferredGapPenalties.map(item => ({ ...item, coef: 1_000_000 })))
  const optimizedSolution = glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF, presol: true, tmlim: finalTimeLimit, mipgap: mipGap })
  const optimal = (strictFeasible || staffingIsOptimal) && optimizedSolution.result.status === glpk.GLP_OPT
  const hasFeasibleOptimization = [glpk.GLP_OPT, glpk.GLP_FEAS].includes(optimizedSolution.result.status)
  const solution = hasFeasibleOptimization ? optimizedSolution : staffingSolution
  const shifts = employees.flatMap(employee => dates.map(date => ({ employeeId: employee.id, date, code: codes.find(code => solution.result.vars[variable(employee.id, date, code).name] > 0.5) })))
  const minimumDailyStaffingShortfall = Math.round(dailyStaffingSlacks.reduce((sum, item) => sum + (solution.result.vars[item.name] ?? 0), 0))
  const minimumFallbackStaffingShortfall = Math.round(fallbackStaffingSlacks.reduce((sum, item) => sum + (solution.result.vars[item.name] ?? 0), 0))
  const validation = validateSchedule({ ...input, shifts })
  const regularCoverageGaps = validation.issues.filter(issue => /^\d{4}-\d{2}-\d{2} (오픈|마감) 정규직 없음$/.test(issue.text))
  const dailyStaffingIssues = validation.issues.filter(issue => /^\d{4}-\d{2}-\d{2} 최소 근무인원 미충족/.test(issue.text))
  const missedRequests = requests.filter(r => !shifts.some(s => s.employeeId === r.employeeId && s.date === r.date && s.code === 'off'))
  const staffingWarning = regularCoverageGaps.length ? `${target}일 월 휴무를 유지해 정규직 오픈·마감 배치가 ${regularCoverageGaps.length}회 부족합니다. ${regularCoverageGaps.map(issue => issue.text).join(' · ')} 해당 근무는 가능한 직원으로 편성했습니다.` : ''
  return { shifts, targetRestDays: target, optimal, missedRequests, minimumDailyStaffingShortfall, minimumFallbackStaffingShortfall, warnings: [...validation.issues.map(issue => issue.text), ...validation.warnings.map(issue => issue.text), ...dailyStaffingIssues.map(issue => issue.text), ...(staffingWarning ? [staffingWarning] : []), ...(!optimal ? ['필수 운영 기준을 우선한 편성을 만들었습니다. 계산 시간 제한으로 희망휴무와 근무 형평성의 최종 조정은 완료되지 않았습니다.'] : []), ...missedRequests.map(r => `${employees.find(e => e.id === r.employeeId).name}: ${r.date} 희망휴무 미반영 (필수조건 우선)`), ...validation.pending.map(i => i.text)] }
}
