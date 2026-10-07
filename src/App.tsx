import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import './App.css'

type Role = 'admin' | 'employee'
type User = { id: number; username: string; role: Role; employeeId: number | null; employeeName: string | null }
type Employee = { id: number; name: string; employmentType?: '정규직' | '계약직'; active: number | boolean; notes: string }
type ShiftCode = 'open' | 'close' | 'off'
type Shift = { employeeId: number; employeeName: string; date: string; code: ShiftCode; employmentType?: Employee['employmentType']; start?: string | null; end?: string | null }
type DayRequest = { id: number; employeeId: number; employeeName: string; date: string; status: 'pending' | 'approved' | 'rejected' }
type Account = { id: number; username: string; role: Role; employeeId: number | null; employeeName: string | null }
type Times = { start: string; end: string }
type Settings = { shiftTimes: Record<'open' | 'close', Record<'regular' | 'contract', Times>>; daysOffPairs: { employeeIds: number[] }[]; additionalHolidays: string[]; confirmedMonths: string[] }
type Holiday = { date: string; name: string }
type Page = 'schedule' | 'requests' | 'employees' | 'settings'

const weekdays = ['일', '월', '화', '수', '목', '금', '토']
const today = new Date()
const defaultSettings: Settings = { shiftTimes: { open: { regular: { start: '08:00', end: '17:00' }, contract: { start: '08:30', end: '17:30' } }, close: { regular: { start: '11:00', end: '20:00' }, contract: { start: '11:00', end: '20:00' } } }, daysOffPairs: [], additionalHolidays: [], confirmedMonths: [] }
const monthLabel = (date: Date) => `${date.getFullYear()}년 ${date.getMonth() + 1}월`
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const isActive = (employee: Employee) => employee.active === true || employee.active === 1

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? '요청을 처리하지 못했습니다.')
  }
  return response.status === 204 ? undefined as T : response.json()
}

function Icon({ name, size = 18 }: { name: 'calendar' | 'users' | 'heart' | 'settings' | 'logout' | 'arrow' | 'plus' | 'clock' | 'check' | 'print' | 'spark'; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    heart: <><path d="M20.8 8.6c0 5.2-8.8 10.2-8.8 10.2S3.2 13.8 3.2 8.6a4.6 4.6 0 0 1 8.8-1.9 4.6 4.6 0 0 1 8.8 1.9Z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.8Z" transform="translate(-2 -2)"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>, plus: <path d="M12 5v14M5 12h14"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>, print: <><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></>, spark: <><path d="m12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M9 28.5c7.2-.7 13.8-7.3 15.2-16.7C15.3 12.1 9 18.5 9 28.5Z"/><path d="M11.5 30.5c6.7-6.2 12.4-10.5 19.8-14.1M20.3 18.3c-.3-3.2-1.8-5.6-4.4-7.4M24.1 15.2c2.1 1 4.5 1 7.2 0"/><path d="M8 32h24"/></svg></div>
}

function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [page, setPage] = useState<Page>('schedule')
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [requests, setRequests] = useState<DayRequest[]>([])
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<Employee | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [chosenDates, setChosenDates] = useState<string[]>([])
  const [holidayDate, setHolidayDate] = useState('')
  const [accountDialog, setAccountDialog] = useState<Employee | null>(null)
  const [showReference, setShowReference] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const status = await api<{ setupNeeded: boolean }>('/api/auth/status')
        setSetupNeeded(status.setupNeeded)
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
        const [savedSettings, accountRows] = await Promise.all([api<Settings>('/api/settings'), api<Account[]>('/api/users')])
        setSettings(savedSettings); setAccounts(accountRows)
      }
    } catch (e) { setError(e instanceof Error ? e.message : '서버에 연결할 수 없습니다.') }
    finally { setLoading(false) }
  }, [month, user])
  useEffect(() => { void load() }, [load])

  const activeEmployees = useMemo(() => employees.filter(isActive), [employees])
  const dayCount = useMemo(() => new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(), [month])
  const shiftMap = useMemo(() => new Map(shifts.map(s => [`${s.employeeId}:${s.date}`, s])), [shifts])
  const holidayMap = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays])
  const restTarget = useMemo(() => Array.from({ length: dayCount }, (_, i) => { const date = dateKey(new Date(month.getFullYear(), month.getMonth(), i + 1)); const weekday = new Date(`${date}T12:00:00`).getDay(); return weekday === 0 || weekday === 6 || holidayMap.has(date) ? 1 : 0 }).reduce<number>((a, b) => a + b, 0), [dayCount, month, holidayMap])
  const pendingCount = requests.filter(item => item.status === 'pending').length
  const workCount = shifts.filter(item => item.code === 'open' || item.code === 'close').length
  const confirmed = settings.confirmedMonths.includes(monthKey(month))
  const isAdmin = user?.role === 'admin'

  const issues = useMemo(() => {
    const result: { date?: string; text: string }[] = []
    if (isAdmin && shifts.length < activeEmployees.length * dayCount) result.push({ text: `미편성 근무 ${activeEmployees.length * dayCount - shifts.length}칸이 있습니다.` })
    if (isAdmin) for (let d = 1; d <= dayCount; d++) {
      const date = dateKey(new Date(month.getFullYear(), month.getMonth(), d))
      const byId = new Map(activeEmployees.map(employee => [employee.id, shiftMap.get(`${employee.id}:${date}`)?.code]))
      const openRegular = activeEmployees.filter(e => e.employmentType === '정규직' && byId.get(e.id) === 'open').length
      const closeRegular = activeEmployees.filter(e => e.employmentType === '정규직' && byId.get(e.id) === 'close').length
      if (!openRegular) result.push({ date, text: `${d}일 오픈 정규직 없음` })
      if (!closeRegular) result.push({ date, text: `${d}일 마감 정규직 없음` })
      for (const pair of settings.daysOffPairs) if (pair.employeeIds.length === 2 && pair.employeeIds.every(id => byId.get(id) === 'off')) result.push({ date, text: `${d}일 동시휴무 제한 확인` })
    }
    if (isAdmin) for (const employee of activeEmployees) {
      const rest = shifts.filter(s => s.employeeId === employee.id && s.code === 'off').length
      if (rest !== restTarget) result.push({ text: `${employee.name}: 기준 휴무 ${restTarget}일 / 배정 ${rest}일` })
    }
    const applicableRequests = isAdmin ? requests.filter(r => r.status !== 'rejected') : requests
    for (const request of applicableRequests) if (shiftMap.get(`${request.employeeId}:${request.date}`)?.code !== 'off') result.push({ date: request.date, text: `${request.employeeName}: ${Number(request.date.slice(-2))}일 희망휴무 미반영` })
    return result
  }, [isAdmin, shifts, activeEmployees, dayCount, month, shiftMap, settings.daysOffPairs, restTarget, requests])

  const toast = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
  const changeMonth = (delta: number) => setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  const authenticate = async (username: string, password: string, setup: boolean) => {
    const result = await api<{ user: User }>(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
    setUser(result.user); setSetupNeeded(false); setPage('schedule'); setError('')
  }
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST' }) } finally { setUser(null); setEmployees([]); setShifts([]); setRequests([]) } }
  const saveShift = async (employeeId: number, day: number, code: ShiftCode | '') => {
    const date = dateKey(new Date(month.getFullYear(), month.getMonth(), day))
    const previous = shifts
    const employee = employees.find(item => item.id === employeeId)
    setShifts(list => [...list.filter(item => !(item.employeeId === employeeId && item.date === date)), ...(code ? [{ employeeId, employeeName: employee?.name ?? '', date, code, employmentType: employee?.employmentType }] : [])])
    try { await api('/api/shifts', { method: 'PUT', body: JSON.stringify({ employeeId, date, code }) }); toast('근무표를 저장했습니다.') }
    catch (e) { setShifts(previous); setError(e instanceof Error ? e.message : '저장하지 못했습니다.') }
  }
  const cycleShift = (shift?: Shift) => shift?.code === 'open' ? 'close' : shift?.code === 'close' ? 'off' : 'open'
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
  const saveSettings = async (value: Settings) => {
    try { setSettings(await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(value) })); await load(); toast('근무 설정을 저장했습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : '설정을 저장하지 못했습니다.') }
  }
  const generate = async () => {
    if (!window.confirm(`${monthLabel(month)} 근무표를 새로 편성할까요? 현재 월의 배정이 교체됩니다.`)) return
    try {
      const result = await api<{ targetRestDays: number; warnings: string[] }>('/api/shifts/generate', { method: 'POST', body: JSON.stringify({ month: monthKey(month) }) })
      await load()
      if (result.warnings.length) setError(`근무표를 만들었습니다. 아래 조건은 확인해 주세요. ${result.warnings.slice(0, 4).join(' · ')}${result.warnings.length > 4 ? ` 외 ${result.warnings.length - 4}건` : ''}`)
      else toast(`자동 편성 완료 · 기준 휴무 ${result.targetRestDays}일`)
    } catch (e) { setError(e instanceof Error ? e.message : '자동 편성 결과를 만들지 못했습니다.') }
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
  const toggleDate = (date: string) => setChosenDates(values => values.includes(date) ? values.filter(value => value !== date) : [...values, date].sort())
  const addHoliday = async () => { if (!holidayDate) return; await saveSettings({ ...settings, additionalHolidays: [...new Set([...settings.additionalHolidays, holidayDate])].sort() }); setHolidayDate('') }
  const confirmSchedule = async () => {
    if (issues.length) { setError(`확정 전에 확인이 필요합니다. ${issues.slice(0, 3).map(item => item.text).join(' · ')}`); return }
    await saveSettings({ ...settings, confirmedMonths: [...new Set([...settings.confirmedMonths, monthKey(month)])] })
  }

  if (!authChecked) return <div className="boot-screen"><BrandMark/><span>왕궁농협 하나로마트</span><i/></div>
  if (!user) return <AuthScreen setup={setupNeeded} error={error} onSubmit={authenticate}/>

  const pageTitle: Record<Page, string> = { schedule: '월간 근무표', requests: '희망휴무', employees: '직원 관리', settings: '운영 설정' }
  const visiblePages: Page[] = isAdmin ? ['schedule', 'requests', 'employees', 'settings'] : ['schedule', 'requests']
  return <div className={`app-shell ${isAdmin ? 'is-admin' : 'is-staff'}`}>
    <aside className="sidebar">
      <div className="brand"><BrandMark/><div><strong>왕궁농협</strong><span>하나로마트</span></div></div>
      <div className="nav-caption">근무 관리</div>
      <nav className="side-nav" aria-label="주 메뉴">{visiblePages.map(item => <button key={item} className={`nav-item ${page === item ? 'active' : ''}`} onClick={() => setPage(item)}><Icon name={item === 'schedule' ? 'calendar' : item === 'requests' ? 'heart' : item === 'employees' ? 'users' : 'settings'}/><span>{pageTitle[item]}</span>{item === 'requests' && isAdmin && pendingCount > 0 && <b className="nav-count">{pendingCount}</b>}</button>)}</nav>
      <div className="sidebar-note"><p>함께 일하는 하루가<br/>좋은 매장을 만듭니다.</p><span>WANGUNG · IKSAN</span></div>
      <div className="sidebar-user"><span className="user-initial">{user.role === 'admin' ? '관' : user.employeeName?.slice(-1) ?? '직'}</span><div><b>{user.role === 'admin' ? '관리자' : user.employeeName}</b><span>{user.username}</span></div><button title="로그아웃" aria-label="로그아웃" onClick={() => void logout()}><Icon name="logout"/></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>왕궁농협 하나로마트</span><i>/</i><b>{pageTitle[page]}</b></div><div className="topbar-right"><span className="local-indicator"><i/>이 기기에 저장</span><button className="top-logout" onClick={() => void logout()}><Icon name="logout"/> 로그아웃</button></div></header>
      <div className="page-content">
        {error && <div className="alert" role="alert"><span className="alert-mark">!</span><p>{error}</p><button onClick={() => setError('')}>확인</button></div>}
        {page === 'schedule' && <>
          <div className="page-heading"><div><h1>{isAdmin ? '월간 근무표' : `${user.employeeName ?? '내'} 근무 일정`}</h1><p>{isAdmin ? '희망휴무와 매장 운영 조건을 살펴보고 이번 달 일정을 완성하세요.' : '매장 근무 일정을 확인하고 희망휴무를 신청할 수 있어요.'}</p></div><div className="heading-actions"><button className="button button-quiet print-action" onClick={() => window.print()}><Icon name="print"/> 인쇄</button>{isAdmin && <><button className="button button-quiet reference-open" onClick={() => setShowReference(true)}><Icon name="calendar" size={16}/> 수기 근무표</button><button className="button button-primary" onClick={() => void generate()}><Icon name="spark" size={16}/> 자동 편성</button></>}</div></div>
          <section className="schedule-workspace">
            <div className="schedule-toolbar"><div className="month-picker"><button aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><strong>{monthLabel(month)}</strong><button aria-label="다음 달" onClick={() => changeMonth(1)}>›</button><button className="today-button" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>오늘</button></div><div className="schedule-meta"><span className="meta-pill"><Icon name="clock" size={15}/> 기준 휴무 <b>{restTarget}일</b></span>{isAdmin && <span className={`schedule-status ${confirmed ? 'is-confirmed' : ''}`}><i/>{confirmed ? '확정된 근무표' : '작성 중'}</span>}</div></div>
            {isAdmin && <div className="schedule-summary"><div><span>재직 직원</span><b>{activeEmployees.length}<small>명</small></b></div><div><span>배정 근무</span><b>{workCount}<small>건</small></b></div><div><span>휴무 신청</span><b>{requests.length}<small>건</small></b></div><div><span>확인 항목</span><b className={issues.length ? 'number-warn' : ''}>{issues.length}<small>건</small></b></div></div>}
            <div className="schedule-legend"><span><i className="key-open"/>오픈</span><span><i className="key-close"/>마감</span><span><i className="key-off"/>휴무</span><span><i className="key-request"/>희망휴무 신청</span><span className="legend-tip">{isAdmin ? '일정을 누르면 오픈 · 마감 · 휴무 순으로 변경됩니다.' : '본인 일정은 이름 옆에 표시됩니다.'}</span></div>
            {loading ? <div className="loading-state"><i/>근무표를 불러오는 중입니다.</div> : <>
              <div className="schedule-scroll"><table className="schedule-table"><thead><tr><th className="staff-col">직원</th>{Array.from({ length: dayCount }, (_, i) => { const d = new Date(month.getFullYear(), month.getMonth(), i + 1); const date = dateKey(d); return <th key={i} className={`${d.getDay() === 0 || holidayMap.has(date) ? 'sunday' : ''} ${d.getDay() === 6 ? 'saturday' : ''} ${holidayMap.has(date) ? 'holiday-head' : ''}`}><span>{weekdays[d.getDay()]}</span><b>{i + 1}</b></th> })}<th className="total-col">합계</th></tr></thead><tbody>{activeEmployees.map((employee, row) => {
                const own = user.role === 'employee' && employee.id === user.employeeId
                const rest = shifts.filter(s => s.employeeId === employee.id && s.code === 'off').length
                const opens = shifts.filter(s => s.employeeId === employee.id && s.code === 'open').length
                const closes = shifts.filter(s => s.employeeId === employee.id && s.code === 'close').length
                return <tr key={employee.id} className={own ? 'own-row' : ''}><th className="staff-cell"><span className={`staff-avatar tone-${row % 5}`}>{employee.name.slice(-1)}</span><span className="staff-label"><b>{employee.name}{own && <em>나</em>}</b>{isAdmin && <small>{employee.employmentType}</small>}</span></th>{Array.from({ length: dayCount }, (_, i) => {
                  const d = new Date(month.getFullYear(), month.getMonth(), i + 1); const date = dateKey(d); const shift = shiftMap.get(`${employee.id}:${date}`); const request = requests.find(item => item.employeeId === employee.id && item.date === date && item.status !== 'rejected'); const warning = issues.some(item => item.date === date); const hours = shift && shift.code !== 'off' ? (isAdmin ? settings.shiftTimes[shift.code][shift.employmentType === '계약직' ? 'contract' : 'regular'] : shift.start && shift.end ? { start: shift.start, end: shift.end } : null) : null
                  return <td key={i} className={`${d.getDay() === 0 ? 'sunday-col' : ''} ${d.getDay() === 6 ? 'saturday-col' : ''} ${holidayMap.has(date) ? 'holiday-col' : ''} ${warning ? 'warning-cell' : ''}`}><button disabled={!isAdmin} className={`shift-chip ${shift?.code ? `shift-${shift.code}` : 'shift-empty'} ${request ? 'has-request' : ''}`} title={`${shift?.code === 'open' ? '오픈' : shift?.code === 'close' ? '마감' : shift?.code === 'off' ? '휴무' : '미정'}${hours ? ` · ${hours.start}–${hours.end}` : ''}${request ? ' · 희망휴무 신청' : ''}`} onClick={() => isAdmin && void saveShift(employee.id, i + 1, cycleShift(shift))}>{shift?.code === 'open' ? '오픈' : shift?.code === 'close' ? '마감' : shift?.code === 'off' ? '휴무' : '·'}{request && <i/>}</button></td>
                })}<td className="totals-cell"><b>{rest}</b><span><i className="total-open-dot"/>{opens}</span><span><i className="total-close-dot"/>{closes}</span></td></tr>
              })}</tbody></table></div>
              <div className="mobile-days">{Array.from({ length: dayCount }, (_, i) => { const d = new Date(month.getFullYear(), month.getMonth(), i + 1); const date = dateKey(d); const holiday = holidayMap.get(date); const dayIssues = issues.filter(item => item.date === date); return <article className={`mobile-day ${dayIssues.length ? 'mobile-day-warning' : ''}`} key={date}><header><b>{i + 1}</b><span className={holiday || d.getDay() === 0 ? 'sunday' : d.getDay() === 6 ? 'saturday' : ''}>{weekdays[d.getDay()]}</span>{holiday && <em>{holiday}</em>}<small>{dayIssues.length && isAdmin ? `확인 ${dayIssues.length}건` : ''}</small></header><div className="mobile-people">{activeEmployees.map((employee, index) => { const shift = shiftMap.get(`${employee.id}:${date}`); const request = requests.some(item => item.employeeId === employee.id && item.date === date && item.status !== 'rejected'); const own = user.role === 'employee' && employee.id === user.employeeId; const hours = shift && shift.code !== 'off' ? (isAdmin ? settings.shiftTimes[shift.code][shift.employmentType === '계약직' ? 'contract' : 'regular'] : shift.start && shift.end ? { start: shift.start, end: shift.end } : null) : null; return <button key={employee.id} disabled={!isAdmin} className={`mobile-person ${own ? 'own-person' : ''}`} onClick={() => isAdmin && void saveShift(employee.id, i + 1, cycleShift(shift))}><span className={`staff-avatar tone-${index % 5}`}>{employee.name.slice(-1)}</span><span className="mobile-name">{employee.name}{own && <em>나</em>}{request && <i className="request-dot"/>}</span><span className={`mobile-shift ${shift ? `shift-${shift.code}` : 'shift-empty'}`}>{shift?.code === 'open' ? '오픈' : shift?.code === 'close' ? '마감' : shift?.code === 'off' ? '휴무' : '미정'}{hours && <small>{hours.start}–{hours.end}</small>}</span></button> })}</div>{dayIssues.length > 0 && isAdmin && <p className="mobile-warning">확인: {dayIssues.map(item => item.text).join(' · ')}</p>}</article> })}</div>
            </>}
            {isAdmin && issues.length > 0 && <div className="issue-panel"><div><b>확인이 필요한 항목</b><span>{issues.length}건</span></div>{issues.slice(0, 6).map((issue, i) => <p key={`${issue.text}-${i}`}><i/> {issue.text}</p>)}</div>}
            <footer className="schedule-footer"><span>{isAdmin ? '근무시간은 직원 설정에 따라 표시됩니다. 확정 전 경고를 확인해 주세요.' : '근무 일정 문의나 변경 요청은 관리자에게 전달해 주세요.'}</span>{isAdmin && <button className="button button-confirm" disabled={confirmed} onClick={() => void confirmSchedule()}>{confirmed ? '근무표 확정됨' : '근무표 확정'} <Icon name="arrow" size={16}/></button>}</footer>
          </section>
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
            <p className="request-note">{isAdmin ? '자동 편성은 승인 신청을 우선 반영하며, 남은 희망일도 가능한 범위에서 고려합니다.' : '신청 상태는 이 화면에서 확인할 수 있습니다. 확정된 근무표는 관리자에게 문의해 주세요.'}</p>
          </section></div>
        </>}

        {page === 'employees' && isAdmin && <>
          <div className="page-heading"><div><h1>직원 관리</h1><p>직원 정보와 개인 로그인 계정을 관리합니다.</p></div><button className="button button-primary" onClick={() => setDialog('new')}><Icon name="plus"/> 직원 추가</button></div>
          <section className="people-panel"><div className="people-toolbar"><div><h2>직원 명단 <span>{employees.length}</span></h2><p>재직 {activeEmployees.length}명 · 계정은 직원별로 발급합니다.</p></div><label className="search-field"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름 검색"/></label></div>
            <div className="people-list">{employees.filter(item => item.name.includes(search)).map((employee, i) => { const account = accounts.find(item => item.employeeId === employee.id); return <article key={employee.id} className={`people-row ${!isActive(employee) ? 'inactive-person' : ''}`}><span className={`staff-avatar tone-${i % 5}`}>{employee.name.slice(-1)}</span><div className="person-details"><b>{employee.name}</b><span>{employee.notes || '별도 근무 조건 없음'}</span></div><span className="employment-label">{employee.employmentType}</span><span className={`employment-label ${isActive(employee) ? 'active-label' : 'inactive-label'}`}>{isActive(employee) ? '재직' : '퇴사'}</span><span className={`account-label ${account ? 'account-ready' : ''}`}><i/>{account ? `계정 ${account.username}` : '계정 미발급'}</span><button className="row-action" onClick={() => setAccountDialog(employee)}>{account ? '계정 관리' : '계정 발급'}</button><button className="row-action row-edit" onClick={() => setDialog(employee)}>정보 수정 <Icon name="arrow" size={15}/></button></article> })}</div>
            {employees.length === 0 && <div className="empty-requests"><b>등록된 직원이 없습니다</b><span>직원 추가 버튼으로 명단을 시작하세요.</span></div>}
          </section>
        </>}

        {page === 'settings' && isAdmin && <>
          <div className="page-heading"><div><h1>운영 설정</h1><p>근무시간과 일정 편성 조건을 관리합니다.</p></div><button className="button button-primary" onClick={() => void saveSettings(settings)}>설정 저장</button></div>
          <div className="settings-layout"><section className="settings-section"><div className="section-heading"><div><h2>오픈 · 마감 시간</h2></div><span className="section-emblem"><Icon name="clock" size={22}/></span></div><div className="times-grid"><div className="time-header"><span>유형</span><span>구분</span><span>시작</span><span>종료</span></div>{(['open', 'close'] as const).flatMap(type => (['regular', 'contract'] as const).map((kind, i) => <div className="time-line" key={`${type}-${kind}`}><b>{i === 0 ? type === 'open' ? '오픈' : '마감' : ''}</b><span>{kind === 'regular' ? '정규직' : '계약직'}</span><input type="time" aria-label={`${type} ${kind} 시작시간`} value={settings.shiftTimes[type][kind].start} onChange={e => setSettings(value => ({ ...value, shiftTimes: { ...value.shiftTimes, [type]: { ...value.shiftTimes[type], [kind]: { ...value.shiftTimes[type][kind], start: e.target.value } } } }))}/><input type="time" aria-label={`${type} ${kind} 종료시간`} value={settings.shiftTimes[type][kind].end} onChange={e => setSettings(value => ({ ...value, shiftTimes: { ...value.shiftTimes, [type]: { ...value.shiftTimes[type], [kind]: { ...value.shiftTimes[type][kind], end: e.target.value } } } }))}/></div>))}</div><p className="setting-help">근무표에는 직원 구분에 맞는 시간이 표시됩니다.</p></section>
            <section className="settings-section"><div className="section-heading"><div><h2>동시 휴무 제한</h2></div><span className="section-emblem"><span className="pair-glyph">↔</span></span></div><p className="settings-intro">같은 날 휴무로 편성할 수 없는 직원 조합</p><div className="pair-list">{settings.daysOffPairs.map((pair, index) => <div className="pair-line" key={index}><b>{employees.find(e => e.id === pair.employeeIds[0])?.name ?? '직원'}</b><span>함께 쉬지 않도록</span><b>{employees.find(e => e.id === pair.employeeIds[1])?.name ?? '직원'}</b><button onClick={() => setSettings(value => ({ ...value, daysOffPairs: value.daysOffPairs.filter((_, i) => i !== index) }))}>삭제</button></div>)}{settings.daysOffPairs.length === 0 && <p className="no-pairs">등록된 제한이 없습니다.</p>}<PairAdder employees={activeEmployees} onAdd={pair => setSettings(value => ({ ...value, daysOffPairs: [...value.daysOffPairs, { employeeIds: pair }] }))} existing={settings.daysOffPairs}/></div><p className="setting-help">자동 편성 시 가능한 범위에서 제한을 지키며, 어려운 항목은 경고로 알려드립니다.</p></section>
            <section className="settings-section holiday-settings"><div className="section-heading"><div><h2>공휴일 · 기준 휴무</h2></div><span className="section-emblem"><Icon name="calendar" size={22}/></span></div><div className="holiday-count"><b>{restTarget}<small>일</small></b><span>{monthLabel(month)} 직원별 기준 휴무<br/><button onClick={() => changeMonth(-1)}>‹ 이전 달</button><button onClick={() => changeMonth(1)}>다음 달 ›</button></span></div><div className="holiday-list">{holidays.filter(item => item.date.startsWith(monthKey(month))).map(item => <div key={item.date}><span>{item.date.slice(5).replace('-', '월 ')}일</span><b>{item.name}</b>{settings.additionalHolidays.includes(item.date) && <button onClick={() => void saveSettings({ ...settings, additionalHolidays: settings.additionalHolidays.filter(date => date !== item.date) })}>삭제</button>}</div>)}{holidays.filter(item => item.date.startsWith(monthKey(month))).length === 0 && <p className="no-pairs">이번 달 공휴일이 없습니다.</p>}</div><div className="add-holiday"><input type="date" value={holidayDate} onChange={e => setHolidayDate(e.target.value)}/><button disabled={!holidayDate} onClick={() => void addHoliday()}>추가</button></div><p className="setting-help">주말과 공휴일을 합쳐 휴무 기준을 계산합니다.</p></section>
            <section className="settings-section planning-rules"><div className="section-heading"><div><h2>적용 순서</h2></div><span className="section-emblem"><Icon name="spark" size={20}/></span></div><ol><li>승인된 희망휴무를 먼저 반영</li><li>직원별 기준 휴무일수에 맞춰 배정</li><li>동시휴무 제한과 근무 인원을 고려</li><li>오픈과 마감 횟수를 균형 있게 배분</li><li>조건 충돌이 남으면 일정을 만들고 확인 알림 표시</li></ol></section>
          </div>
        </>}
      </div>
    </main>
    {notice && <div className="toast-message"><Icon name="check" size={17}/>{notice}</div>}
    {showReference && isAdmin && <div className="modal-backdrop reference-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowReference(false) }}><section className="reference-viewer" role="dialog" aria-modal="true" aria-labelledby="reference-title"><header><div><h2 id="reference-title">수기 근무표 참고</h2><p>관리자 전용 · 업로드한 원본 이미지</p></div><button type="button" className="close-button" onClick={() => setShowReference(false)} aria-label="닫기">×</button></header><div className="reference-image-wrap"><img src="/api/reference-schedule" alt="왕궁농협 하나로마트 수기 근무표 참고 이미지"/></div></section></div>}
    {dialog && isAdmin && <EmployeeDialog employee={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} onSave={saveEmployee} onDelete={deleteEmployee}/>}
    {accountDialog && isAdmin && <AccountDialog employee={accountDialog} account={accounts.find(item => item.employeeId === accountDialog.id)} onClose={() => setAccountDialog(null)} onSave={saveAccount}/>}
  </div>
}

function AuthScreen({ setup, error, onSubmit }: { setup: boolean; error: string; onSubmit: (username: string, password: string, setup: boolean) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setFormError('')
    if (setup && password !== confirm) return setFormError('비밀번호 확인이 일치하지 않습니다.')
    setBusy(true)
    try { await onSubmit(username, password, setup) } catch (e) { setFormError(e instanceof Error ? e.message : '로그인하지 못했습니다.') } finally { setBusy(false) }
  }
  return <main className="auth-screen"><div className="auth-landscape" aria-hidden="true"><span/><i/><b/></div><section className="auth-card"><BrandMark/><h1>{setup ? '관리자 계정 만들기' : '근무표에 로그인'}</h1><p className="auth-description">{setup ? '처음 한 번, 관리자 아이디와 비밀번호를 설정해 주세요.' : '왕궁농협 하나로마트 근무 관리'}</p><form onSubmit={submit}><label>아이디<input required autoComplete="username" minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} placeholder="사용할 아이디"/></label><label>비밀번호<input required type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 10 : 1} value={password} onChange={e => setPassword(e.target.value)} placeholder={setup ? '10자 이상' : '비밀번호 입력'}/></label>{setup && <label>비밀번호 확인<input required type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="비밀번호를 다시 입력"/></label>}{(formError || error) && <div className="auth-error">{formError || error}</div>}<button className="button button-primary auth-submit" disabled={busy}>{busy ? '확인 중…' : setup ? '관리자 계정 생성' : '로그인'}<Icon name="arrow"/></button></form><p className="auth-footnote">계정 정보는 이 기기에 안전하게 저장됩니다.</p></section><footer className="auth-footer">왕궁농협 하나로마트 <span>·</span> 직원 근무 관리</footer></main>
}

function PairAdder({ employees, onAdd, existing }: { employees: Employee[]; onAdd: (pair: number[]) => void; existing: { employeeIds: number[] }[] }) {
  const [one, setOne] = useState(''); const [two, setTwo] = useState('')
  const add = () => { const pair = [Number(one), Number(two)]; if (pair[0] && pair[1] && pair[0] !== pair[1] && !existing.some(item => item.employeeIds.every(id => pair.includes(id)))) { onAdd(pair); setOne(''); setTwo('') } }
  return <div className="pair-adder"><select aria-label="첫 번째 직원" value={one} onChange={e => setOne(e.target.value)}><option value="">직원 선택</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><span>↔</span><select aria-label="두 번째 직원" value={two} onChange={e => setTwo(e.target.value)}><option value="">직원 선택</option>{employees.filter(employee => String(employee.id) !== one).map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><button disabled={!one || !two} onClick={add}>제한 추가</button></div>
}

function EmployeeDialog({ employee, onClose, onSave, onDelete }: { employee: Employee | null; onClose: () => void; onSave: (data: Omit<Employee, 'id'>, id?: number) => void; onDelete: (employee: Employee) => void }) {
  const [name, setName] = useState(employee?.name ?? '')
  const [employmentType, setEmploymentType] = useState<Employee['employmentType']>(employee?.employmentType ?? '정규직')
  const [active, setActive] = useState(employee ? isActive(employee) : true)
  const [notes, setNotes] = useState(employee?.notes ?? '')
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim()) onSave({ name: name.trim(), employmentType, active, notes }, employee?.id) }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="dialog-card" onSubmit={submit}><header><div><h2>{employee ? '직원 정보 수정' : '새 직원 추가'}</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="닫기">×</button></header><label className="form-field">직원명<input autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder="이름 입력"/></label><label className="form-field">채용 구분<select value={employmentType} onChange={e => setEmploymentType(e.target.value as Employee['employmentType'])}><option>정규직</option><option>계약직</option></select></label><label className="form-field">재직 여부<div className="segmented-control"><button type="button" className={active ? 'selected' : ''} onClick={() => setActive(true)}>재직</button><button type="button" className={!active ? 'selected' : ''} onClick={() => setActive(false)}>퇴사</button></div></label><label className="form-field">특이사항 / 근무 조건<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="근무 조건을 입력하세요"/></label><footer>{employee && <button type="button" className="delete-button" onClick={() => onDelete(employee)}>직원 삭제</button>}<div><button type="button" className="button button-quiet" onClick={onClose}>취소</button><button className="button button-primary">저장</button></div></footer></form></div>
}

function AccountDialog({ employee, account, onClose, onSave }: { employee: Employee; account?: Account; onClose: () => void; onSave: (employee: Employee, username: string, password: string) => void }) {
  const [username, setUsername] = useState(account?.username ?? '')
  const [password, setPassword] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(employee, username, password) }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="dialog-card account-dialog" onSubmit={submit}><header><div><h2>{employee.name}</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="닫기">×</button></header><p className="dialog-note">직원은 이 계정으로 로그인해 근무표와 본인의 휴무 신청을 확인합니다.</p><label className="form-field">로그인 아이디<input required minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} placeholder="영문 또는 숫자 3자 이상"/></label><label className="form-field">{account ? '새 비밀번호 (변경할 때만 입력)' : '초기 비밀번호'}<input type="password" minLength={account ? 0 : 10} required={!account} value={password} onChange={e => setPassword(e.target.value)} placeholder={account ? '변경하지 않으면 비워 두세요' : '10자 이상'}/></label><footer><span className="dialog-note">비밀번호는 저장 후 다시 볼 수 없습니다.</span><div><button type="button" className="button button-quiet" onClick={onClose}>취소</button><button className="button button-primary">계정 저장</button></div></footer></form></div>
}

export default App
