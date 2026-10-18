import './ui.css'
import { useState } from 'react'
import { useApp } from './hooks/useApp'
import type { Page } from './types'
import { BrandMark, Icon } from './components/Icon'
import { AccountDialog, AuthScreen, EmployeeDialog, PasswordDialog } from './components/dialogs'
import { HistoryDialog, OptionsDialog, ReferenceDialog } from './components/ScheduleDialogs'
import { SchedulePage } from './pages/SchedulePage'
import { RequestsPage } from './pages/RequestsPage'
import { EmployeesPage } from './pages/EmployeesPage'
import { SettingsPage } from './pages/SettingsPage'
import { AttendancePage } from './pages/AttendancePage'
import { FeedbackPage } from './pages/FeedbackPage'

const pageTitle: Record<Page, string> = { schedule: '월간 근무표', requests: '희망휴무', employees: '직원 관리', settings: '운영 설정', attendance: '근태 모니터링', feedback: '피드백·버그 신고' }
const pageIcon = { schedule: 'calendar', requests: 'heart', employees: 'users', settings: 'settings', attendance: 'clock', feedback: 'message' } as const

function App() {
  const app = useApp()
  const [navOpen, setNavOpen] = useState(false)
  const [dismissedAccountNotices, setDismissedAccountNotices] = useState<string[]>(() => [
    ...(localStorage.getItem('wangung-account-notice:testadmin-20261015') === 'dismissed' ? ['testadmin'] : []),
    ...(localStorage.getItem('wangung-account-notice:charm1596-20261018-auto-apply') === 'dismissed' ? ['charm1596'] : []),
  ])
  const [feedbackOrigin, setFeedbackOrigin] = useState<Exclude<Page, 'feedback'>>('schedule')
  const {
    authChecked, user, setupNeeded, setupKeyRequired, error, setError, authenticate, page, setPage, isAdmin, pendingCount,
    logout, notice, dialog, setDialog, accountDialog, setAccountDialog, accounts, showPasswordDialog, setShowPasswordDialog, changePassword, saveEmployee, deleteEmployee, saveAccount,
  } = app

  if (!authChecked) return <div className="boot"><BrandMark/><span>왕궁농협 하나로마트</span></div>
  if (!user) return <AuthScreen setup={setupNeeded} setupKeyRequired={setupKeyRequired} error={error} onSubmit={authenticate}/>

  const pages: Page[] = isAdmin ? ['schedule', 'requests', 'attendance', 'feedback', 'employees', 'settings'] : ['schedule', 'requests', 'feedback']
  const accountNoticeUsers = ['testadmin', 'charm1596']
  const showAccountNotice = accountNoticeUsers.includes(user.username) && !dismissedAccountNotices.includes(user.username)
  return <div className="shell">
    <div className="nav-edge" aria-hidden="true"/>
    <aside className={`sidebar ${navOpen ? 'is-open' : ''}`} onMouseLeave={() => setNavOpen(false)}>
      <div className="brand"><BrandMark/><div><strong>왕궁농협</strong><span>하나로마트</span></div></div>
      <nav aria-label="주 메뉴">{pages.map(item => <button key={item} title={pageTitle[item]} className={page === item ? 'is-active' : ''} aria-current={page === item ? 'page' : undefined} onClick={() => { if (item === 'feedback' && page !== 'feedback') setFeedbackOrigin(page); setPage(item); setNavOpen(false) }}>
        <Icon name={pageIcon[item]}/><span>{pageTitle[item]}</span>
        {item === 'requests' && isAdmin && pendingCount > 0 && <b className="badge">{pendingCount}</b>}
      </button>)}</nav>
      <div className="sidebar-user">
        <span className="avatar" aria-hidden="true">{isAdmin ? '관' : user.employeeName?.slice(-1) ?? '직'}</span>
        <div><b>{isAdmin ? '관리자' : user.employeeName}</b><small>{user.username}</small></div>
      </div>
    </aside>

    <div className="main">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setNavOpen(open => !open)} aria-label="메뉴 열기" aria-expanded={navOpen}><Icon name="menu" size={19}/></button>
        <span className="topbar-title">{pageTitle[page]}</span>
        <span className="spacer"/>
        <button className="btn btn-ghost btn-sm topbar-action" aria-label="비밀번호 변경" onClick={() => { setError(''); setShowPasswordDialog(true) }}><Icon name="key" size={15}/><span className="topbar-label">비밀번호 변경</span></button>
        <button className="btn btn-ghost btn-sm topbar-action" aria-label="로그아웃" onClick={() => void logout()}><Icon name="logout" size={15}/><span className="topbar-label">로그아웃</span></button>
      </header>
      <main className="content">
        {error && <div className="alert alert-error" role="alert"><p>{error}</p><button className="btn btn-sm" onClick={() => setError('')}>확인</button></div>}
        {showAccountNotice && <section className="account-notice" role="status" aria-label="계정 안내">
          <div><b>근무표 업데이트 안내</b><p>승인된 희망휴무는 월표에 휴무로 반영되고 자동 편성에서 고정됩니다. 주말 종일근무 허용 여부와 룰 우선순위는 운영 설정에서 조정할 수 있습니다. ‘추천안 바로 적용’을 누르면 가장 나은 자동 편성안을 적용하고, 확인할 항목이 있으면 먼저 알려드립니다. 여러 대안을 비교하려면 ‘전체 자동 편성’을 이용해 주세요.</p></div>
          <button className="btn btn-sm" onClick={() => {
            const key = `wangung-account-notice:${user.username}-${user.username === 'testadmin' ? '20261015' : '20261018-auto-apply'}`
            localStorage.setItem(key, 'dismissed')
            setDismissedAccountNotices(previous => [...previous, user.username])
          }}>확인</button>
        </section>}
        {page === 'schedule' && <SchedulePage app={app}/>}
        {page === 'requests' && <RequestsPage app={app}/>}
        {page === 'employees' && isAdmin && <EmployeesPage app={app}/>}
        {page === 'settings' && isAdmin && <SettingsPage app={app}/>}
        {page === 'attendance' && isAdmin && <AttendancePage/>}
        {page === 'feedback' && <FeedbackPage initialPage={feedbackOrigin}/>}
      </main>
    </div>

    {notice && <div className="toast" role="status"><Icon name="check" size={16}/>{notice}</div>}
    {isAdmin && <><OptionsDialog app={app}/><HistoryDialog app={app}/><ReferenceDialog app={app}/></>}
    {showPasswordDialog && <PasswordDialog onClose={() => setShowPasswordDialog(false)} onSave={changePassword}/>}
    {dialog && isAdmin && <EmployeeDialog employee={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} onSave={saveEmployee} onDelete={deleteEmployee}/>}
    {accountDialog && isAdmin && <AccountDialog employee={accountDialog} account={accounts.find(item => item.employeeId === accountDialog.id)} onClose={() => setAccountDialog(null)} onSave={saveAccount}/>}
  </div>
}

export default App
