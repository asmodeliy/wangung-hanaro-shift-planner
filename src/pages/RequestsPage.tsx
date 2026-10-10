import { useState } from 'react'
import type { AppState } from '../hooks/useApp'
import { api } from '../lib/api'
import { dateKey, monthLabel, requestStatusText, weekdays } from '../lib/schedule'
import { Icon } from '../components/Icon'

export function RequestsPage({ app }: { app: AppState }) {
  const {
    isAdmin, month, changeMonth, dayCount, holidayMap, requests, chosenDates, setChosenDates, toggleDate, activeEmployees, pendingCount, settings,
    submitRequests, updateRequest, deleteRequest, load, toast, setError,
  } = app
  const [employeeId, setEmployeeId] = useState<number | ''>('')
  const targetId = isAdmin ? Number(employeeId || activeEmployees[0]?.id || 0) : null
  const leading = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const rules = settings.operations

  const submit = async () => {
    if (!isAdmin) return submitRequests()
    if (!targetId) return
    try {
      await api('/api/requests', { method: 'POST', body: JSON.stringify({ employeeId: targetId, dates: chosenDates }) })
      setChosenDates([]); await load(); toast('희망휴무 신청을 저장했습니다.')
    } catch (e) { setError(e instanceof Error ? e.message : '신청을 저장하지 못했습니다.') }
  }

  return <>
    <header className="page-head">
      <div>
        <h1>{isAdmin ? '희망휴무 현황' : '희망휴무 신청'}</h1>
        <p>{isAdmin ? '직원들의 신청을 확인하고 일정 편성에 반영하세요.' : '원하는 날짜를 선택해 관리자에게 휴무를 신청하세요.'}</p>
      </div>
    </header>
    <div className="split">
      <section className="panel pad">
        <h2>{isAdmin ? '직원을 대신해 신청' : '휴무 희망일 선택'}</h2>
        {isAdmin && <label className="field">직원
          <select value={targetId ?? ''} onChange={event => { setEmployeeId(Number(event.target.value)); setChosenDates([]) }}>
            {activeEmployees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
        </label>}
        <div className="stepper" role="group" aria-label="월 이동">
          <button aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><strong>{monthLabel(month)}</strong><button aria-label="다음 달" onClick={() => changeMonth(1)}>›</button>
        </div>
        <div className="datepick">
          {weekdays.map((day, index) => <span key={day} className={index === 0 ? 'is-sun' : index === 6 ? 'is-sat' : ''}>{day}</span>)}
          {Array.from({ length: leading }, (_, index) => <i key={`blank-${index}`}/>)}
          {Array.from({ length: dayCount }, (_, index) => {
            const date = dateKey(new Date(month.getFullYear(), month.getMonth(), index + 1))
            const existing = requests.some(item => item.date === date && item.status !== 'rejected' && (!isAdmin || item.employeeId === targetId))
            const selected = chosenDates.includes(date)
            return <button key={date} type="button" aria-pressed={selected} title={holidayMap.get(date) ?? ''}
              className={[selected && 'is-selected', existing && 'is-requested', holidayMap.has(date) && 'is-holiday'].filter(Boolean).join(' ')}
              onClick={() => toggleDate(date)}>{index + 1}</button>
          })}
        </div>
        <p className="legend-line"><span><i className="swatch swatch-selected"/>선택</span><span><i className="swatch swatch-requested"/>신청 완료</span></p>
        <button className="btn btn-primary btn-block" disabled={!chosenDates.length} onClick={() => void submit()}>
          신청 보내기{chosenDates.length > 0 && ` · ${chosenDates.length}일`}
        </button>
      </section>

      <section className="panel pad">
        <div className="section-head"><h2>신청 내역</h2>{isAdmin && <span className="pill pill-warn">대기 {pendingCount}건</span>}</div>
        {requests.length === 0
          ? <div className="empty"><Icon name="calendar" size={28}/><b>신청 내역이 없습니다</b><span>{isAdmin ? '직원이 희망휴무를 신청하면 이곳에 나타납니다.' : '달력에서 희망 날짜를 선택해 신청해 주세요.'}</span></div>
          : <ul className="request-list">{requests.map(item => {
            const date = new Date(`${item.date}T12:00:00`)
            return <li key={item.id}>
              <span className="request-day"><b>{date.getDate()}</b><small>{weekdays[date.getDay()]}</small></span>
              <span className="request-who"><b>{item.employeeName}</b><small>{date.getMonth() + 1}월 {date.getDate()}일 신청</small></span>
              <span className={`status status-${item.status}`}>{requestStatusText[item.status]}</span>
              {isAdmin
                ? <span className="request-actions">
                  {item.status !== 'approved' && <button className="btn btn-sm" onClick={() => void updateRequest(item, 'approved')}>승인</button>}
                  {item.status !== 'rejected' && <button className="btn btn-sm btn-danger-ghost" onClick={() => void updateRequest(item, 'rejected')}>반려</button>}
                </span>
                : item.status === 'pending' && <button className="btn btn-sm btn-danger-ghost" onClick={() => void deleteRequest(item)}>취소</button>}
            </li>
          })}</ul>}
        <p className="muted small">{isAdmin
          ? `매월 ${rules.requestDueDay}일 전후 다음 달 희망휴무를 취합하고 ${rules.publishDay}일 전후 근무표를 공유하세요. 승인된 신청은 자동 편성에 우선 반영됩니다.`
          : `다음 달에 꼭 필요한 날짜 위주로 매월 ${rules.requestDueDay}일까지 신청해 주세요.${rules.maxWishDaysPerEmployee > 0 ? ` 월 최대 ${rules.maxWishDaysPerEmployee}일까지 신청할 수 있습니다.` : ''} 근무표는 ${rules.publishDay}일 전후 공유됩니다.`}</p>
      </section>
    </div>
  </>
}
