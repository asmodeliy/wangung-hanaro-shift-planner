import type { DayRequest, Employee, Operations, Settings, Shift, ShiftCode, Times } from '../types'

export const weekdays = ['일', '월', '화', '수', '목', '금', '토']
export const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]))
export const todayKey = `${todayParts.year}-${todayParts.month}-${todayParts.day}`
export const [todayYear, todayMonth, todayDay] = todayKey.split('-').map(Number)
export const today = new Date(todayYear, todayMonth - 1, todayDay)
export const defaultOperations: Operations = { minimumEmployeesForGeneration: 3, weekdayTarget: 5, weekendTarget: 4, weekdayMinimum: 4, weekendMinimum: 3, staffingMode: 'combined', weekdayRegularTarget: 2, weekdayRegularMinimum: 1, weekdayContractTarget: 3, weekdayContractMinimum: 3, weekendRegularTarget: 2, weekendRegularMinimum: 1, weekendContractTarget: 2, weekendContractMinimum: 2, functionalMinOnDuty: 2, supportMaxOff: 2, supportMaxRequestsPerDate: 2, produceOpenCount: 0, requireRegularEachShift: true, requireProduceOpener: true, noConsecutiveClose: true, noFullCloseAdjacent: true, maxConsecutiveWorkDays: 0, maxWishDaysPerEmployee: 0, requestDueDay: 15, publishDay: 20 }
export const defaultSettings: Settings = { shiftTimes: { open: { regular: { start: '08:00', end: '17:00' }, contract: { start: '08:30', end: '17:30' } }, close: { regular: { start: '11:00', end: '20:00' }, contract: { start: '11:00', end: '20:00' } }, produceOpen: { start: '08:00', end: '17:00' } }, daysOffPairs: [], additionalHolidays: [], produceOpenExceptions: [], editablePastShiftDates: [], confirmedMonths: [], operations: defaultOperations }
export const monthLabel = (date: Date) => `${date.getFullYear()}년 ${date.getMonth() + 1}월`
export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const shiftTimesForEmployee = (employmentType: Employee['employmentType'], code: 'open' | 'close', settings: Settings) => {
  const type = employmentType === '계약직' ? 'contract' : 'regular'
  return settings.shiftTimes?.[code]?.[type] ?? defaultSettings.shiftTimes[code][type]
}
export const fullShiftTimesForEmployee = (employee: Employee, settings: Settings): Times => ({
  start: employee.produceQualified || employee.produceBackup ? settings.shiftTimes.produceOpen.start : shiftTimesForEmployee(employee.employmentType, 'open', settings).start,
  end: shiftTimesForEmployee(employee.employmentType, 'close', settings).end,
})
export const shiftTimesForStaff = (employee: Employee, code: 'open' | 'close', settings: Settings) => (employee.produceQualified || employee.produceBackup) && code === 'open' ? settings.shiftTimes.produceOpen : shiftTimesForEmployee(employee.employmentType, code, settings)
export const shiftTimeGroup = (settings: Settings, code: 'open' | 'close') => settings.shiftTimes?.[code] ?? defaultSettings.shiftTimes[code]
export const shiftTime = (settings: Settings, code: 'open' | 'close', type: 'regular' | 'contract') => shiftTimeGroup(settings, code)?.[type] ?? defaultSettings.shiftTimes[code][type]
export const isApprovedHopeVisible = (_date: string, request?: DayRequest) => request?.status === 'approved'
export const isLockedDate = (date: string, settings: Settings) => date < todayKey && !settings.editablePastShiftDates.includes(date)
export const isActive = (employee: Employee) => employee.active === true || employee.active === 1


export const shiftText: Record<ShiftCode, string> = { open: '오픈', close: '마감', full: '종일', off: '휴무' }
export const shiftShort: Record<ShiftCode, string> = { open: '오', close: '마', full: '종', off: '휴' }
export const employmentLabel = (employee: Employee) => employee.employmentType === '계약직' ? '계약직' : '일반직'

/** Working hours for one assignment. Managers see the configured times, staff see the server-provided ones. */
export function shiftHours(employee: Employee, shift: Shift | undefined, settings: Settings, isAdmin: boolean): Times | null {
  if (!shift || shift.code === 'off') return null
  if (!isAdmin) return shift.start && shift.end ? { start: shift.start, end: shift.end } : null
  return shift.code === 'full' ? fullShiftTimesForEmployee(employee, settings) : shiftTimesForStaff(employee, shift.code, settings)
}

export const requestStatusText: Record<DayRequest['status'], string> = { pending: '확인 대기', approved: '승인됨', rejected: '반려' }
