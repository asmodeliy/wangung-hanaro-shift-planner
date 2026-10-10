import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User, Validation, Employee, ShiftCode, Shift, DayRequest, Account, Settings, PhotoImport, Holiday, ScheduleOption, ScheduleHistoryItem, Page } from '../types'
import { todayKey, today, defaultSettings, monthLabel, monthKey, dateKey, isLockedDate, isActive } from '../lib/schedule'
import { api } from '../lib/api'

export function useApp() {
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
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null)
  const [showScheduleHistory, setShowScheduleHistory] = useState(false)
  const [scheduleHistory, setScheduleHistory] = useState<ScheduleHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
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
  const [pastEditDate, setPastEditDate] = useState('')
  const [accountDialog, setAccountDialog] = useState<Employee | null>(null)
  const [showReference, setShowReference] = useState(false)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('wangung-sidebar') === 'collapsed')
  const [viewMode, setViewMode] = useState<'table' | 'week' | 'calendar'>(() => {
    const savedView = localStorage.getItem('wangung-schedule-view')
    return savedView === 'calendar' || savedView === 'week' ? savedView : 'table'
  })
  const [dismissedNoticeKeys, setDismissedNoticeKeys] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('wangung-dismissed-schedule-notices') ?? '{}') as Record<string, string[]> }
    catch { return {} }
  })
  const [weekIndex, setWeekIndex] = useState(() => Math.floor((today.getDate() - 1 + (new Date(today.getFullYear(), today.getMonth(), 1).getDay() + 6) % 7) / 7))

  const toggleSidebar = () => setSidebarCollapsed(value => {
    const next = !value
    localStorage.setItem('wangung-sidebar', next ? 'collapsed' : 'expanded')
    return next
  })
  const changeViewMode = (value: 'table' | 'week' | 'calendar') => {
    localStorage.setItem('wangung-schedule-view', value)
    setViewMode(value)
  }
  const dismissNotice = (notice: { date?: string; text: string }) => {
    const key = `${notice.date ?? ''}:${notice.text}`
    setDismissedNoticeKeys(current => {
      const monthNotices = [...new Set([...(current[monthKey(month)] ?? []), key])]
      const next = { ...current, [monthKey(month)]: monthNotices }
      localStorage.setItem('wangung-dismissed-schedule-notices', JSON.stringify(next))
      return next
    })
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
  const monthSlots = Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1
    const d = new Date(month.getFullYear(), month.getMonth(), day)
    return { day, date: dateKey(d), d }
  })
  const shiftMap = useMemo(() => new Map(shifts.map(s => [`${s.employeeId}:${s.date}`, s])), [shifts])
  const holidayMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays])
  const restTarget = useMemo(() => Array.from({ length: dayCount }, (_, i) => { const date = dateKey(new Date(month.getFullYear(), month.getMonth(), i + 1)); const weekday = new Date(`${date}T12:00:00`).getDay(); return weekday === 0 || weekday === 6 || holidayMap.has(date) ? 1 : 0 }).reduce<number>((a, b) => a + b, 0), [dayCount, month, holidayMap])
  const pendingCount = requests.filter(item => item.status === 'pending').length
  const workCount = shifts.filter(item => item.code === 'open' || item.code === 'close' || item.code === 'full').length
  const confirmed = settings.confirmedMonths.includes(monthKey(month))
  const lockedShiftCount = shifts.filter(item => item.date.startsWith(`${monthKey(month)}-`) && item.locked).length
  const hasLockedShifts = lockedShiftCount > 0
  const isAdmin = user?.role === 'admin'
  const issues = isAdmin ? [...validation.issues, ...validation.pending] : []
  const validationWarnings = isAdmin ? (validation.warnings ?? []).filter(item => !item.text.includes('최소 운영 기준 충족') && !item.text.includes('최소 기준 충족')) : []
  const scheduleNotices = [...issues, ...validationWarnings]
  const employeeStats = new Map(validation.stats.map(stat => [stat.employeeId, stat]))
  const requestWarnings = requests.filter(item => item.status !== 'rejected' && shiftMap.get(item.employeeId + ':' + item.date)?.code !== 'off').map(item => ({ date: item.date, text: item.employeeName + ': ' + item.date + ' 희망휴무 미반영' }))
  const hiddenNoticeSet = new Set(dismissedNoticeKeys[monthKey(month)] ?? [])
  const visibleScheduleNotices = scheduleNotices.filter(item => !hiddenNoticeSet.has(`${item.date ?? ''}:${item.text}`))
  const visibleRequestWarnings = requestWarnings.filter(item => !hiddenNoticeSet.has(`${item.date ?? ''}:${item.text}`))
  const selectedOption = scheduleOptions?.options.find(option => option.id === selectedOptionId) ?? scheduleOptions?.options[0]
  const previewDays = scheduleOptions ? Array.from({ length: new Date(Number(scheduleOptions.month.slice(0, 4)), Number(scheduleOptions.month.slice(5, 7)), 0).getDate() }, (_, index) => index + 1) : []
  const previewShifts = useMemo(() => new Map((selectedOption?.shifts ?? []).map(shift => [`${shift.employeeId}:${shift.date}`, shift.code])), [selectedOption])

  const toast = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
  const openScheduleHistory = async () => {
    setShowScheduleHistory(true); setHistoryLoading(true)
    try { setScheduleHistory(await api<ScheduleHistoryItem[]>(`/api/shifts/history?month=${monthKey(month)}`)) }
    catch (e) { setError(e instanceof Error ? e.message : '변경 이력을 불러오지 못했습니다.') }
    finally { setHistoryLoading(false) }
  }
  const restoreScheduleHistory = async (item: ScheduleHistoryItem) => {
    if (!window.confirm(`${item.month} ${new Date(item.createdAt).toLocaleString('ko-KR')} 상태로 되돌릴까요? 현재 상태도 이력에 저장되어 다시 복원할 수 있습니다.`)) return
    try {
      const result = await api<{ restored: number; omittedEmployees: number; keptPastDates: number }>(`/api/shifts/history/${item.id}/restore`, { method: 'POST' })
      await load(); await openScheduleHistory()
      toast(`${item.month} 근무표를 복원했습니다.${result.omittedEmployees ? ` 삭제된 직원 ${result.omittedEmployees}건의 배정은 제외했습니다.` : ''}${result.keptPastDates ? ` 지난 날짜 ${result.keptPastDates}건은 현재 값을 유지했습니다.` : ''}`)
    } catch (e) { setError(e instanceof Error ? e.message : '근무표를 복원하지 못했습니다.') }
  }
  const changeMonth = (delta: number) => { setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1)); setWeekIndex(0) }
  const goToToday = () => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setWeekIndex(Math.floor((today.getDate() - 1 + (new Date(today.getFullYear(), today.getMonth(), 1).getDay() + 6) % 7) / 7)) }
  const authenticate = async (username: string, password: string, setup: boolean, setupKey: string) => {
    const result = await api<{ user: User }>(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, setupKey }) })
    setUser(result.user); setSetupNeeded(false); setPage('schedule'); setError('')
  }
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST' }) } finally { setUser(null); setEmployees([]); setShifts([]); setRequests([]) } }
  const saveShift = async (employeeId: number, day: number, code: ShiftCode | '') => {
    const date = dateKey(new Date(month.getFullYear(), month.getMonth(), day))
    if (isLockedDate(date, settings)) { setError(`${date}는 지난 날짜라 고정되어 수정할 수 없습니다.`); return }
    if (shiftMap.get(`${employeeId}:${date}`)?.locked) { setError(`${date}에 입력한 근무는 확정되어 수정할 수 없습니다.`); return }
    if (confirmed && !window.confirm('확정된 근무표를 수정하면 확정이 해제됩니다. 대직자와 필수업무 담당자 일정을 확인한 뒤 변경할까요?')) return
    const previous = shifts
    const employee = employees.find(item => item.id === employeeId)
    setShifts(list => [...list.filter(item => !(item.employeeId === employeeId && item.date === date)), ...(code ? [{ employeeId, employeeName: employee?.name ?? '', date, code, employmentType: employee?.employmentType }] : [])])
    try {
      await api('/api/shifts', { method: 'PUT', body: JSON.stringify({ employeeId, date, code }) })
      if (confirmed) setSettings(current => ({ ...current, confirmedMonths: current.confirmedMonths.filter(item => item !== monthKey(month)) }))
      try { setValidation(await api<Validation>(`/api/shifts/validation?month=${monthKey(month)}`)) } catch { /* Keep the saved schedule visible if validation refresh fails. */ }
      toast('근무표를 저장했습니다.')
    }
    catch (e) { setShifts(previous); setError(e instanceof Error ? e.message : '저장하지 못했습니다.') }
  }
  const cycleShift = (shift?: Shift): ShiftCode | '' => shift?.code === 'open' ? 'close' : shift?.code === 'close' ? 'full' : shift?.code === 'full' ? 'off' : shift?.code === 'off' ? '' : 'open'
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
      setSelectedOptionId(result.options[0]?.id ?? null)
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
      const result = await api<{ locked: boolean }>('/api/shifts/lock-cell', { method: 'POST', body: JSON.stringify({ employeeId: shift.employeeId, date: shift.date, locked: !shift.locked }) })
      setShifts(current => current.map(item => item.employeeId === shift.employeeId && item.date === shift.date ? { ...item, locked: result.locked } : item))
      toast(shift.locked ? `${shift.employeeName} · ${shift.date} 고정을 해제했습니다.` : `${shift.employeeName} · ${shift.date} 근무를 자동 편성에서 고정했습니다.`)
    } catch (e) { setError(e instanceof Error ? e.message : '근무 칸을 고정하지 못했습니다.') }
  }
  const resetMonth = async () => {
    const monthName = monthLabel(month)
    const assignedCount = shifts.filter(shift => shift.date.startsWith(monthKey(month)) && !isLockedDate(shift.date, settings)).length
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

  return { authChecked, setAuthChecked, setupNeeded, setSetupNeeded, setupKeyRequired, setSetupKeyRequired, user, setUser, page, setPage, month, setMonth, employees, setEmployees, shifts, setShifts, requests, setRequests, settings, setSettings, holidays, setHolidays, accounts, setAccounts, validation, setValidation, generating, setGenerating, scheduleOptions, setScheduleOptions, selectedOptionId, setSelectedOptionId, showScheduleHistory, setShowScheduleHistory, scheduleHistory, setScheduleHistory, historyLoading, setHistoryLoading, photoImport, setPhotoImport, referenceAvailable, setReferenceAvailable, loading, setLoading, error, setError, notice, setNotice, dialog, setDialog, search, setSearch, chosenDates, setChosenDates, holidayDate, setHolidayDate, produceExceptionDate, setProduceExceptionDate, pastEditDate, setPastEditDate, accountDialog, setAccountDialog, showReference, setShowReference, showPasswordDialog, setShowPasswordDialog, sidebarCollapsed, setSidebarCollapsed, viewMode, setViewMode, dismissedNoticeKeys, setDismissedNoticeKeys, weekIndex, setWeekIndex, toggleSidebar, changeViewMode, dismissNotice, load, activeEmployees, dayCount, calendarLead, mondayLead, weekCount, weekDates, weekLabel, weekRangeLabel, monthSlots, shiftMap, holidayMap, restTarget, pendingCount, workCount, confirmed, lockedShiftCount, hasLockedShifts, isAdmin, issues, validationWarnings, scheduleNotices, employeeStats, requestWarnings, hiddenNoticeSet, visibleScheduleNotices, visibleRequestWarnings, selectedOption, previewDays, previewShifts, toast, openScheduleHistory, restoreScheduleHistory, changeMonth, goToToday, authenticate, logout, saveShift, cycleShift, saveEmployee, deleteEmployee, saveAccount, changePassword, saveSettings, generate, findMoreOptions, applyScheduleOption, lockExistingShifts, toggleCellLock, resetMonth, updateRequest, submitRequests, deleteRequest, resolvePhotoNote, toggleDate, addHoliday, confirmSchedule }
}

export type AppState = ReturnType<typeof useApp>
