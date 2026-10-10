import type { AppState } from '../hooks/useApp'
import { employmentLabel, isActive } from '../lib/schedule'
import { Icon } from '../components/Icon'

export function EmployeesPage({ app }: { app: AppState }) {
  const { employees, activeEmployees, accounts, search, setSearch, setDialog, setAccountDialog } = app
  const rows = employees.filter(employee => employee.name.includes(search.trim()))
  return <>
    <header className="page-head">
      <div><h1>직원 관리</h1><p>직원 정보와 개인 로그인 계정을 관리합니다.</p></div>
      <div className="page-actions"><button className="btn btn-primary" onClick={() => setDialog('new')}><Icon name="plus" size={16}/>직원 추가</button></div>
    </header>
    <section className="panel pad">
      <div className="section-head">
        <div><h2>직원 명단 <span className="count">{employees.length}</span></h2><p className="muted small">재직 {activeEmployees.length}명 · 채용 구분과 농산 담당 여부를 바탕으로 편성 조건이 적용됩니다.</p></div>
        <label className="search"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="이름 검색" aria-label="직원 이름 검색"/></label>
      </div>
      {employees.length === 0
        ? <div className="empty"><b>등록된 직원이 없습니다</b><span>직원 추가 버튼으로 명단을 시작하세요.</span></div>
        : <ul className="people">{rows.map((employee, index) => {
          const account = accounts.find(item => item.employeeId === employee.id)
          return <li key={employee.id} className={isActive(employee) ? '' : 'is-inactive'}>
            <span className={`avatar tone-${index % 5}`} aria-hidden="true">{employee.name.slice(-1)}</span>
            <span className="people-main">
              <b>{employee.name}
                {employee.produceQualified && <small className="tag tag-blue">농산</small>}
                {employee.produceBackup && <small className="tag tag-blue">농산 대직</small>}
              </b>
              <small>{employee.notes || '메모 없음'}</small>
            </span>
            <span className="tag">{employmentLabel(employee)}</span>
            <span className={`tag ${isActive(employee) ? 'tag-open' : 'tag-off'}`}>{isActive(employee) ? '재직' : '퇴사'}</span>
            <span className={`account ${account ? 'is-ready' : ''}`}><i aria-hidden="true"/>{account ? account.username : '계정 없음'}</span>
            <span className="people-actions">
              <button className="btn btn-sm" onClick={() => setAccountDialog(employee)}>{account ? '계정 관리' : '계정 발급'}</button>
              <button className="btn btn-sm" onClick={() => setDialog(employee)}>수정</button>
            </span>
          </li>
        })}</ul>}
    </section>
  </>
}
