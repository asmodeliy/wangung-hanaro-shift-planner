import { useState, type FormEvent } from 'react'
import type { Account, DutyType, Employee, WorkRules } from '../types'
import { api } from '../lib/api'
import { isActive, weekdays } from '../lib/schedule'
import { BrandMark, Icon } from './Icon'
import { Modal } from './Modal'

export function AuthScreen({ setup, setupKeyRequired, error, onSubmit }: { setup: boolean; setupKeyRequired: boolean; error: string; onSubmit: (username: string, password: string, setup: boolean, setupKey: string) => Promise<void> }) {
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
  return <main className="auth">
    <section className="auth-card">
      <BrandMark/>
      <h1>{setup ? '관리자 계정 만들기' : '근무표 로그인'}</h1>
      <p>{setup ? '처음 한 번, 관리자 아이디와 비밀번호를 설정해 주세요.' : '왕궁농협 하나로마트 근무 관리'}</p>
      <form onSubmit={submit}>
        {setup && setupKeyRequired && <label className="field">최초 관리자 설정 키<input required autoComplete="off" type="password" value={setupKey} onChange={e => setSetupKey(e.target.value)} placeholder="배포 담당자가 전달한 설정 키"/></label>}
        <label className="field">아이디<input required autoComplete="username" minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} placeholder="아이디 입력"/></label>
        <label className="field">비밀번호<input required type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 10 : 1} value={password} onChange={e => setPassword(e.target.value)} placeholder={setup ? '10자 이상' : '비밀번호 입력'}/></label>
        {setup && <label className="field">비밀번호 확인<input required type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="비밀번호를 다시 입력"/></label>}
        {(formError || error) && <div className="alert alert-error" role="alert">{formError || error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? '확인 중…' : setup ? '관리자 계정 생성' : '로그인'}<Icon name="arrow" size={16}/></button>
      </form>
      <small>계정과 근무 정보는 서버에 안전하게 저장됩니다.</small>
    </section>
  </main>
}

export function PairAdder({ employees, onAdd, existing }: { employees: Employee[]; onAdd: (pair: number[]) => void; existing: { employeeIds: number[] }[] }) {
  const [one, setOne] = useState('')
  const [two, setTwo] = useState('')
  const add = () => {
    const pair = [Number(one), Number(two)]
    if (pair[0] && pair[1] && pair[0] !== pair[1] && !existing.some(item => item.employeeIds.every(id => pair.includes(id)))) { onAdd(pair); setOne(''); setTwo('') }
  }
  return <div className="inline pair-adder">
    <select aria-label="첫 번째 직원" value={one} onChange={e => setOne(e.target.value)}><option value="">직원 선택</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>
    <span aria-hidden="true">↔</span>
    <select aria-label="두 번째 직원" value={two} onChange={e => setTwo(e.target.value)}><option value="">직원 선택</option>{employees.filter(employee => String(employee.id) !== one).map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>
    <button type="button" className="btn btn-sm" disabled={!one || !two} onClick={add}>추가</button>
  </div>
}

export function AdminAccountsPanel({ accounts, currentUserId, onChanged }: { accounts: Account[]; currentUserId: number; onChanged: () => void }) {
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
  return <section className="panel pad">
    <h2>관리자 계정</h2>
    <p className="muted small">관리자 계정은 2개까지 운영할 수 있습니다.</p>
    <ul className="list">{admins.map(account => <li key={account.id}>
      <span><b>{account.username}</b> <small className="muted">{account.id === currentUserId ? '현재 로그인' : '관리자'}</small></span>
      {account.id !== currentUserId && <span className="inline">
        <button className="btn btn-sm" onClick={() => void resetPassword(account)}>비밀번호 재설정</button>
        <button className="btn btn-sm btn-danger-ghost" onClick={() => void remove(account)}>삭제</button>
      </span>}
    </li>)}</ul>
    {admins.length < 2 && <form className="inline form-inline" onSubmit={create}>
      <label className="field">새 관리자 아이디<input required minLength={3} maxLength={32} pattern="[a-zA-Z0-9._-]+" value={username} onChange={event => setUsername(event.target.value)} placeholder="영문·숫자 3자 이상"/></label>
      <label className="field">초기 비밀번호<input required minLength={10} maxLength={128} type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="10자 이상"/></label>
      <button className="btn btn-primary" disabled={busy}>{busy ? '생성 중…' : '관리자 추가'}</button>
    </form>}
  </section>
}

export function EmployeeDialog({ employee, onClose, onSave, onDelete }: { employee: Employee | null; onClose: () => void; onSave: (data: Omit<Employee, 'id'>, id?: number) => void; onDelete: (employee: Employee) => void }) {
  const [name, setName] = useState(employee?.name ?? '')
  const [employmentType, setEmploymentType] = useState<Employee['employmentType']>(employee?.employmentType ?? '정규직')
  const [dutyType, setDutyType] = useState<DutyType>(employee?.dutyType ?? (employee?.employmentType === '계약직' ? 'support' : 'functional'))
  const [produceQualified, setProduceQualified] = useState(Boolean(employee?.produceQualified))
  const [produceBackup, setProduceBackup] = useState(Boolean(employee?.produceBackup))
  const [active, setActive] = useState(employee ? isActive(employee) : true)
  const [notes, setNotes] = useState(employee?.notes ?? '')
  const [workRules, setWorkRules] = useState<WorkRules>(employee?.workRules ?? { allowedShifts: ['open', 'close'], offRules: [] })
  const toggleOff = (weekday: number, occurrence: number) => setWorkRules(value => {
    const selected = value.offRules.find(rule => rule.weekday === weekday)?.occurrences ?? []
    const occurrences = selected.includes(occurrence) ? selected.filter(n => n !== occurrence) : [...selected, occurrence].sort()
    return { ...value, offRules: [...value.offRules.filter(rule => rule.weekday !== weekday), ...(occurrences.length ? [{ weekday, occurrences }] : [])] }
  })
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim()) onSave({ name: name.trim(), employmentType, dutyType, produceQualified, produceBackup, active, notes, workRules }, employee?.id) }
  return <Modal title={employee ? '직원 정보 수정' : '새 직원 추가'} onClose={onClose} onSubmit={submit} footer={<>
    {employee && <button type="button" className="btn btn-danger-ghost" onClick={() => onDelete(employee)}>직원 삭제</button>}
    <span className="spacer"/>
    <button type="button" className="btn" onClick={onClose}>취소</button>
    <button className="btn btn-primary">저장</button>
  </>}>
    <label className="field">직원명<input autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder="이름 입력"/></label>
    <div className="field-row">
      <label className="field">채용 구분<select value={employmentType} onChange={e => setEmploymentType(e.target.value as Employee['employmentType'])}><option value="정규직">일반직</option><option value="계약직">계약직</option></select></label>
      <label className="field">담당 직무<select value={dutyType} onChange={e => setDutyType(e.target.value as DutyType)}><option value="functional">일반직</option><option value="support">계약직 업무</option><option value="other">기타</option></select></label>
    </div>
    <label className="check"><input type="checkbox" checked={produceQualified} onChange={e => { setProduceQualified(e.target.checked); if (e.target.checked) setProduceBackup(false) }}/><span>농산 담당 직원</span></label>
    <label className="check"><input type="checkbox" checked={produceBackup} onChange={e => { setProduceBackup(e.target.checked); if (e.target.checked) setProduceQualified(false) }}/><span>농산 대직자 <small className="muted">담당자가 오픈할 수 없을 때 대신 오픈합니다.</small></span></label>
    <div className="field">재직 여부
      <div className="tabs" role="group">
        <button type="button" className={active ? 'is-active' : ''} onClick={() => setActive(true)}>재직</button>
        <button type="button" className={!active ? 'is-active' : ''} onClick={() => setActive(false)}>퇴사</button>
      </div>
    </div>
    <label className="field">가능한 근무
      <select value={workRules.allowedShifts.length === 2 ? 'both' : workRules.allowedShifts[0]} onChange={e => setWorkRules(value => ({ ...value, allowedShifts: e.target.value === 'both' ? ['open', 'close'] : [e.target.value as 'open' | 'close'] }))}>
        <option value="both">오픈·마감 모두 가능</option><option value="open">오픈만 가능</option><option value="close">마감만 가능</option>
      </select>
    </label>
    <fieldset className="recurring">
      <legend>정기휴무 · 매월 몇 번째 요일</legend>
      {weekdays.map((weekday, day) => <div className="recurring-row" key={day}>
        <b>{weekday}</b>
        {[1, 2, 3, 4, 5].map(n => <label key={n}><input type="checkbox" aria-label={`${weekday}요일 ${n}번째 정기휴무`} checked={workRules.offRules.some(rule => rule.weekday === day && rule.occurrences.includes(n))} onChange={() => toggleOff(day, n)}/>{n}번째</label>)}
      </div>)}
    </fieldset>
    <label className="field">메모<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="직원별 참고 사항을 적어 주세요."/></label>
  </Modal>
}

export function AccountDialog({ employee, account, onClose, onSave }: { employee: Employee; account?: Account; onClose: () => void; onSave: (employee: Employee, username: string, password: string) => void }) {
  const [username, setUsername] = useState(account?.username ?? '')
  const [password, setPassword] = useState('')
  return <Modal title={`${employee.name} 계정`} description="직원은 이 계정으로 로그인해 근무표와 본인의 휴무 신청을 확인합니다." size="sm" onClose={onClose}
    onSubmit={event => { event.preventDefault(); onSave(employee, username, password) }}
    footer={<><small className="muted">비밀번호는 저장 후 다시 볼 수 없습니다.</small><span className="spacer"/><button type="button" className="btn" onClick={onClose}>취소</button><button className="btn btn-primary">계정 저장</button></>}>
    <label className="field">로그인 아이디<input required minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} placeholder="영문 또는 숫자 3자 이상"/></label>
    <label className="field">{account ? '새 비밀번호 (변경할 때만)' : '초기 비밀번호'}<input type="password" minLength={account ? 0 : 10} required={!account} value={password} onChange={e => setPassword(e.target.value)} placeholder={account ? '변경하지 않으면 비워 두세요' : '10자 이상'}/></label>
  </Modal>
}

export function PasswordDialog({ onClose, onSave }: { onClose: () => void; onSave: (currentPassword: string, newPassword: string) => Promise<void> }) {
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
  return <Modal title="비밀번호 변경" description="새 비밀번호는 10자 이상으로 설정해 주세요." size="sm" onClose={onClose} onSubmit={event => void submit(event)}
    footer={<><small className="muted">다른 기기에서는 다시 로그인해야 합니다.</small><span className="spacer"/><button type="button" className="btn" onClick={onClose}>취소</button><button className="btn btn-primary" disabled={busy}>{busy ? '저장 중…' : '저장'}</button></>}>
    <label className="field">현재 비밀번호<input autoFocus required type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}/></label>
    <label className="field">새 비밀번호<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="10자 이상"/></label>
    <label className="field">새 비밀번호 확인<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="다시 입력"/></label>
    {formError && <div className="alert alert-error" role="alert">{formError}</div>}
  </Modal>
}
