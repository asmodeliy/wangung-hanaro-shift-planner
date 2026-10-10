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

const pageTitle: Record<Page, string> = { schedule: '월간 근무표', requests: '희망휴무', employees: '직원 관리', settings: '운영 설정' }
const pageIcon = { schedule: 'calendar', requests: 'heart', employees: 'users', settings: 'settings' } as const

function App() {
  const app = useApp()
  const [navOpen, setNavOpen] = useState(false)
  const {
    authChecked, user, setupNeeded, setupKeyRequired, error, setError, authenticate, page, setPage, isAdmin, pendingCount,
    logout, notice, dialog, setDialog, accountDialog, setAccountDialog, accounts, showPasswordDialog, setShowPasswordDialog, changePassword, saveEmployee, deleteEmployee, saveAccount,
  } = app

  if (!authChecked) return <div className="boot"><BrandMark/><span>왕궁농협 하나로마트</span></div>
  if (!user) return <AuthScreen setup={setupNeeded} setupKeyRequired={setupKeyRequired} error={error} onSubmit={authenticate}/>

  const pages: Page[] = isAdmin ? ['schedule', 'requests', 'employees', 'settings'] : ['schedule', 'requests']
  return <div className="shell">
    <div className="nav-edge" aria-hidden="true"/>
    <aside className={`sidebar ${navOpen ? 'is-open' : ''}`} onMouseLeave={() => setNavOpen(false)}>
      <div className="brand"><BrandMark/><div><strong>왕궁농협</strong><span>하나로마트</span></div></div>
      <nav aria-label="주 메뉴">{pages.map(item => <button key={item} title={pageTitle[item]} className={page === item ? 'is-active' : ''} aria-current={page === item ? 'page' : undefined} onClick={() => { setPage(item); setNavOpen(false) }}>
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
        <button className="btn btn-ghost btn-sm" onClick={() => { setError(''); setShowPasswordDialog(true) }}><Icon name="key" size={15}/>비밀번호 변경</button>
        <button className="btn btn-ghost btn-sm" onClick={() => void logout()}><Icon name="logout" size={15}/>로그아웃</button>
      </header>
      <main className="content">
        {error && <div className="alert alert-error" role="alert"><p>{error}</p><button className="btn btn-sm" onClick={() => setError('')}>확인</button></div>}
        {page === 'schedule' && <SchedulePage app={app}/>}
        {page === 'requests' && <RequestsPage app={app}/>}
        {page === 'employees' && isAdmin && <EmployeesPage app={app}/>}
        {page === 'settings' && isAdmin && <SettingsPage app={app}/>}
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
