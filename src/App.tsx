import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import './App.css'

type Role = 'admin' | 'employee'
type User = { id: number; username: string; role: Role; employeeId: number | null; employeeName: string | null }
type WorkRules = { allowedShifts: ('open' | 'close')[]; offRules: { weekday: number; occurrences: number[] }[] }
type Validation = { issues: { date?: string; employeeId?: number; text: string }[]; pending: { date?: string; employeeId?: number; text: string }[]; warnings?: { date?: string; employeeId?: number; text: string }[]; stats: { employeeId: number; target: number; off: number; open: number; close: number; weekendWork?: number; longestConsecutive?: number }[] }
type Employee = { id: number; name: string; employmentType?: '정규직' | '계약직'; dutyType?: 'functional' | 'support' | 'other'; produceQualified?: boolean; active: number | boolean; notes: string; workRules?: WorkRules }
type DutyType = NonNullable<Employee['dutyType']>
type ShiftCode = 'open' | 'close' | 'off'
type Shift = { employeeId: number; employeeName: string; date: string; code: ShiftCode; employmentType?: Employee['employmentType']; start?: string | null; end?: string | null; locked?: boolean }
type DayRequest = { id: number; employeeId: number; employeeName: string; date: string; status: 'pending' | 'approved' | 'rejected' }
type Account = { id: number; username: string; role: Role; employeeId: number | null; employeeName: string | null }
type Times = { start: string; end: string }
type Operations = { weekdayTarget: number; weekendTarget: number; weekdayMinimum: number; weekendMinimum: number; staffingMode: 'combined' | 'employmentType'; weekdayRegularTarget: number; weekdayRegularMinimum: number; weekdayContractTarget: number; weekdayContractMinimum: number; weekendRegularTarget: number; weekendRegularMinimum: number; weekendContractTarget: number; weekendContractMinimum: number; functionalMinOnDuty: number; supportMaxOff: number; supportMaxRequestsPerDate: number; produceOpenCount: number; requireRegularEachShift: boolean; maxConsecutiveWorkDays: number; maxWishDaysPerEmployee: number; requestDueDay: number; publishDay: number }
type NumericOperation = Exclude<keyof Operations, 'requireRegularEachShift' | 'staffingMode'>
type Settings = { shiftTimes: Record<'open' | 'close', Record<'regular' | 'contract', Times>>; daysOffPairs: { employeeIds: number[] }[]; additionalHolidays: string[]; produceOpenExceptions: string[]; confirmedMonths: string[]; weeklyRestPolicy?: 'minimum' | 'exact'; operations: Operations }
type PhotoImport = { month: string; entries: { employeeId: number; date: string; code: ShiftCode }[]; notes: { id: number; date: string; text: string; resolved: boolean }[] }
type Holiday = { date: string; name: string }
type ScheduleOption = { id: number; shifts: { employeeId: number; date: string; code: ShiftCode }[]; warnings: string[]; optimal: boolean }
type Page = 'schedule' | 'requests' | 'employees' | 'settings'

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]))
const todayKey = `${todayParts.year}-${todayParts.month}-${todayParts.day}`
const [todayYear, todayMonth, todayDay] = todayKey.split('-').map(Number)
const today = new Date(todayYear, todayMonth - 1, todayDay)
const defaultOperations: Operations = { weekdayTarget: 5, weekendTarget: 4, weekdayMinimum: 4, weekendMinimum: 3, staffingMode: 'combined', weekdayRegularTarget: 2, weekdayRegularMinimum: 1, weekdayContractTarget: 3, weekdayContractMinimum: 3, weekendRegularTarget: 2, weekendRegularMinimum: 1, weekendContractTarget: 2, weekendContractMinimum: 2, functionalMinOnDuty: 2, supportMaxOff: 2, supportMaxRequestsPerDate: 2, produceOpenCount: 0, requireRegularEachShift: true, maxConsecutiveWorkDays: 0, maxWishDaysPerEmployee: 0, requestDueDay: 15, publishDay: 20 }
const defaultSettings: Settings = { shiftTimes: { open: { regular: { start: '08:00', end: '17:00' }, contract: { start: '08:30', end: '17:30' } }, close: { regular: { start: '11:00', end: '20:00' }, contract: { start: '11:00', end: '20:00' } } }, daysOffPairs: [], additionalHolidays: [], produceOpenExceptions: [], confirmedMonths: [], operations: defaultOperations }
const monthLabel = (date: Date) => `${date.getFullYear()}년 ${date.getMonth() + 1}월`
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const shiftTimesForEmployee = (name: string, employmentType: Employee['employmentType'], code: 'open' | 'close', settings: Settings) => {
  const type = code === 'open' && name.trim() === '정지희' ? 'regular' : employmentType === '계약직' ? 'contract' : 'regular'
  return settings.shiftTimes?.[code]?.[type] ?? defaultSettings.shiftTimes[code][type]
}
const shiftTimeGroup = (settings: Settings, code: 'open' | 'close') => settings.shiftTimes?.[code] ?? defaultSettings.shiftTimes[code]
const shiftTime = (settings: Settings, code: 'open' | 'close', type: 'regular' | 'contract') => shiftTimeGroup(settings, code)?.[type] ?? defaultSettings.shiftTimes[code][type]
const isApprovedHopeVisible = (date: string, request?: DayRequest) => date >= '2026-11-01' && request?.status === 'approved'
const isLockedDate = (date: string) => date <= todayKey
const isActive = (employee: Employee) => employee.active === true || employee.active === 1

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? '요청을 처리하지 못했습니다.')
  }
  return response.status === 204 ? undefined as T : response.json()
}

function Icon({ name, size = 18 }: { name: 'calendar' | 'users' | 'heart' | 'settings' | 'logout' | 'arrow' | 'plus' | 'clock' | 'check' | 'print' | 'spark' | 'menu' | 'key'; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    heart: <><path d="M20.8 8.6c0 5.2-8.8 10.2-8.8 10.2S3.2 13.8 3.2 8.6a4.6 4.6 0 0 1 8.8-1.9 4.6 4.6 0 0 1 8.8 1.9Z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.8Z" transform="translate(-2 -2)"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>, plus: <path d="M12 5v14M5 12h14"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>, print: <><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></>, spark: <><path d="m12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></>, menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>, key: <><circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7 2 2-2 2 1.5 1.5-2 2-1.5-1.5-3.9 3.9"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function BrandMark() {
  const [unavailable, setUnavailable] = useState(false)
  return <div className="brand-mark" aria-label="농협">{!unavailable ? <img src="/nonghyup-symbol.svg" alt="농협 심벌" onError={() => setUnavailable(true)}/> : <span>NH</span>}</div>
}

function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [setupKeyRequired, setSetupKeyRequired] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [page, setPage] = useState<Page>('schedule')
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [requests, setRequests] = useState<DayRequest[]>([])
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [validation, setValidation] = useState<Validation>({ issues: [], pending: [], stats: [] })
  const [generating, setGenerating] = useState(false)
  const [scheduleOptions, setScheduleOptions] = useState<{ month: string; mode: 'replace' | 'fill' | 'rebalance'; targetRestDays: number; options: ScheduleOption[]; exhaustive: false; explored: number; nextOffset: number; revision: number } | null>(null)
  const [photoImport, setPhotoImport] = useState<PhotoImport | null>(null)
  const [referenceAvailable, setReferenceAvailable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<Employee | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [chosenDates, setChosenDates] = useState<string[]>([])
  const [holidayDate, setHolidayDate] = useState('')
  const [produceExceptionDate, setProduceExceptionDate] = useState('')
  const [accountDialog, setAccountDialog] = useState<Employee | null>(null)
  const [showReference, setShowReference] = useState(false)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('wangung-sidebar') === 'collapsed')
  const [viewMode, setViewMode] = useState<'week' | 'calendar'>(() => localStorage.getItem('wangung-schedule-view') === 'calendar' ? 'calendar' : 'week')
  const [weekIndex, setWeekIndex] = useState(() => Math.floor((today.getDate() - 1 + (new Date(today.getFullYear(), today.getMonth(), 1).getDay() + 6) % 7) / 7))

  const toggleSidebar = () => setSidebarCollapsed(value => {
    const next = !value
    localStorage.setItem('wangung-sidebar', next ? 'collapsed' : 'expanded')
    return next
  })
  const changeViewMode = (value: 'week' | 'calendar') => {
    localStorage.setItem('wangung-schedule-view', value)
    setViewMode(value)
  }

  useEffect(() => {
    void (async () => {
      try {
        const status = await api<{ setupNeeded: boolean; setupKeyRequired?: boolean }>('/api/auth/status')
        setSetupNeeded(status.setupNeeded)
        setSetupKeyRequired(Boolean(status.setupKeyRequired))
        if (!status.setupNeeded) {
          const result = await api<{ user: User }>('/api/auth/me')
          setUser(result.user)
        }
      } catch { setUser(null) } finally { setAuthChecked(true) }
    })()
  }, [])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true); setError('')
    try {
      const [staff, entries, dayRequests, days] = await Promise.all([
        api<Employee[]>('/api/employees'),
        api<Shift[]>(`/api/shifts?month=${monthKey(month)}`),
        api<DayRequest[]>(`/api/requests?month=${monthKey(month)}`),
        api<Holiday[]>(`/api/holidays?year=${month.getFullYear()}`),
      ])
      setEmployees(staff); setShifts(entries); setRequests(dayRequests); setHolidays(days)
      if (user.role === 'admin') {
        const [savedSettings, accountRows, reference, checked, imported] = await Promise.all([api<Settings>('/api/settings'), api<Account[]>('/api/users'), api<{ available: boolean }>('/api/reference-schedule/status'), api<Validation>(`/api/shifts/validation?month=${monthKey(month)}`), api<PhotoImport | null>('/api/reference-schedule/import')])
        setSettings(savedSettings); setAccounts(accountRows); setReferenceAvailable(reference.available); setValidation(checked); setPhotoImport(imported)
      }
    } catch (e) { setError(e instanceof Error ? e.message : '서버에 연결할 수 없습니다.') }
    finally { setLoading(false) }
  }, [month, user])
  useEffect(() => { void load() }, [load])

  const activeEmployees = useMemo(() => employees.filter(isActive), [employees])
  const dayCount = useMemo(() => new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(), [month])
  const calendarLead = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const mondayLead = (calendarLead + 6) % 7
  const weekCount = Math.ceil((mondayLead + dayCount) / 7)
  const weekDates = Array.from({ length: 7 }, (_, column) => {
    const day = weekIndex * 7 + column - mondayLead + 1
    return day < 1 || day > dayCount ? null : { day, date: dateKey(new Date(month.getFullYear(), month.getMonth(), day)), d: new Date(month.getFullYear(), month.getMonth(), day) }
  })
  const weekLabel = weekDates.filter(Boolean).map(item => item!.day)
  const weekRangeLabel = weekLabel.length ? `${weekLabel[0]}일 – ${weekLabel.at(-1)}일` : ''
  const shiftMap = useMemo(() => new Map(shifts.map(s => [`${s.employeeId}:${s.date}`, s])), [shifts])
  const holidayMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays])
  const restTarget = useMemo(() => Array.from({ length: dayCount }, (_, i) => { const date = dateKey(new Date(month.getFullYear(), month.getMonth(), i + 1)); const weekday = new Date(`${date}T12:00:00`).getDay(); return weekday === 0 || weekday === 6 || holidayMap.has(date) ? 1 : 0 }).reduce<number>((a, b) => a + b, 0), [dayCount, month, holidayMap])
  const pendingCount = requests.filter(item => item.status === 'pending').length
  const workCount = shifts.filter(item => item.code === 'open' || item.code === 'close').length
  const confirmed = settings.confirmedMonths.includes(monthKey(month))
  const lockedShiftCount = shifts.filter(item => item.date.startsWith(`${monthKey(month)}-`) && item.locked).length
  const hasLockedShifts = lockedShiftCount > 0
  const isAdmin = user?.role === 'admin'
  const issues = isAdmin ? [...validation.issues, ...validation.pending] : []
  const validationWarnings = isAdmin ? validation.warnings ?? [] : []
  const scheduleNotices = [...issues, ...validationWarnings]
  const employeeStats = new Map(validation.stats.map(stat => [stat.employeeId, stat]))
  const requestWarnings = requests.filter(item => item.status !== 'rejected' && shiftMap.get(item.employeeId + ':' + item.date)?.code !== 'off').map(item => ({ text: item.employeeName + ': ' + item.date + ' 희망휴무 미반영' }))

  const toast = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
  const changeMonth = (delta: number) => { setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1)); setWeekIndex(0) }
  const goToToday = () => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setWeekIndex(Math.floor((today.getDate() - 1 + (new Date(today.getFullYear(), today.getMonth(), 1).getDay() + 6) % 7) / 7)) }
  const authenticate = async (username: string, password: string, setup: boolean, setupKey: string) => {
    const result = await api<{ user: User }>(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, setupKey }) })
    setUser(result.user); setSetupNeeded(false); setPage('schedule'); setError('')
  }
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST' }) } finally { setUser(null); setEmployees([]); setShifts([]); setRequests([]) } }
  const saveShift = async (employeeId: number, day: number, code: ShiftCode | '') => {
    const date = dateKey(new Date(month.getFullYear(), month.getMonth(), day))
    if (isLockedDate(date)) { setError(`${date}는 지난 날짜라 고정되어 수정할 수 없습니다.`); return }
    if (shiftMap.get(`${employeeId}:${date}`)?.locked) { setError(`${date}에 입력한 근무는 확정되어 수정할 수 없습니다.`); return }
    if (confirmed && !window.confirm('확정된 근무표를 수정하면 확정이 해제됩니다. 대직자와 필수업무 담당자 일정을 확인한 뒤 변경할까요?')) return
    const previous = shifts
    const employee = employees.find(item => item.id === employeeId)
    setShifts(list => [...list.filter(item => !(item.employeeId === employeeId && item.date === date)), ...(code ? [{ employeeId, employeeName: employee?.name ?? '', date, code, employmentType: employee?.employmentType }] : [])])
    try { await api('/api/shifts', { method: 'PUT', body: JSON.stringify({ employeeId, date, code }) }); await load(); toast('근무표를 저장했습니다.') }
    catch (e) { setShifts(previous); setError(e instanceof Error ? e.message : '저장하지 못했습니다.') }
  }
  const cycleShift = (shift?: Shift): ShiftCode | '' => shift?.code === 'open' ? 'close' : shift?.code === 'close' ? 'off' : shift?.code === 'off' ? '' : 'open'
  const saveEmployee = async (data: Omit<Employee, 'id'>, id?: number) => {
    try {
      await api(id ? `/api/employees/${id}` : '/api/employees', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) })
      setDialog(null); await load(); toast('직원 정보를 저장했습니다.')
    } catch (e) { setError(e instanceof Error ? e.message : '직원 정보를 저장하지 못했습니다.') }
  }
  const deleteEmployee = async (employee: Employee) => {
    if (!window.confirm(`${employee.name} 직원을 삭제할까요? 기존 근무표와 희망휴무 신청도 삭제됩니다.`)) return
    try { await api(`/api/employees/${employee.id}`, { method: 'DELETE' }); setDialog(null); await load(); toast('직원을 삭제했습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : '직원을 삭제하지 못했습니다.') }
  }
  const saveAccount = async (employee: Employee, username: string, password: string) => {
    try { await api(`/api/users/employee/${employee.id}`, { method: 'PUT', body: JSON.stringify({ username, password }) }); setAccountDialog(null); await load(); toast('직원 계정을 저장했습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : '직원 계정을 저장하지 못했습니다.') }
  }
  const changePassword = async (currentPassword: string, newPassword: string) => {
    try {
      await api('/api/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) })
      setShowPasswordDialog(false); setError(''); toast('비밀번호를 변경했습니다.')
    } catch (e) { setError(e instanceof Error ? e.message : '비밀번호를 변경하지 못했습니다.') }
  }
  const saveSettings = async (value: Settings) => {
    try { setSettings(await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(value) })); await load(); toast('근무 설정을 저장했습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : '설정을 저장하지 못했습니다.') }
  }
  const generate = async (mode: 'replace' | 'fill' | 'rebalance' = 'replace') => {
    if (mode === 'replace' && hasLockedShifts) { setError(`${monthKey(month)}은 입력 근무가 확정되어 있어 전체 자동 편성을 할 수 없습니다. 빈칸 채우기를 사용해 주세요.`); return }
    const selectedMonthKey = monthKey(month)
    const currentMonthKey = todayKey.slice(0, 7)
    const replacementScope = selectedMonthKey > currentMonthKey
      ? `${monthLabel(month)}에 저장된 기존 배정을 모두 교체합니다. 다른 달의 근무표는 변경하지 않습니다.`
      : selectedMonthKey === currentMonthKey
        ? `${todayKey}까지 지난 날짜는 유지하고, 이후 배정만 교체합니다.`
        : `${monthLabel(month)}은 지난 달이라 기존 배정은 모두 유지됩니다.`
    if (mode === 'replace' && !window.confirm(`${monthLabel(month)} 근무표를 새로 편성할까요? ${replacementScope}`)) return
    if (mode === 'rebalance' && !window.confirm(`직접 입력해 고정한 근무와 ${todayKey}까지 지난 날짜는 유지하고, 이후 미고정 배정만 다시 편성합니다. 평일 ${settings.operations.weekdayTarget}명·주말 및 공휴일 ${settings.operations.weekendTarget}명을 목표로 하며, 최소 인원 기준은 각각 ${settings.operations.weekdayMinimum}명·${settings.operations.weekendMinimum}명입니다.`)) return
    setGenerating(true); setError('')
    try {
      const monthValue = monthKey(month)
      const result = await api<{ month: string; mode: 'replace' | 'fill' | 'rebalance'; targetRestDays: number; options: ScheduleOption[]; exhaustive: false; explored: number; nextOffset: number; revision: number }>('/api/shifts/options', { method: 'POST', body: JSON.stringify({ month: monthValue, mode, offset: 0 }) })
      setScheduleOptions(result)
    } catch (e) { setError(e instanceof Error ? e.message : '자동 편성 결과를 만들지 못했습니다.') } finally { setGenerating(false) }
  }
  const findMoreOptions = async () => {
    if (!scheduleOptions) return
    setGenerating(true); setError('')
    try {
      const result = await api<{ options: ScheduleOption[]; explored: number; nextOffset: number; revision: number }>('/api/shifts/options', { method: 'POST', body: JSON.stringify({ month: scheduleOptions.month, mode: scheduleOptions.mode, offset: scheduleOptions.nextOffset }) })
      setScheduleOptions(current => {
        if (!current) return current
        const known = new Set(current.options.map(option => option.shifts.map(shift => `${shift.employeeId}:${shift.date}:${shift.code}`).join('|')))
        const added = result.options.filter(option => !known.has(option.shifts.map(shift => `${shift.employeeId}:${shift.date}:${shift.code}`).join('|'))).map((option, index) => ({ ...option, id: current.options.length + index + 1 }))
        return { ...current, options: [...current.options, ...added], explored: result.explored, nextOffset: result.nextOffset, revision: result.revision }
      })
    } catch (e) { setError(e instanceof Error ? e.message : '추가 대안을 찾지 못했습니다.') } finally { setGenerating(false) }
  }
  const applyScheduleOption = async (option: ScheduleOption) => {
    try {
      await api('/api/shifts/apply-option', { method: 'POST', body: JSON.stringify({ month: scheduleOptions?.month, mode: scheduleOptions?.mode, shifts: option.shifts, revision: scheduleOptions?.revision }) })
      setScheduleOptions(null); await load()
      if (option.warnings.length) setError(`선택한 편성안을 적용했습니다. 확인할 조건: ${option.warnings.slice(0, 6).join(' · ')}${option.warnings.length > 6 ? ` 외 ${option.warnings.length - 6}건` : ''}`)
      else toast(`대안 ${option.id}을 근무표에 적용했습니다.`)
    } catch (e) { setError(e instanceof Error ? e.message : '선택한 편성안을 적용하지 못했습니다.') }
  }
  const lockExistingShifts = async () => {
    try {
      const result = await api<{ locked: number; alreadyLocked: boolean }>('/api/shifts/lock-existing', { method: 'POST', body: JSON.stringify({ month: monthKey(month) }) })
      await load()
      toast(result.alreadyLocked ? `이미 고정된 근무 ${result.locked}칸을 유지했습니다.` : `기존 입력 ${result.locked}칸을 고정했습니다. 빈칸은 계속 편집할 수 있습니다.`)
    } catch (e) { setError(e instanceof Error ? e.message : '기존 입력을 고정하지 못했습니다.') }
  }
  const toggleCellLock = async (shift: Shift) => {
    try {
      await api('/api/shifts/lock-cell', { method: 'POST', body: JSON.stringify({ employeeId: shift.employeeId, date: shift.date, locked: !shift.locked }) })
      await load(); toast(shift.locked ? `${shift.employeeName} · ${shift.date} 고정을 해제했습니다.` : `${shift.employeeName} · ${shift.date} 근무를 자동 편성에서 고정했습니다.`)
    } catch (e) { setError(e instanceof Error ? e.message : '근무 칸을 고정하지 못했습니다.') }
  }
  const resetMonth = async () => {
    const monthName = monthLabel(month)
    const assignedCount = shifts.filter(shift => shift.date.startsWith(monthKey(month)) && !isLockedDate(shift.date)).length
    if (!window.confirm(`${monthName}의 이후 근무 ${assignedCount}건을 초기화할까요? 지난 날짜는 고정되어 유지됩니다. 초기화 전 근무표는 백업됩니다.`)) return
    try {
      const result = await api<{ deleted: number; backup: string; preservedThrough: string }>('/api/shifts/reset', { method: 'POST', body: JSON.stringify({ month: monthKey(month) }) })
      await load()
      toast(`${monthName} 이후 근무 ${result.deleted}건을 초기화했습니다. ${result.preservedThrough}까지는 유지됩니다. 백업 ${result.backup}`)
    } catch (e) { setError(e instanceof Error ? e.message : '근무표를 초기화하지 못했습니다.') }
  }
  const updateRequest = async (item: DayRequest, status: DayRequest['status']) => {
    try { await api(`/api/requests/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); toast('신청 상태를 변경했습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : '신청을 변경하지 못했습니다.') }
  }
  const submitRequests = async () => {
    if (!chosenDates.length) return setError('희망휴무 날짜를 선택해 주세요.')
    try { await api('/api/requests', { method: 'POST', body: JSON.stringify({ dates: chosenDates }) }); setChosenDates([]); await load(); toast('희망휴무 신청을 보냈습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : '희망휴무를 신청하지 못했습니다.') }
  }
  const deleteRequest = async (item: DayRequest) => {
    try { await api(`/api/requests/${item.id}`, { method: 'DELETE' }); await load(); toast('신청을 취소했습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : '신청을 취소하지 못했습니다.') }
  }
  const resolvePhotoNote = async (id: number, resolved: boolean) => {
    try { await api('/api/reference-schedule/import/' + id, { method: 'PATCH', body: JSON.stringify({ resolved }) }); await load(); toast('사진 확인 상태를 저장했습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : '확인 상태를 저장하지 못했습니다.') }
  }
  const toggleDate = (date: string) => setChosenDates(values => values.includes(date) ? values.filter(value => value !== date) : [...values, date].sort())
  const addHoliday = async () => { if (!holidayDate) return; await saveSettings({ ...settings, additionalHolidays: [...new Set([...settings.additionalHolidays, holidayDate])].sort() }); setHolidayDate('') }
  const confirmSchedule = async () => {
    const blockingIssues = issues.filter(item => !/^\d{4}-\d{2}-\d{2} (오픈|마감) 정규직 없음$/.test(item.text))
    if (blockingIssues.length) { setError(`확정 전에 확인이 필요합니다. ${blockingIssues.slice(0, 3).map(item => item.text).join(' · ')}`); return }
    try { await api('/api/shifts/confirm', { method: 'POST', body: JSON.stringify({ month: monthKey(month) }) }); await load(); toast('근무표를 확정했습니다.') } catch (e) { setError(e instanceof Error ? e.message : '확정하지 못했습니다.'); await load() }
  }

  if (!authChecked) return <div className="boot-screen"><BrandMark/><span>왕궁농협 하나로마트</span><i/></div>
  if (!user) return <AuthScreen setup={setupNeeded} setupKeyRequired={setupKeyRequired} error={error} onSubmit={authenticate}/>

  const pageTitle: Record<Page, string> = { schedule: '월간 근무표', requests: '희망휴무', employees: '직원 관리', settings: '운영 설정' }
  const visiblePages: Page[] = isAdmin ? ['schedule', 'requests', 'employees', 'settings'] : ['schedule', 'requests']
  return <div className={`app-shell ${isAdmin ? 'is-admin' : 'is-staff'} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><BrandMark/><div><strong>왕궁농협</strong><span>하나로마트</span></div></div>
      <div className="nav-caption">근무 관리</div>
      <nav className="side-nav" aria-label="주 메뉴">{visiblePages.map(item => <button key={item} title={pageTitle[item]} className={`nav-item ${page === item ? 'active' : ''}`} onClick={() => setPage(item)}><Icon name={item === 'schedule' ? 'calendar' : item === 'requests' ? 'heart' : item === 'employees' ? 'users' : 'settings'}/><span>{pageTitle[item]}</span>{item === 'requests' && isAdmin && pendingCount > 0 && <b className="nav-count">{pendingCount}</b>}</button>)}</nav>
      <div className="sidebar-note"><p>고객의 미래까지<br/>생각하는 왕궁농협</p><span>왕궁농협 하나로마트 · 익산</span></div>
      <div className="sidebar-user"><span className="user-initial">{user.role === 'admin' ? <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg> : user.employeeName?.slice(-1) ?? '직'}</span><div><b>{user.role === 'admin' ? '관리자' : user.employeeName}</b><span>{user.username}</span></div><button title="로그아웃" aria-label="로그아웃" onClick={() => void logout()}><Icon name="logout"/></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="topbar-leading"><button className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'} title={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}><Icon name="menu" size={19}/></button><div className="breadcrumb"><span>왕궁농협 하나로마트</span><i>/</i><b>{pageTitle[page]}</b></div></div><div className="topbar-right"><span className="local-indicator"><i/>서버 저장</span><button className="top-change-password" onClick={() => { setError(''); setShowPasswordDialog(true) }}><Icon name="key" size={15}/> 비밀번호 변경</button><button className="top-logout" onClick={() => void logout()}><Icon name="logout"/> 로그아웃</button></div></header>
      <div className="page-content">
        {error && <div className="alert" role="alert"><span className="alert-mark">!</span><p>{error}</p><button onClick={() => setError('')}>확인</button></div>}
        {page === 'schedule' && <>
          <div className="page-heading"><div><h1>{isAdmin ? '월간 근무표' : `${user.employeeName ?? '내'} 근무 일정`}</h1><p>{isAdmin ? '희망휴무와 매장 운영 조건을 살펴보고 이번 달 일정을 완성하세요.' : '매장 근무 일정을 확인하고 희망휴무를 신청할 수 있어요.'}</p></div><div className="heading-actions"><button className="button button-quiet print-action" onClick={() => window.print()}><Icon name="print"/> 인쇄</button>{isAdmin && <>{referenceAvailable && <button className="button button-quiet reference-open" onClick={() => setShowReference(true)}><Icon name="calendar" size={16}/> 수기 근무표</button>}{hasLockedShifts ? <span className="locked-shifts-badge" role="status">기존 입력 {lockedShiftCount}칸 고정</span> : <button className="button button-quiet" disabled={generating} onClick={() => void lockExistingShifts()}>입력된 칸 고정</button>}<button className="button button-quiet" disabled={generating} onClick={() => void generate('fill')}>빈칸 채우기</button>{hasLockedShifts && <button className="button button-quiet" disabled={generating} title={`기존 고정 입력을 유지하고 평일 ${settings.operations.weekdayTarget}명·주말/공휴일 ${settings.operations.weekendTarget}명을 목표로 편성합니다.`} onClick={() => void generate('rebalance')}>기준으로 재편성</button>}<button className="button button-primary" disabled={generating || hasLockedShifts} title={hasLockedShifts ? '확정된 기존 입력이 있어 빈칸 채우기만 사용할 수 있습니다.' : undefined} onClick={() => void generate()}><Icon name="spark" size={16}/>{generating ? '편성 중…' : '전체 자동 편성'}</button></>}</div></div>
          <section className="schedule-workspace">
            <div className="schedule-toolbar"><div className="month-picker"><button aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><strong>{monthLabel(month)}</strong><button aria-label="다음 달" onClick={() => changeMonth(1)}>›</button><button className="today-button" onClick={goToToday}>오늘</button>{isAdmin && <button className="button button-quiet reset-month" disabled={generating} onClick={() => void resetMonth()}>{monthLabel(month)} 초기화</button>}</div>{viewMode === 'week' && <div className="week-picker"><button aria-label="이전 주" disabled={weekIndex === 0} onClick={() => setWeekIndex(index => Math.max(0, index - 1))}>‹</button><strong>{weekIndex + 1}주차</strong><span>{weekRangeLabel}</span><button aria-label="다음 주" disabled={weekIndex >= weekCount - 1} onClick={() => setWeekIndex(index => Math.min(weekCount - 1, index + 1))}>›</button></div>}<div className="schedule-meta"><span className="meta-pill"><Icon name="clock" size={15}/> 기준 휴무 <b>{restTarget}일</b></span>{isAdmin && <span className={`schedule-status ${confirmed ? 'is-confirmed' : ''}`}><i/>{confirmed ? '확정된 근무표' : '작성 중'}</span>}</div></div>
            {isAdmin && <div className="schedule-summary"><div><span>재직 직원</span><b>{activeEmployees.length}<small>명</small></b></div><div><span>배정 근무</span><b>{workCount}<small>건</small></b></div><div><span>휴무 신청</span><b>{requests.length}<small>건</small></b></div><div><span>확인 항목</span><b className={scheduleNotices.length ? 'number-warn' : ''}>{scheduleNotices.length}<small>건</small></b></div></div>}
            <div className="schedule-legend"><span><i className="key-open"/>오픈</span><span><i className="key-close"/>마감</span><span><i className="key-off"/>휴무</span><span><i className="key-request"/>희망휴무 신청</span><span className="approved-hope-key">희망 승인</span><span className="legend-tip">{isAdmin ? '일정을 누르면 오픈 · 마감 · 휴무 · 비우기 순으로 변경됩니다.' : '본인 일정은 이름 옆에 표시됩니다.'}</span><div className="view-toggle" role="group" aria-label="근무표 보기 방식"><button aria-pressed={viewMode === 'week'} className={viewMode === 'week' ? 'selected' : ''} onClick={() => changeViewMode('week')}>주간</button><button aria-pressed={viewMode === 'calendar'} className={viewMode === 'calendar' ? 'selected' : ''} onClick={() => changeViewMode('calendar')}>월간</button></div></div>
            {loading ? <div className="loading-state"><i/>근무표를 불러오는 중입니다.</div> : <>
              {viewMode === 'week' && <div className="schedule-scroll week-scroll" tabIndex={0} role="region" aria-label="주간 근무표">
                <table className="schedule-table week-table">
                  <thead><tr><th className="staff-col">직원</th>{weekDates.map((slot, column) => {
                    if (!slot) return <th key={`blank-${column}`} className="week-empty-head"><span>—</span></th>
                    const target = slot.d.getDay() === 0 || slot.d.getDay() === 6 || holidayMap.has(slot.date) ? settings.operations.weekendTarget : settings.operations.weekdayTarget
                    const assigned = shifts.filter(shift => shift.date === slot.date && (shift.code === 'open' || shift.code === 'close')).length
                    return <th key={slot.date} className={`${slot.d.getDay() === 0 || holidayMap.has(slot.date) ? 'sunday' : ''} ${slot.d.getDay() === 6 ? 'saturday' : ''}`}><div className="week-day-heading"><span>{weekdays[slot.d.getDay()]}</span><b>{slot.day}일</b></div><small className={assigned < target ? 'staffing-short' : ''}>출근 {assigned}/{target}</small></th>
                  })}<th className="total-col">월 누계</th></tr></thead>
                  <tbody>{activeEmployees.map((employee, row) => {
                    const own = user.role === 'employee' && employee.id === user.employeeId
                    const rest = shifts.filter(shift => shift.employeeId === employee.id && shift.code === 'off').length
                    const opens = shifts.filter(shift => shift.employeeId === employee.id && shift.code === 'open').length
                    const closes = shifts.filter(shift => shift.employeeId === employee.id && shift.code === 'close').length
                    const stats = employeeStats.get(employee.id)
                    return <tr key={employee.id} className={own ? 'own-row' : ''}>
                      <th className="staff-cell"><span className="staff-identity"><span className={`staff-avatar tone-${row % 5}`}>{employee.name.slice(-1)}</span><span className="staff-label"><b>{employee.name}{own && <em>나</em>}</b><small>{employee.employmentType === '정규직' ? '일반직' : employee.name === '정지희' ? '농산 오픈 · 08:00–17:00' : '계약직'}</small></span></span></th>
                      {weekDates.map((slot, column) => {
                        if (!slot) return <td key={`blank-${column}`} className="week-empty-day">—</td>
                        const shift = shiftMap.get(`${employee.id}:${slot.date}`)
                        const request = requests.find(item => item.employeeId === employee.id && item.date === slot.date && item.status !== 'rejected')
                        const approvedHope = isApprovedHopeVisible(slot.date, request)
                        const warning = scheduleNotices.some(item => item.date === slot.date)
                        const hours = shift && shift.code !== 'off' ? (isAdmin ? shiftTimesForEmployee(employee.name, employee.employmentType, shift.code, settings) : shift.start && shift.end ? { start: shift.start, end: shift.end } : null) : null
                        return <td key={slot.date} className={`${slot.d.getDay() === 0 ? 'sunday-col' : ''} ${slot.d.getDay() === 6 ? 'saturday-col' : ''} ${holidayMap.has(slot.date) ? 'holiday-col' : ''} ${warning ? 'warning-cell' : ''}`}><button disabled={!isAdmin || isLockedDate(slot.date) || Boolean(shift?.locked)} className={`shift-chip ${shift?.code ? `shift-${shift.code}` : 'shift-empty'} ${request ? 'has-request' : ''} ${approvedHope ? 'has-approved-hope' : ''} ${isLockedDate(slot.date) || shift?.locked ? 'is-locked' : ''}`} title={`${shift?.locked ? '입력 확정 · 수정 불가 · ' : isLockedDate(slot.date) ? '지난 날짜 고정 · ' : ''}${shift?.code === 'open' ? '오픈' : shift?.code === 'close' ? '마감' : shift?.code === 'off' ? '휴무' : '미정'}${hours ? ` · ${hours.start}–${hours.end}` : ''}${request ? ` · ${employee.name} ${request.status === 'approved' ? '희망휴무 승인' : '희망휴무 신청'}` : ''}`} onClick={() => isAdmin && void saveShift(employee.id, slot.day, cycleShift(shift))}>{shift?.code === 'open' ? '오픈' : shift?.code === 'close' ? '마감' : shift?.code === 'off' ? '휴무' : '미정'}{hours && <small className="shift-hours">{hours.start}–{hours.end}</small>}{shift?.locked && <span className="cell-lock-mark">고정</span>}{approvedHope && <span className="cell-hope-mark">희망</span>}{request && !approvedHope && <i/>}</button>{isAdmin && shift && !isLockedDate(slot.date) && <button type="button" className={`cell-pin ${shift.locked ? 'pinned' : ''}`} aria-label={`${employee.name} ${slot.date} ${shift.locked ? '고정 해제' : '고정'}`} title={shift.locked ? '자동 편성에서 제외 · 클릭해 고정 해제' : '이 칸을 고정해 자동 편성 대안에 유지'} onClick={() => void toggleCellLock(shift)}>{shift.locked ? '◆' : '◇'}</button>}</td>
                      })}
                      <td className={`totals-cell ${rest !== restTarget ? 'rest-mismatch' : ''}`}><div className="totals-content"><b title="휴무일수">휴무 {rest}</b><span><i className="total-open-dot"/>오픈 {opens}</span><span><i className="total-close-dot"/>마감 {closes}</span>{isAdmin && <><small className="rest-comparison">주말 {stats?.weekendWork ?? 0}회</small><small className="rest-comparison">최장 {stats?.longestConsecutive ?? 0}일 연속</small></>}</div></td>
                    </tr>
                  })}</tbody>
                </table>
              </div>}
              {viewMode === 'calendar' && <div className="month-calendar"><div className="calendar-weekdays">{weekdays.map((weekday, i) => <span className={i === 0 ? 'sunday' : i === 6 ? 'saturday' : ''} key={weekday}>{weekday}</span>)}</div><div className="calendar-grid">{Array.from({ length: calendarLead }, (_, i) => <div className="calendar-blank" key={`blank-${i}`}/>)}{Array.from({ length: dayCount }, (_, i) => { const d = new Date(month.getFullYear(), month.getMonth(), i + 1); const date = dateKey(d); const holiday = holidayMap.get(date); const dayIssues = scheduleNotices.filter(item => item.date === date); return <article key={date} className={`calendar-day ${d.getDay() === 0 || holiday ? 'calendar-sunday' : ''} ${d.getDay() === 6 ? 'calendar-saturday' : ''} ${dayIssues.length ? 'calendar-day-warning' : ''}`}><header><b>{i + 1}</b>{holiday && <span>{holiday}</span>}{dayIssues.length > 0 && isAdmin && <small>{dayIssues.length}건 확인</small>}</header>{([['open', '오픈'], ['close', '마감'], ['off', '휴무']] as const).map(([code, label]) => { const assigned = activeEmployees.filter(employee => shiftMap.get(`${employee.id}:${date}`)?.code === code); return <div className="calendar-shift-group" key={code}><span className={`calendar-shift-label ${code}`}>{label}</span><div className="calendar-staff">{assigned.map(employee => { const shift = shiftMap.get(`${employee.id}:${date}`); const request = requests.find(item => item.employeeId === employee.id && item.date === date && item.status !== 'rejected'); const approvedHope = isApprovedHopeVisible(date, request); return <button key={employee.id} type="button" disabled={!isAdmin || isLockedDate(date) || Boolean(shift?.locked)} title={`${employee.name} · ${label}${shift?.locked ? ' · 입력 확정 · 수정 불가' : isLockedDate(date) ? ' · 지난 날짜 고정' : ''}${request ? ` · ${employee.name} ${request.status === 'approved' ? '희망휴무 승인' : '희망휴무 신청'}` : ''}`} className={`calendar-person shift-${code} ${request ? 'has-request' : ''} ${isLockedDate(date) || shift?.locked ? 'is-locked' : ''}`} onClick={() => isAdmin && void saveShift(employee.id, i + 1, cycleShift(shift))}>{employee.name}{shift?.locked && <span> · 고정</span>}{approvedHope && <span className="approved-hope-label">희망</span>}{request && !approvedHope && <i/>}</button> })}{assigned.length === 0 && <small className="calendar-empty">—</small>}</div></div>})}</article> })}</div></div>}
              {viewMode === 'week' && <div className="mobile-days">{weekDates.filter((slot): slot is NonNullable<typeof slot> => slot !== null).map(slot => { const date = slot.date; const holiday = holidayMap.get(date); const dayIssues = scheduleNotices.filter(item => item.date === date); return <article className={`mobile-day ${dayIssues.length ? 'mobile-day-warning' : ''}`} key={date}><header><b>{slot.day}</b><span className={holiday || slot.d.getDay() === 0 ? 'sunday' : slot.d.getDay() === 6 ? 'saturday' : ''}>{weekdays[slot.d.getDay()]}</span>{holiday && <em>{holiday}</em>}<small>{dayIssues.length && isAdmin ? `확인 ${dayIssues.length}건` : ''}</small></header><div className="mobile-people">{activeEmployees.map((employee, index) => { const shift = shiftMap.get(`${employee.id}:${date}`); const request = requests.find(item => item.employeeId === employee.id && item.date === date && item.status !== 'rejected'); const approvedHope = isApprovedHopeVisible(date, request); const own = user.role === 'employee' && employee.id === user.employeeId; const hours = shift && shift.code !== 'off' ? (isAdmin ? shiftTimesForEmployee(employee.name, employee.employmentType, shift.code, settings) : shift.start && shift.end ? { start: shift.start, end: shift.end } : null) : null; return <button key={employee.id} disabled={!isAdmin || isLockedDate(date) || Boolean(shift?.locked)} title={`${employee.name}${request ? ` · ${request.status === 'approved' ? '희망휴무 승인' : '희망휴무 신청'}` : ''}${shift?.locked ? ' · 입력 확정 · 수정 불가' : isLockedDate(date) ? ' · 지난 날짜 고정' : ''}`} className={`mobile-person ${own ? 'own-person' : ''} ${shift?.locked ? 'is-entry-locked' : ''}`} onClick={() => isAdmin && void saveShift(employee.id, slot.day, cycleShift(shift))}><span className={`staff-avatar tone-${index % 5}`}>{employee.name.slice(-1)}</span><span className="mobile-name">{employee.name}{own && <em>나</em>}{approvedHope && <small className="approved-hope-label">희망</small>}{request && !approvedHope && <i className="request-dot"/>}</span><span className={`mobile-shift ${shift ? `shift-${shift.code}` : 'shift-empty'}`}>{shift?.code === 'open' ? '오픈' : shift?.code === 'close' ? '마감' : shift?.code === 'off' ? '휴무' : '미정'}{hours && <small>{hours.start}–{hours.end}</small>}</span></button> })}</div></article> })}</div>}
              {isAdmin && (scheduleNotices.length > 0 || requestWarnings.length > 0) && <div className="issue-panel"><div><b>확인이 필요한 항목</b><span>{scheduleNotices.length}건</span></div>{[...scheduleNotices, ...requestWarnings].map((issue, i) => <p key={`${issue.text}-${i}`}><i/> {issue.text}</p>)}</div>}
            </>}
            <footer className="schedule-footer"><span>{isAdmin ? '근무시간은 직원 설정에 따라 표시됩니다. 확정 전 경고를 확인해 주세요.' : '근무 일정 문의나 변경 요청은 관리자에게 전달해 주세요.'}</span>{isAdmin && <button className="button button-confirm" disabled={confirmed} onClick={() => void confirmSchedule()}>{confirmed ? '근무표 확정됨' : '근무표 확정'} <Icon name="arrow" size={16}/></button>}</footer>
          </section>
          {isAdmin && photoImport?.month === monthKey(month) && (photoImport.entries.length > 0 || photoImport.notes.length > 0) && <section className="settings-section photo-import-panel"><h2>사진 근무표 반영</h2><p>읽을 수 있는 근무 {photoImport.entries.length}건을 반영했습니다. 원본과 비교해 필요한 칸을 수정한 뒤 확인 완료를 눌러 주세요.</p><div className="photo-import-notes">{photoImport.notes.map(note => <article key={note.id} className={note.resolved ? 'resolved-note' : ''}><div><b>{Number(note.date.slice(-2))}일</b><span>{note.text}</span></div><button className="button button-quiet" onClick={() => void resolvePhotoNote(note.id, !note.resolved)}>{note.resolved ? '확인 완료 · 되돌리기' : '확인 완료'}</button></article>)}</div></section>}

        </>}

        {page === 'requests' && <>
          <div className="page-heading"><div><h1>{isAdmin ? '희망휴무 현황' : '희망휴무 신청'}</h1><p>{isAdmin ? '직원들의 신청을 확인하고 일정 편성에 반영하세요.' : '원하는 날짜를 선택해 관리자에게 휴무를 신청하세요.'}</p></div></div>
          <div className="request-layout"><section className="request-picker"><div className="section-heading"><div><h2>{isAdmin ? '직원을 대신해 신청' : '휴무 희망일'}</h2></div><span className="section-emblem"><Icon name="heart" size={22}/></span></div>
            {isAdmin && <label className="select-field">직원<select id="request-employee" defaultValue={activeEmployees[0]?.id}>{activeEmployees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>}
            <div className="month-picker compact"><button aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><strong>{monthLabel(month)}</strong><button aria-label="다음 달" onClick={() => changeMonth(1)}>›</button></div>
            <div className="date-picker-grid">{weekdays.map((day, i) => <span key={day} className={i === 0 ? 'sunday' : i === 6 ? 'saturday' : ''}>{day}</span>)}{Array.from({ length: new Date(month.getFullYear(), month.getMonth(), 1).getDay() }, (_, i) => <i key={`blank-${i}`}/>)}{Array.from({ length: dayCount }, (_, i) => { const date = dateKey(new Date(month.getFullYear(), month.getMonth(), i + 1)); const existing = requests.find(item => item.date === date && item.status !== 'rejected' && (!isAdmin || item.employeeId === Number((document.getElementById('request-employee') as HTMLSelectElement | null)?.value))); const selected = chosenDates.includes(date); return <button key={date} className={`${selected ? 'selected-date' : ''} ${existing ? 'existing-date' : ''} ${holidayMap.has(date) ? 'holiday-date' : ''}`} onClick={() => toggleDate(date)} title={holidayMap.get(date) ?? ''} aria-pressed={selected}><b>{i + 1}</b>{existing && <i/>}</button> })}</div>
            <div className="date-legend"><span><i className="selected-key"/>선택</span><span><i className="requested-key"/>신청 완료</span></div><button className="button button-primary request-submit" disabled={!chosenDates.length} onClick={() => void (async () => { if (isAdmin) { const employeeId = Number((document.getElementById('request-employee') as HTMLSelectElement | null)?.value); if (!employeeId) return; try { await api('/api/requests', { method: 'POST', body: JSON.stringify({ employeeId, dates: chosenDates }) }); setChosenDates([]); await load(); toast('희망휴무 신청을 저장했습니다.') } catch (e) { setError(e instanceof Error ? e.message : '신청을 저장하지 못했습니다.') } } else await submitRequests() })()}>신청 보내기 {chosenDates.length > 0 && <span>{chosenDates.length}일</span>}</button>
          </section><section className="request-results"><div className="section-heading"><div><h2>신청 내역</h2></div>{isAdmin && <span className="pending-chip">대기 {pendingCount}건</span>}</div>
            {requests.length === 0 ? <div className="empty-requests"><div className="empty-drawing"><Icon name="calendar" size={30}/></div><b>신청 내역이 없습니다</b><span>{isAdmin ? '직원이 희망휴무를 신청하면 이곳에 나타납니다.' : '달력에서 희망 날짜를 선택해 신청해 주세요.'}</span></div> : <div className="request-list">{requests.map(item => { const date = new Date(`${item.date}T12:00:00`); return <article className="request-row" key={item.id}><div className="request-date"><b>{date.getDate()}</b><span>{weekdays[date.getDay()]}</span></div><div className="request-person"><b>{item.employeeName}</b><span>{item.date.slice(5).replace('-', '월 ')}일 신청</span></div><span className={`request-status ${item.status}`}>{item.status === 'pending' ? '확인 대기' : item.status === 'approved' ? '승인됨' : '반려'}</span>{isAdmin ? <div className="request-actions">{item.status !== 'approved' && <button onClick={() => void updateRequest(item, 'approved')}>승인</button>}{item.status !== 'rejected' && <button className="reject-action" onClick={() => void updateRequest(item, 'rejected')}>반려</button>}</div> : item.status === 'pending' && <button className="cancel-request" onClick={() => void deleteRequest(item)}>취소</button>}</article> })}</div>}
            <p className="request-note">{isAdmin ? `매월 ${settings.operations.requestDueDay}일 전후 다음 달 필수 희망휴무를 취합하고 ${settings.operations.publishDay}일 전후 근무표를 공유해 주세요. 신청 전 직원 간 날짜를 조정하고, 승인 신청은 자동 편성에 우선 반영됩니다.` : `다음 달에 꼭 필요한 날짜 위주로 매월 ${settings.operations.requestDueDay}일까지 신청해 주세요.${settings.operations.maxWishDaysPerEmployee > 0 ? ` 월 최대 ${settings.operations.maxWishDaysPerEmployee}일까지 신청할 수 있습니다.` : ''} 신청 전 동료와 날짜를 조정해 주세요. 근무표는 ${settings.operations.publishDay}일 전후 공유되며, 확정 후 변경은 관리자와 대직 가능 여부를 먼저 협의해 주세요.`}</p>
          </section></div>
        </>}

        {page === 'employees' && isAdmin && <>
          <div className="page-heading"><div><h1>직원 관리</h1><p>직원 정보와 개인 로그인 계정을 관리합니다.</p></div><button className="button button-primary" onClick={() => setDialog('new')}><Icon name="plus"/> 직원 추가</button></div>
          <section className="people-panel"><div className="people-toolbar"><div><h2>직원 명단 <span>{employees.length}</span></h2><p>재직 {activeEmployees.length}명 · 직원 이름과 채용 구분을 바탕으로 편성 조건을 자동 적용합니다.</p></div><label className="search-field"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름 검색"/></label></div>
            <div className="people-list">{employees.filter(item => item.name.includes(search)).map((employee, i) => { const account = accounts.find(item => item.employeeId === employee.id); return <article key={employee.id} className={`people-row ${!isActive(employee) ? 'inactive-person' : ''}`}><span className={`staff-avatar tone-${i % 5}`}>{employee.name.slice(-1)}</span><div className="person-details"><b>{employee.name}</b><span>{employee.employmentType === '정규직' ? '일반직' : employee.name === '정지희' ? '농산 오픈 · 08:00–17:00' : '계약직'}{employee.notes ? ` · ${employee.notes}` : ''}</span></div><span className="employment-label">{employee.employmentType === '정규직' ? '일반직' : '계약직'}</span><span className={`employment-label ${isActive(employee) ? 'active-label' : 'inactive-label'}`}>{isActive(employee) ? '재직' : '퇴사'}</span><span className={`account-label ${account ? 'account-ready' : ''}`}><i/>{account ? `계정 ${account.username}` : '계정 미발급'}</span><button className="row-action" onClick={() => setAccountDialog(employee)}>{account ? '계정 관리' : '계정 발급'}</button><button className="row-action row-edit" onClick={() => setDialog(employee)}>정보 수정 <Icon name="arrow" size={15}/></button></article> })}</div>
            {employees.length === 0 && <div className="empty-requests"><b>등록된 직원이 없습니다</b><span>직원 추가 버튼으로 명단을 시작하세요.</span></div>}
          </section>
        </>}

        {page === 'settings' && isAdmin && <>
          <div className="page-heading"><div><h1>운영 설정</h1><p>근무시간과 일정 편성 조건을 관리합니다.</p></div><button className="button button-primary" onClick={() => void saveSettings(settings)}>설정 저장</button></div>
          <div className="settings-layout"><section className="settings-section"><div className="section-heading"><div><h2>오픈 · 마감 시간</h2></div><span className="section-emblem"><Icon name="clock" size={22}/></span></div><div className="times-grid"><div className="time-header"><span>유형</span><span>구분</span><span>시작</span><span>종료</span></div>{(['open', 'close'] as const).flatMap(type => (['regular', 'contract'] as const).map((kind, i) => <div className="time-line" key={`${type}-${kind}`}><b>{i === 0 ? type === 'open' ? '오픈' : '마감' : ''}</b><span>{kind === 'regular' ? '정규직' : '계약직'}</span><input type="time" aria-label={`${type} ${kind} 시작시간`} value={shiftTime(settings, type, kind).start} onChange={e => setSettings(value => ({ ...value, shiftTimes: { ...value.shiftTimes, [type]: { ...shiftTimeGroup(value, type), [kind]: { ...shiftTime(value, type, kind), start: e.target.value } } } }))}/><input type="time" aria-label={`${type} ${kind} 종료시간`} value={shiftTime(settings, type, kind).end} onChange={e => setSettings(value => ({ ...value, shiftTimes: { ...value.shiftTimes, [type]: { ...shiftTimeGroup(value, type), [kind]: { ...shiftTime(value, type, kind), end: e.target.value } } } }))}/></div>))}</div><p className="setting-help">근무표에는 직원 구분에 맞는 시간이 표시됩니다.</p></section>
            <section className="settings-section operations-settings"><div className="section-heading"><div><h2>편성 규칙</h2><p>현재 인원 규모에 맞게 숫자를 직접 조정하세요.</p></div><span className="section-emblem"><Icon name="spark" size={20}/></span></div><label className="rule-mode">인원 산정 방식 <select value={settings.operations.staffingMode} onChange={event => setSettings(value => ({ ...value, operations: { ...value.operations, staffingMode: event.target.value as Operations["staffingMode"] } }))}><option value="combined">전체 직원 합산</option><option value="employmentType">정규직·계약직 별도 산정</option></select></label><div className="rule-number-grid">{((settings.operations.staffingMode === 'combined' ? [['weekdayTarget', '평일 전체 목표 출근 (명)'], ['weekdayMinimum', '평일 전체 최소 출근 (명)'], ['weekendTarget', '주말·공휴일 전체 목표 (명)'], ['weekendMinimum', '주말·공휴일 전체 최소 (명)']] : [['weekdayRegularTarget', '평일 정규직 목표 (명)'], ['weekdayRegularMinimum', '평일 정규직 최소 (명)'], ['weekdayContractTarget', '평일 계약직 목표 (명)'], ['weekdayContractMinimum', '평일 계약직 최소 (명)'], ['weekendRegularTarget', '주말·공휴일 정규직 목표 (명)'], ['weekendRegularMinimum', '주말·공휴일 정규직 최소 (명)'], ['weekendContractTarget', '주말·공휴일 계약직 목표 (명)'], ['weekendContractMinimum', '주말·공휴일 계약직 최소 (명)']]).concat([['functionalMinOnDuty', '일반직 최소 출근 (명)'], ['supportMaxOff', '계약직 최대 휴무 (명)'], ['supportMaxRequestsPerDate', '계약직 날짜별 희망휴무 한도 (명)'], ['maxConsecutiveWorkDays', '최대 연속근무 (일)'], ['maxWishDaysPerEmployee', '월 희망휴무 한도 (일)'], ['requestDueDay', '희망휴무 취합일 (매월 일)'], ['publishDay', '근무표 공유일 (매월 일)']]) as [NumericOperation, string][]).map(([key, label]) => <label className="rule-number" key={key}><span>{label}</span><input type="number" min={key === 'maxConsecutiveWorkDays' || key === 'maxWishDaysPerEmployee' ? 0 : key === 'functionalMinOnDuty' || key === 'produceOpenCount' || key === 'supportMaxRequestsPerDate' ? 0 : 1} max={key === 'requestDueDay' || key === 'publishDay' ? 28 : key === 'maxConsecutiveWorkDays' || key === 'maxWishDaysPerEmployee' ? 31 : 20} value={settings.operations[key]} onChange={event => setSettings(value => ({ ...value, operations: { ...value.operations, [key]: Number(event.target.value) } }))}/></label>)}</div><label className="rule-toggle"><input type="checkbox" checked={settings.operations.requireRegularEachShift} onChange={event => setSettings(value => ({ ...value, operations: { ...value.operations, requireRegularEachShift: event.target.checked } }))}/><span>오픈·마감에 일반직을 각각 한 명 이상 배치</span></label><div className="produce-exceptions"><label>농산 오픈 예외 날짜 <input type="date" min={`${monthKey(month)}-01`} max={`${monthKey(month)}-${String(new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()).padStart(2, '0')}`} value={produceExceptionDate} onChange={event => setProduceExceptionDate(event.target.value)}/></label><button type="button" disabled={!produceExceptionDate || settings.produceOpenExceptions.includes(produceExceptionDate)} onClick={() => { setSettings(value => ({ ...value, produceOpenExceptions: [...new Set([...value.produceOpenExceptions, produceExceptionDate])].sort() })); setProduceExceptionDate('') }}>이 날짜 예외</button><div className="exception-date-list">{settings.produceOpenExceptions.filter(date => date.startsWith(`${monthKey(month)}-`)).map(date => <button type="button" key={date} onClick={() => setSettings(value => ({ ...value, produceOpenExceptions: value.produceOpenExceptions.filter(item => item !== date) }))}>{date} 예외 해제 ×</button>)}{settings.produceOpenExceptions.filter(date => date.startsWith(`${monthKey(month)}-`)).length === 0 && <span>선택한 달에 지정된 예외가 없습니다.</span>}</div><p>선택한 날짜는 농산 담당 오픈 필수 규칙을 자동 편성·검증에서 제외합니다. 저장 후 적용됩니다.</p></div><p className="setting-help">최대 연속근무와 희망휴무 한도, 날짜별 희망휴무 한도는 0이면 제한하지 않습니다. 최소 인원은 같은 구분의 목표 인원보다 클 수 없습니다. 별도 산정은 정규직·계약직 기준을 각각 적용합니다. 희망휴무 신청 기준일과 근무표 공유일은 직원 화면 안내에 반영됩니다.</p></section>
            <section className="settings-section"><div className="section-heading"><div><h2>동시 휴무 제한</h2></div><span className="section-emblem"><span className="pair-glyph">↔</span></span></div><p className="settings-intro">같은 날 휴무로 편성할 수 없는 직원 조합</p><div className="pair-list">{settings.daysOffPairs.map((pair, index) => <div className="pair-line" key={index}><b>{employees.find(e => e.id === pair.employeeIds[0])?.name ?? '직원'}</b><span>함께 쉬지 않도록</span><b>{employees.find(e => e.id === pair.employeeIds[1])?.name ?? '직원'}</b><button onClick={() => setSettings(value => ({ ...value, daysOffPairs: value.daysOffPairs.filter((_, i) => i !== index) }))}>삭제</button></div>)}{settings.daysOffPairs.length === 0 && <p className="no-pairs">등록된 제한이 없습니다.</p>}<PairAdder employees={activeEmployees} onAdd={pair => setSettings(value => ({ ...value, daysOffPairs: [...value.daysOffPairs, { employeeIds: pair }] }))} existing={settings.daysOffPairs}/></div><p className="setting-help">두 직원 조합은 자동 편성과 확정 시 같은 날 휴무를 금지합니다. 제한을 추가한 뒤 위의 설정 저장을 눌러 주세요. 직원 구분과 정지희 오픈시간은 이름에 따라 자동 적용됩니다.</p></section>
            <section className="settings-section holiday-settings"><div className="section-heading"><div><h2>공휴일 · 기준 휴무</h2></div><span className="section-emblem"><Icon name="calendar" size={22}/></span></div><div className="holiday-count"><b>{restTarget}<small>일</small></b><span>{monthLabel(month)} 직원별 기준 휴무<br/><button onClick={() => changeMonth(-1)}>‹ 이전 달</button><button onClick={() => changeMonth(1)}>다음 달 ›</button></span></div><div className="holiday-list">{holidays.filter(item => item.date.startsWith(monthKey(month))).map(item => <div key={item.date}><span>{item.date.slice(5).replace('-', '월 ')}일</span><b>{item.name}</b>{settings.additionalHolidays.includes(item.date) && <button onClick={() => void saveSettings({ ...settings, additionalHolidays: settings.additionalHolidays.filter(date => date !== item.date) })}>삭제</button>}</div>)}{holidays.filter(item => item.date.startsWith(monthKey(month))).length === 0 && <p className="no-pairs">이번 달 공휴일이 없습니다.</p>}</div><div className="add-holiday"><input type="date" value={holidayDate} onChange={e => setHolidayDate(e.target.value)}/><button disabled={!holidayDate} onClick={() => void addHoliday()}>추가</button></div><p className="setting-help">주말과 공휴일을 합쳐 휴무 기준을 계산합니다.</p></section>
            <section className="settings-section planning-rules"><div className="section-heading"><div><h2>편성 기준 요약</h2></div><span className="section-emblem"><Icon name="spark" size={20}/></span></div><ol><li>{settings.operations.staffingMode === "combined" ? `전체 합산: 평일 목표 ${settings.operations.weekdayTarget}명·최소 ${settings.operations.weekdayMinimum}명, 주말·공휴일 목표 ${settings.operations.weekendTarget}명·최소 ${settings.operations.weekendMinimum}명` : `정규직·계약직 별도: 평일 정규직 ${settings.operations.weekdayRegularTarget}/${settings.operations.weekdayRegularMinimum}명, 계약직 ${settings.operations.weekdayContractTarget}/${settings.operations.weekdayContractMinimum}명 · 주말·공휴일 정규직 ${settings.operations.weekendRegularTarget}/${settings.operations.weekendRegularMinimum}명, 계약직 ${settings.operations.weekendContractTarget}/${settings.operations.weekendContractMinimum}명 (목표/최소)`}</li><li>일반직 하루 최소 {settings.operations.functionalMinOnDuty}명 출근, 계약직 휴무 최대 {settings.operations.supportMaxOff}명·날짜별 희망휴무 {settings.operations.supportMaxRequestsPerDate || '제한 없음'}명</li><li>지정한 동시 휴무 조합은 자동 편성과 확정에서 제한</li><li>직원별 기준 휴무일수와 주별 분산을 지키고, 오픈·마감·주말 근무를 균형 배분</li><li>{settings.operations.maxConsecutiveWorkDays ? `연속근무 ${settings.operations.maxConsecutiveWorkDays}일 초과는 편성하지 않음` : '연속근무 현황을 확인해 관리자가 조정'}</li><li>매월 {settings.operations.requestDueDay}일 전후 희망휴무 취합, {settings.operations.publishDay}일 전후 다음 달 근무표 공유</li><li>확정 후 변경은 대직 가능 여부와 필수업무를 확인한 뒤 최소화</li></ol></section>
          </div>
          <AdminAccountsPanel accounts={accounts} currentUserId={user.id} onChanged={() => void load()}/>
        </>}
      </div>
    </main>
    {notice && <div className="toast-message"><Icon name="check" size={17}/>{notice}</div>}
    {scheduleOptions && isAdmin && <div className="modal-backdrop option-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setScheduleOptions(null) }}><section className="option-dialog" role="dialog" aria-modal="true" aria-labelledby="options-title"><header><div><h2 id="options-title">자동 편성 대안</h2><p>{scheduleOptions.month} · 기준 휴무 {scheduleOptions.targetRestDays}일 · 대안을 검토하고 적용할 안을 선택하세요.</p></div><button type="button" className="close-button" onClick={() => setScheduleOptions(null)} aria-label="닫기">×</button></header><div className="option-explainer">계산을 {scheduleOptions.explored}회 실행해 서로 다른 안 {scheduleOptions.options.length}개를 찾았습니다. 전체 조합의 수학적 열거는 아니며, 대안을 더 찾아 후보를 계속 늘릴 수 있습니다. 각 안의 경고를 확인한 뒤 적용하세요.</div><div className="option-list">{scheduleOptions.options.map(option => <article key={option.id} className="option-card"><div className="option-card-heading"><div><span>대안 {option.id}</span><b>{option.warnings.length ? `확인 항목 ${option.warnings.length}건` : '표시된 운영 기준 충족'}</b></div><button className="button button-primary" onClick={() => void applyScheduleOption(option)}>이 안 적용</button></div>{option.warnings.length > 0 && <ul>{option.warnings.slice(0, 4).map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}{option.warnings.length > 4 && <small>그 외 {option.warnings.length - 4}건</small>}</article>)}</div><footer><button className="button button-quiet" disabled={generating || scheduleOptions.nextOffset >= 100000} onClick={() => void findMoreOptions()}>{generating ? '다른 안 탐색 중…' : '다른 대안 더 탐색'}</button><button className="button button-quiet" onClick={() => setScheduleOptions(null)}>취소</button></footer></section></div>}
    {showReference && isAdmin && <div className="modal-backdrop reference-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowReference(false) }}><section className="reference-viewer" role="dialog" aria-modal="true" aria-labelledby="reference-title"><header><div><h2 id="reference-title">수기 근무표 참고</h2><p>관리자 전용 · 업로드한 원본 이미지</p></div><button type="button" className="close-button" onClick={() => setShowReference(false)} aria-label="닫기">×</button></header><div className="reference-image-wrap"><img src="/api/reference-schedule" alt="왕궁농협 하나로마트 수기 근무표 참고 이미지"/></div></section></div>}
    {showPasswordDialog && <PasswordDialog onClose={() => setShowPasswordDialog(false)} onSave={changePassword}/>}
    {dialog && isAdmin && <EmployeeDialog employee={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} onSave={saveEmployee} onDelete={deleteEmployee}/>}
    {accountDialog && isAdmin && <AccountDialog employee={accountDialog} account={accounts.find(item => item.employeeId === accountDialog.id)} onClose={() => setAccountDialog(null)} onSave={saveAccount}/>}
  </div>
}

function AuthScreen({ setup, setupKeyRequired, error, onSubmit }: { setup: boolean; setupKeyRequired: boolean; error: string; onSubmit: (username: string, password: string, setup: boolean, setupKey: string) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [setupKey, setSetupKey] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setFormError('')
    if (setup && password !== confirm) return setFormError('비밀번호 확인이 일치하지 않습니다.')
    setBusy(true)
    try { await onSubmit(username, password, setup, setupKey) } catch (e) { setFormError(e instanceof Error ? e.message : '로그인하지 못했습니다.') } finally { setBusy(false) }
  }
  return <main className="auth-screen"><div className="auth-landscape" aria-hidden="true"><span/><i/><b/></div><section className="auth-card"><BrandMark/><h1>{setup ? '관리자 계정 만들기' : '근무표에 로그인'}</h1><p className="auth-description">{setup ? '처음 한 번, 관리자 아이디와 비밀번호를 설정해 주세요.' : '왕궁농협 하나로마트 근무 관리'}</p><form onSubmit={submit}>{setup && setupKeyRequired && <label>최초 관리자 설정 키<input required autoComplete="off" type="password" value={setupKey} onChange={e => setSetupKey(e.target.value)} placeholder="배포 담당자가 전달한 설정 키"/></label>}<label>아이디<input required autoComplete="username" minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} placeholder="사용할 아이디"/></label><label>비밀번호<input required type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 10 : 1} value={password} onChange={e => setPassword(e.target.value)} placeholder={setup ? '10자 이상' : '비밀번호 입력'}/></label>{setup && <label>비밀번호 확인<input required type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="비밀번호를 다시 입력"/></label>}{(formError || error) && <div className="auth-error">{formError || error}</div>}<button className="button button-primary auth-submit" disabled={busy}>{busy ? '확인 중…' : setup ? '관리자 계정 생성' : '로그인'}<Icon name="arrow"/></button></form><p className="auth-footnote">계정과 근무 정보는 안전한 서버에 저장됩니다.</p></section><footer className="auth-footer">왕궁농협 하나로마트 <span>·</span> 직원 근무 관리</footer></main>
}

function PairAdder({ employees, onAdd, existing }: { employees: Employee[]; onAdd: (pair: number[]) => void; existing: { employeeIds: number[] }[] }) {
  const [one, setOne] = useState(''); const [two, setTwo] = useState('')
  const add = () => { const pair = [Number(one), Number(two)]; if (pair[0] && pair[1] && pair[0] !== pair[1] && !existing.some(item => item.employeeIds.every(id => pair.includes(id)))) { onAdd(pair); setOne(''); setTwo('') } }
  return <div className="pair-adder"><select aria-label="첫 번째 직원" value={one} onChange={e => setOne(e.target.value)}><option value="">직원 선택</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><span>↔</span><select aria-label="두 번째 직원" value={two} onChange={e => setTwo(e.target.value)}><option value="">직원 선택</option>{employees.filter(employee => String(employee.id) !== one).map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><button disabled={!one || !two} onClick={add}>제한 추가</button></div>
}

function AdminAccountsPanel({ accounts, currentUserId, onChanged }: { accounts: Account[]; currentUserId: number; onChanged: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const admins = accounts.filter(account => account.role === 'admin')
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true)
    try { await api('/api/users/admin', { method: 'POST', body: JSON.stringify({ username, password }) }); setUsername(''); setPassword(''); onChanged() }
    catch (error) { window.alert(error instanceof Error ? error.message : '관리자 계정을 만들지 못했습니다.') }
    finally { setBusy(false) }
  }
  const resetPassword = async (account: Account) => {
    const nextPassword = window.prompt(`${account.username} 관리자의 새 비밀번호를 입력하세요. (10자 이상)`)
    if (!nextPassword) return
    try { await api(`/api/users/admin/${account.id}/password`, { method: 'PUT', body: JSON.stringify({ password: nextPassword }) }); window.alert('비밀번호를 변경했고 기존 로그인 세션을 종료했습니다.') }
    catch (error) { window.alert(error instanceof Error ? error.message : '비밀번호를 변경하지 못했습니다.') }
  }
  const remove = async (account: Account) => {
    if (!window.confirm(`${account.username} 관리자 계정을 삭제할까요?`)) return
    try { await api(`/api/users/admin/${account.id}`, { method: 'DELETE' }); onChanged() }
    catch (error) { window.alert(error instanceof Error ? error.message : '관리자 계정을 삭제하지 못했습니다.') }
  }
  return <section className="settings-section admin-accounts"><div className="section-heading"><div><h2>관리자 계정</h2><p>관리자 계정은 2개까지 운영할 수 있습니다.</p></div><span className="section-emblem"><Icon name="users" size={20}/></span></div><div className="admin-account-list">{admins.map(account => <div className="admin-account-row" key={account.id}><span className="user-initial">관리</span><div><b>{account.username}</b><small>{account.id === currentUserId ? '현재 로그인' : '관리자'}</small></div>{account.id !== currentUserId && <><button className="button button-quiet" onClick={() => void resetPassword(account)}>비밀번호 재설정</button><button className="delete-button" onClick={() => void remove(account)}>삭제</button></>}</div>)}</div>{admins.length < 2 && <form className="admin-account-form" onSubmit={create}><label className="form-field">새 관리자 아이디<input required minLength={3} maxLength={32} pattern="[a-zA-Z0-9._-]+" value={username} onChange={event => setUsername(event.target.value)} placeholder="영문·숫자 3자 이상"/></label><label className="form-field">초기 비밀번호<input required minLength={10} maxLength={128} type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="10자 이상"/></label><button className="button button-primary" disabled={busy}>{busy ? '생성 중…' : '관리자 추가'}</button></form>}</section>
}

function EmployeeDialog({ employee, onClose, onSave, onDelete }: { employee: Employee | null; onClose: () => void; onSave: (data: Omit<Employee, 'id'>, id?: number) => void; onDelete: (employee: Employee) => void }) {
  const [name, setName] = useState(employee?.name ?? '')
  const [employmentType, setEmploymentType] = useState<Employee['employmentType']>(employee?.employmentType ?? '정규직')
  const [dutyType, setDutyType] = useState<DutyType>(employee?.dutyType ?? (employee?.employmentType === '계약직' ? 'support' : 'functional'))
  const [produceQualified, setProduceQualified] = useState(Boolean(employee?.produceQualified))
  const [active, setActive] = useState(employee ? isActive(employee) : true)
  const [notes, setNotes] = useState(employee?.notes ?? '')
  const [workRules, setWorkRules] = useState<WorkRules>(employee?.workRules ?? { allowedShifts: ['open', 'close'], offRules: [] })
  const toggleOff = (weekday: number, occurrence: number) => setWorkRules(value => {
    const selected = value.offRules.find(rule => rule.weekday === weekday)?.occurrences ?? []
    const occurrences = selected.includes(occurrence) ? selected.filter(n => n !== occurrence) : [...selected, occurrence].sort()
    return { ...value, offRules: [...value.offRules.filter(rule => rule.weekday !== weekday), ...(occurrences.length ? [{ weekday, occurrences }] : [])] }
  })
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim()) onSave({ name: name.trim(), employmentType, dutyType, produceQualified, active, notes, workRules }, employee?.id) }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="dialog-card" onSubmit={submit}><header><div><h2>{employee ? '직원 정보 수정' : '새 직원 추가'}</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="닫기">×</button></header><label className="form-field">직원명<input autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder="이름 입력"/></label><label className="form-field">채용 구분<select value={employmentType} onChange={e => setEmploymentType(e.target.value as Employee['employmentType'])}><option value="정규직">일반직</option><option value="계약직">계약직</option></select></label><label className="form-field">담당 직무<select value={dutyType} onChange={e => setDutyType(e.target.value as DutyType)}><option value="functional">일반직</option><option value="support">계약직 업무</option><option value="other">기타</option></select></label><label className="rule-toggle employee-produce-toggle"><input type="checkbox" checked={produceQualified} onChange={e => setProduceQualified(e.target.checked)}/><span>농산 담당 직원</span></label><label className="form-field">재직 여부<div className="segmented-control"><button type="button" className={active ? 'selected' : ''} onClick={() => setActive(true)}>재직</button><button type="button" className={!active ? 'selected' : ''} onClick={() => setActive(false)}>퇴사</button></div></label><label className="form-field">특이사항 (메모)<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="직원별로 필요한 참고 사항을 적어 주세요."/></label><label className="form-field">가능한 근무<select value={workRules.allowedShifts.length === 2 ? 'both' : workRules.allowedShifts[0]} onChange={e => setWorkRules(value => ({ ...value, allowedShifts: e.target.value === 'both' ? ['open', 'close'] : [e.target.value as 'open' | 'close'] }))}><option value="both">오픈·마감 모두 가능</option><option value="open">오픈만 가능</option><option value="close">마감만 가능</option></select></label><fieldset className="recurring-rules"><legend>정기휴무 · 매월 몇 번째 요일</legend><p>정기휴무를 설정할 수 있습니다. 월 기준 휴무는 지키고 쉬는 날은 주별로 고르게 나눕니다.</p>{weekdays.map((weekday, day) => <div className="recurring-row" key={day}><b>{weekday}</b>{[1, 2, 3, 4, 5].map(n => <label key={n}><input type="checkbox" aria-label={`${weekday}요일 ${n}번째 정기휴무`} checked={workRules.offRules.some(rule => rule.weekday === day && rule.occurrences.includes(n))} onChange={() => toggleOff(day, n)}/>{n}번째</label>)}</div>)}</fieldset><footer>{employee && <button type="button" className="delete-button" onClick={() => onDelete(employee)}>직원 삭제</button>}<div><button type="button" className="button button-quiet" onClick={onClose}>취소</button><button className="button button-primary">저장</button></div></footer></form></div>
}

function AccountDialog({ employee, account, onClose, onSave }: { employee: Employee; account?: Account; onClose: () => void; onSave: (employee: Employee, username: string, password: string) => void }) {
  const [username, setUsername] = useState(account?.username ?? '')
  const [password, setPassword] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(employee, username, password) }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="dialog-card account-dialog" onSubmit={submit}><header><div><h2>{employee.name}</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="닫기">×</button></header><p className="dialog-note">직원은 이 계정으로 로그인해 근무표와 본인의 휴무 신청을 확인합니다.</p><label className="form-field">로그인 아이디<input required minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} placeholder="영문 또는 숫자 3자 이상"/></label><label className="form-field">{account ? '새 비밀번호 (변경할 때만 입력)' : '초기 비밀번호'}<input type="password" minLength={account ? 0 : 10} required={!account} value={password} onChange={e => setPassword(e.target.value)} placeholder={account ? '변경하지 않으면 비워 두세요' : '10자 이상'}/></label><footer><span className="dialog-note">비밀번호는 저장 후 다시 볼 수 없습니다.</span><div><button type="button" className="button button-quiet" onClick={onClose}>취소</button><button className="button button-primary">계정 저장</button></div></footer></form></div>
}

function PasswordDialog({ onClose, onSave }: { onClose: () => void; onSave: (currentPassword: string, newPassword: string) => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setFormError('')
    if (newPassword !== confirmPassword) return setFormError('새 비밀번호 확인이 일치하지 않습니다.')
    setBusy(true)
    try { await onSave(currentPassword, newPassword) } finally { setBusy(false) }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="dialog-card" onSubmit={event => void submit(event)}><header><div><h2>비밀번호 변경</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="닫기">×</button></header><p className="dialog-note">새 비밀번호는 10자 이상으로 설정해 주세요.</p><label className="form-field">현재 비밀번호<input autoFocus required type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/></label><label className="form-field">새 비밀번호<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="10자 이상"/></label><label className="form-field">새 비밀번호 확인<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="새 비밀번호를 다시 입력"/></label>{formError && <div className="auth-error">{formError}</div>}<footer><span className="dialog-note">다른 로그인 기기에서는 다시 로그인해야 합니다.</span><div><button type="button" className="button button-quiet" onClick={onClose}>취소</button><button className="button button-primary" disabled={busy}>{busy ? '저장 중…' : '비밀번호 저장'}</button></div></footer></form></div>
}

export default App
