import { useState } from 'react'
import type { AppState } from '../hooks/useApp'
import type { NumericOperation, Operations, Settings, Times } from '../types'
import { monthKey, monthLabel, shiftTime, shiftTimeGroup } from '../lib/schedule'
import { AdminAccountsPanel, PairAdder } from '../components/dialogs'

const combinedFields: [NumericOperation, string][] = [
  ['weekdayTarget', '평일 목표 출근'], ['weekdayMinimum', '평일 최소 출근'],
  ['weekendTarget', '주말·공휴일 목표 출근'], ['weekendMinimum', '주말·공휴일 최소 출근'],
]
const splitFields: [NumericOperation, string][] = [
  ['weekdayRegularTarget', '평일 정규직 목표'], ['weekdayRegularMinimum', '평일 정규직 최소'],
  ['weekdayContractTarget', '평일 계약직 목표'], ['weekdayContractMinimum', '평일 계약직 최소'],
  ['weekendRegularTarget', '주말 정규직 목표'], ['weekendRegularMinimum', '주말 정규직 최소'],
  ['weekendContractTarget', '주말 계약직 목표'], ['weekendContractMinimum', '주말 계약직 최소'],
]
const ruleFields: [NumericOperation, string, string][] = [
  ['minimumEmployeesForGeneration', '자동 편성 최소 재직 인원', '명'],
  ['functionalMinOnDuty', '일반직 최소 출근', '명'],
  ['supportMaxOff', '계약직 최대 휴무', '명'],
  ['supportMaxRequestsPerDate', '계약직 날짜별 희망휴무 한도', '명'],
  ['produceOpenCount', '농산 담당 오픈 최소 인원', '명'],
  ['maxConsecutiveWorkDays', '최대 연속근무 (0은 제한 없음)', '일'],
  ['maxWishDaysPerEmployee', '월 희망휴무 한도 (0은 제한 없음)', '일'],
  ['requestDueDay', '희망휴무 취합일', '일'],
  ['publishDay', '근무표 공유일', '일'],
]

function TimeRow({ label, kind, value, onChange }: { label: string; kind: string; value: Times; onChange: (next: Times) => void }) {
  return <tr>
    <th scope="row">{label}</th><td>{kind}</td>
    <td><input type="time" aria-label={`${label} ${kind} 시작`} value={value.start} onChange={event => onChange({ ...value, start: event.target.value })}/></td>
    <td><input type="time" aria-label={`${label} ${kind} 종료`} value={value.end} onChange={event => onChange({ ...value, end: event.target.value })}/></td>
  </tr>
}

function DateList({ dates, emptyText, onRemove, suffix }: { dates: string[]; emptyText: string; onRemove: (date: string) => void; suffix: string }) {
  if (!dates.length) return <p className="muted small">{emptyText}</p>
  return <ul className="date-chips">{dates.map(date => <li key={date}><button type="button" onClick={() => onRemove(date)} title={suffix}>{date} <span aria-hidden="true">×</span></button></li>)}</ul>
}

export function SettingsPage({ app }: { app: AppState }) {
  const {
    settings, setSettings, saveSettings, employees, activeEmployees, accounts, user, load, month, changeMonth, restTarget, holidays,
    holidayDate, setHolidayDate, addHoliday, produceExceptionDate, setProduceExceptionDate, pastEditDate, setPastEditDate,
  } = app
  const [dirty, setDirty] = useState(false)
  const update = (recipe: (value: Settings) => Settings) => { setSettings(recipe); setDirty(true) }
  const setOp = <K extends keyof Operations>(key: K, value: Operations[K]) => update(current => ({ ...current, operations: { ...current.operations, [key]: value } }))
  const ops = settings.operations
  const key = monthKey(month)
  const monthHolidays = holidays.filter(item => item.date.startsWith(key))
  const monthExceptions = settings.produceOpenExceptions.filter(date => date.startsWith(`${key}-`))
  const nameOf = (id: number) => employees.find(employee => employee.id === id)?.name ?? '직원'
  const save = async () => { await saveSettings(settings); setDirty(false) }

  return <>
    <header className="page-head">
      <div><h1>운영 설정</h1><p>근무시간과 일정 편성 조건을 관리합니다. 변경 후 저장을 눌러야 적용됩니다.</p></div>
      <div className="page-actions">
        {dirty && <span className="pill pill-warn">저장하지 않은 변경</span>}
        <button className="btn btn-primary" onClick={() => void save()}>설정 저장</button>
      </div>
    </header>

    <div className="settings-grid">
      <section className="panel pad">
        <h2>오픈 · 마감 시간</h2>
        <table className="form-table">
          <thead><tr><th>구분</th><th>직원</th><th>시작</th><th>종료</th></tr></thead>
          <tbody>
            {(['open', 'close'] as const).flatMap(type => (['regular', 'contract'] as const).map(kind =>
              <TimeRow key={`${type}-${kind}`} label={type === 'open' ? '오픈' : '마감'} kind={kind === 'regular' ? '정규직' : '계약직'} value={shiftTime(settings, type, kind)}
                onChange={next => update(current => ({ ...current, shiftTimes: { ...current.shiftTimes, [type]: { ...shiftTimeGroup(current, type), [kind]: next } } }))}/>))}
            <TimeRow label="농산 오픈" kind="담당·대직" value={settings.shiftTimes.produceOpen}
              onChange={next => update(current => ({ ...current, shiftTimes: { ...current.shiftTimes, produceOpen: next } }))}/>
          </tbody>
        </table>
        <p className="muted small">농산 담당·대직자는 별도 오픈 시간을 사용합니다.</p>
      </section>

      <section className="panel pad">
        <h2>인원 기준</h2>
        <label className="field">인원 산정 방식
          <select value={ops.staffingMode} onChange={event => setOp('staffingMode', event.target.value as Operations['staffingMode'])}>
            <option value="combined">전체 직원 합산</option>
            <option value="employmentType">정규직·계약직 별도 산정</option>
          </select>
        </label>
        <div className="number-grid">
          {(ops.staffingMode === 'combined' ? combinedFields : splitFields).map(([field, label]) => <label className="field" key={field}>{label}
            <span className="unit"><input type="number" min={0} max={100} value={ops[field]} onChange={event => setOp(field, Number(event.target.value))}/>명</span>
          </label>)}
        </div>
        <p className="muted small">최소 인원은 같은 구분의 목표 인원보다 클 수 없습니다.</p>
      </section>

      <section className="panel pad">
        <h2>편성 규칙</h2>
        <div className="number-grid">
          {ruleFields.map(([field, label, unit]) => <label className="field" key={field}>{label}
            <span className="unit"><input type="number" min={field === 'requestDueDay' || field === 'publishDay' ? 1 : 0} max={['requestDueDay', 'publishDay', 'maxConsecutiveWorkDays', 'maxWishDaysPerEmployee'].includes(field) ? 31 : 100}
              value={ops[field]} onChange={event => setOp(field, Number(event.target.value))}/>{unit}</span>
          </label>)}
        </div>
        <label className="check"><input type="checkbox" checked={ops.requireRegularEachShift} onChange={event => setOp('requireRegularEachShift', event.target.checked)}/><span>오픈·마감에 일반직을 각각 한 명 이상 배치</span></label>
        <label className="check"><input type="checkbox" checked={ops.requireProduceOpener} onChange={event => setOp('requireProduceOpener', event.target.checked)}/><span>매일 농산 담당자 또는 대직자 오픈 배치</span></label>
        <label className="check"><input type="checkbox" checked={ops.noConsecutiveClose} onChange={event => setOp('noConsecutiveClose', event.target.checked)}/><span>일반직은 마감을 이틀 연속 하지 않음 <small className="muted">마감 → 마감 금지</small></span></label>
        <label className="check"><input type="checkbox" checked={ops.noFullCloseAdjacent} onChange={event => setOp('noFullCloseAdjacent', event.target.checked)}/><span>일반직은 종일과 마감을 연달아 하지 않음 <small className="muted">종일 → 마감, 마감 → 종일 금지</small></span></label>
      </section>

      <section className="panel pad">
        <h2>날짜별 예외</h2>
        <div className="field">농산 오픈 예외 날짜 <small className="muted">({monthLabel(month)})</small>
          <span className="inline">
            <input type="date" min={`${key}-01`} max={`${key}-${String(new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()).padStart(2, '0')}`} value={produceExceptionDate} onChange={event => setProduceExceptionDate(event.target.value)}/>
            <button type="button" className="btn btn-sm" disabled={!produceExceptionDate || settings.produceOpenExceptions.includes(produceExceptionDate)}
              onClick={() => { update(current => ({ ...current, produceOpenExceptions: [...new Set([...current.produceOpenExceptions, produceExceptionDate])].sort() })); setProduceExceptionDate('') }}>추가</button>
          </span>
        </div>
        <DateList dates={monthExceptions} emptyText="선택한 달에 지정된 예외가 없습니다." suffix="예외 해제"
          onRemove={date => update(current => ({ ...current, produceOpenExceptions: current.produceOpenExceptions.filter(item => item !== date) }))}/>
        <hr/>
        <div className="field">과거 날짜 수정 허용
          <span className="inline">
            <input type="date" value={pastEditDate} onChange={event => setPastEditDate(event.target.value)}/>
            <button type="button" className="btn btn-sm" disabled={!pastEditDate || settings.editablePastShiftDates.includes(pastEditDate)}
              onClick={() => { update(current => ({ ...current, editablePastShiftDates: [...new Set([...current.editablePastShiftDates, pastEditDate])].sort() })); setPastEditDate('') }}>추가</button>
          </span>
        </div>
        <DateList dates={settings.editablePastShiftDates} emptyText="허용한 과거 날짜가 없습니다." suffix="허용 해제"
          onRemove={date => update(current => ({ ...current, editablePastShiftDates: current.editablePastShiftDates.filter(item => item !== date) }))}/>
        <p className="muted small">오늘 이전 일정은 기본적으로 수정할 수 없습니다. 추가한 날짜만 수정할 수 있습니다.</p>
      </section>

      <section className="panel pad">
        <h2>동시 휴무 제한</h2>
        <p className="muted small">같은 날 함께 쉴 수 없는 직원 조합입니다.</p>
        {settings.daysOffPairs.length === 0 ? <p className="muted">등록된 제한이 없습니다.</p> : <ul className="list">{settings.daysOffPairs.map((pair, index) => <li key={index}>
          <span><b>{nameOf(pair.employeeIds[0])}</b> ↔ <b>{nameOf(pair.employeeIds[1])}</b></span>
          <button className="btn btn-sm btn-danger-ghost" onClick={() => update(current => ({ ...current, daysOffPairs: current.daysOffPairs.filter((_, i) => i !== index) }))}>삭제</button>
        </li>)}</ul>}
        <PairAdder employees={activeEmployees} existing={settings.daysOffPairs} onAdd={pair => update(current => ({ ...current, daysOffPairs: [...current.daysOffPairs, { employeeIds: pair }] }))}/>
      </section>

      <section className="panel pad">
        <h2>공휴일 · 기준 휴무</h2>
        <div className="stepper" role="group" aria-label="월 이동">
          <button aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><strong>{monthLabel(month)}</strong><button aria-label="다음 달" onClick={() => changeMonth(1)}>›</button>
        </div>
        <p className="big-number">{restTarget}<small>일</small><span>직원별 기준 휴무</span></p>
        {monthHolidays.length === 0 ? <p className="muted">이번 달 공휴일이 없습니다.</p> : <ul className="list">{monthHolidays.map(item => <li key={item.date}>
          <span><b>{item.date.slice(5).replace('-', '월 ')}일</b> {item.name}</span>
          {settings.additionalHolidays.includes(item.date) && <button className="btn btn-sm btn-danger-ghost" onClick={() => void saveSettings({ ...settings, additionalHolidays: settings.additionalHolidays.filter(date => date !== item.date) })}>삭제</button>}
        </li>)}</ul>}
        <span className="inline">
          <input type="date" value={holidayDate} onChange={event => setHolidayDate(event.target.value)} aria-label="추가 공휴일"/>
          <button className="btn btn-sm" disabled={!holidayDate} onClick={() => void addHoliday()}>임시 공휴일 추가</button>
        </span>
      </section>
    </div>

    {user && <AdminAccountsPanel accounts={accounts} currentUserId={user.id} onChanged={() => void load()}/>}
  </>
}
