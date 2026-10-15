import { useState } from 'react'
import type { AppState } from '../hooks/useApp'
import type { NumericOperation, Operations, RulePriorityKey, Settings, Times } from '../types'
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
  ['monthlyRestDays', '월 고정 기준 휴무', '일'],
  ['functionalMinOnDuty', '일반직 최소 출근', '명'],
  ['supportMaxOff', '계약직 최대 휴무', '명'],
  ['supportMaxRequestsPerDate', '계약직 날짜별 희망휴무 한도', '명'],
  ['produceOpenCount', '농산 담당 오픈 최소 인원', '명'],
  ['maxConsecutiveWorkDays', '최대 연속근무 (0은 제한 없음)', '일'],
  ['maxWishDaysPerEmployee', '월 희망휴무 한도 (0은 제한 없음)', '일'],
  ['requestDueDay', '희망휴무 취합일', '일'],
  ['publishDay', '근무표 공유일', '일'],
]
const priorityFields: [NumericOperation, string][] = [
  ['approvedWishWeight', '승인 희망휴무 우선도'], ['pendingWishWeight', '대기 희망휴무 우선도'],
  ['weeklyRestBalanceWeight', '주간 휴무 분산'], ['weekendRestFairnessWeight', '주말·공휴일 휴무 형평성'],
  ['shiftRotationWeight', '전월 연계 오픈·마감 순환'], ['openCloseBalanceWeight', '일별 오픈·마감 인원 균형'],
]
const priorityRows: { key: RulePriorityKey; title: string; status: (operations: Operations, settings: Settings, activeCount: number, contractCount: number) => string; detail: (operations: Operations, settings: Settings) => string }[] = [
  { key: 'minimumStaffing', title: '일일 최소 인원', status: (o) => (o.staffingMode === 'combined' ? o.weekdayMinimum > 0 || o.weekendMinimum > 0 : o.weekdayRegularMinimum + o.weekdayContractMinimum + o.weekendRegularMinimum + o.weekendContractMinimum > 0) ? '켜짐' : '꺼짐', detail: o => o.staffingMode === 'combined' ? `평일 ${o.weekdayMinimum}명 · 주말 ${o.weekendMinimum}명` : '정규직·계약직 기준 적용' },
  { key: 'regularCoverage', title: '정규직 오픈·마감 배치', status: o => o.requireRegularEachShift ? '켜짐' : '꺼짐', detail: () => '하루 정규직 1명 이상 근무 · 오픈·마감은 가능한 범위' },
  { key: 'weekendRegularFullShift', title: '주말 정규직 종일근무', status: o => o.weekendRegularFullShift ? '켜짐' : '꺼짐', detail: () => '토·일 각각 1명 · 정규직 1인 주 1회 · 평일 종일 금지' },
  { key: 'monthlyRest', title: '월 기준 휴무 일수', status: () => '켜짐', detail: o => o.monthlyRestMode === 'fixed' ? `매월 ${o.monthlyRestDays}일` : '주말·공휴일 수에 맞춤' },
  { key: 'employeeRules', title: '직원별 고정 휴무·가능 근무', status: (_o, _s, count) => count ? `켜짐 · 직원 ${count}명` : '꺼짐', detail: () => '직원별 근무 가능 유형과 반복 휴무' },
  { key: 'daysOffPairs', title: '동시 휴무 제한', status: (_o, s) => s.daysOffPairs.length ? `켜짐 · ${s.daysOffPairs.length}쌍` : '꺼짐', detail: () => '지정한 직원 조합은 같은 날 휴무 금지' },
  { key: 'produceOpening', title: '농산 담당 오픈', status: o => o.requireProduceOpener || o.produceOpenCount > 0 ? '켜짐' : '꺼짐', detail: o => o.requireProduceOpener ? `담당자·대직자 중 1명${o.produceOpenCount ? ` · 담당 최소 ${o.produceOpenCount}명` : ''}` : `담당 오픈 최소 ${o.produceOpenCount}명` },
  { key: 'functionalMinimum', title: '일반직 최소 출근', status: o => o.functionalMinOnDuty > 0 ? '켜짐' : '꺼짐', detail: o => `하루 ${o.functionalMinOnDuty}명` },
  { key: 'supportRestLimit', title: '계약직 동시 휴무 상한', status: (o, _s, _count, contracts) => contracts > 0 && o.supportMaxOff < contracts ? '켜짐' : '꺼짐', detail: o => `하루 최대 ${o.supportMaxOff}명 휴무` },
  { key: 'approvedRequests', title: '승인 희망휴무', status: o => o.approvedWishWeight > 0 ? '켜짐' : '꺼짐', detail: o => `선호 점수 ${o.approvedWishWeight}` },
  { key: 'pendingRequests', title: '대기 희망휴무', status: o => o.pendingWishWeight > 0 ? '켜짐' : '꺼짐', detail: o => `선호 점수 ${o.pendingWishWeight}` },
  { key: 'consecutiveClose', title: '마감 연속 제한', status: o => o.noConsecutiveClose ? '켜짐' : '꺼짐', detail: () => '정규직 마감 다음 날 마감 금지' },
  { key: 'fullCloseAdjacent', title: '종일·마감 연속 제한', status: o => o.noFullCloseAdjacent ? '켜짐' : '꺼짐', detail: () => '정규직 종일과 마감 연속 금지' },
  { key: 'maxConsecutiveWork', title: '최대 연속 근무', status: o => o.maxConsecutiveWorkDays > 0 ? '켜짐' : '꺼짐', detail: o => o.maxConsecutiveWorkDays > 0 ? `${o.maxConsecutiveWorkDays}일` : '제한 없음' },
  { key: 'weeklyRestBalance', title: '주간 휴무 분산', status: o => o.weeklyRestBalanceWeight > 0 ? '켜짐' : '꺼짐', detail: o => `선호 점수 ${o.weeklyRestBalanceWeight}` },
  { key: 'weekendRestFairness', title: '주말·공휴일 휴무 형평성', status: o => o.weekendRestFairnessWeight > 0 ? '켜짐' : '꺼짐', detail: o => `선호 점수 ${o.weekendRestFairnessWeight}` },
  { key: 'shiftRotation', title: '전월 연계 오픈·마감 순환', status: o => o.shiftRotationWeight > 0 ? '켜짐' : '꺼짐', detail: o => `선호 점수 ${o.shiftRotationWeight}` },
  { key: 'openCloseBalance', title: '일별 오픈·마감 인원 균형', status: o => o.openCloseBalanceWeight > 0 ? '켜짐' : '꺼짐', detail: o => `선호 점수 ${o.openCloseBalanceWeight}` },
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
  const fixedRuleEmployees = activeEmployees.filter(employee => Boolean(employee.workRules && ((employee.workRules.offRules?.length ?? 0) > 0 || employee.workRules.allowedShifts.length < 2))).length
  const activeContractEmployees = activeEmployees.filter(employee => employee.employmentType === '계약직').length
  const sortedPriorityRows = [...priorityRows].sort((a, b) => ops.rulePriorities[a.key] - ops.rulePriorities[b.key] || a.title.localeCompare(b.title, 'ko'))
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
      <section className="panel pad settings-card-times">
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

      <section className="panel pad settings-card-staffing">
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

      <section className="panel pad settings-card-rest">
        <h2>월 휴무 산정</h2>
        <label className="field">직원별 기준 휴무 산정 방식
          <select value={ops.monthlyRestMode} onChange={event => setOp('monthlyRestMode', event.target.value as Operations['monthlyRestMode'])}>
            <option value="weekendHolidayCount">월 주말·공휴일 수에 맞춤</option>
            <option value="fixed">매월 같은 일수</option>
          </select>
        </label>
        {ops.monthlyRestMode === 'fixed' && <p className="muted small">고정 일수는 편성 규칙에서 지정합니다.</p>}
        <hr/>
        <h3 className="settings-subhead">공휴일 · 기준 휴무</h3>
        <div className="stepper" role="group" aria-label="월 이동">
          <button aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><strong>{monthLabel(month)}</strong><button aria-label="다음 달" onClick={() => changeMonth(1)}>›</button>
        </div>
        <p className="big-number">{restTarget}<small>일</small><span>직원별 기준 휴무</span></p>
        {monthHolidays.length === 0 ? <p className="muted small">이번 달 공휴일이 없습니다.</p> : <ul className="list">{monthHolidays.map(item => <li key={item.date}>
          <span><b>{item.date.slice(5).replace('-', '월 ')}일</b> {item.name}</span>
          {settings.additionalHolidays.includes(item.date) && <button className="btn btn-sm btn-danger-ghost" onClick={() => void saveSettings({ ...settings, additionalHolidays: settings.additionalHolidays.filter(date => date !== item.date) })}>삭제</button>}
        </li>)}</ul>}
        <span className="inline">
          <input type="date" value={holidayDate} onChange={event => setHolidayDate(event.target.value)} aria-label="추가 공휴일"/>
          <button className="btn btn-sm" disabled={!holidayDate} onClick={() => void addHoliday()}>임시 공휴일 추가</button>
        </span>
      </section>

      <section className="panel pad settings-card-rules">
        <h2>편성 규칙</h2>
        <div className="number-grid">
          {ruleFields.filter(([field]) => field !== 'monthlyRestDays' || ops.monthlyRestMode === 'fixed').map(([field, label, unit]) => <label className="field" key={field}>{label}
            <span className="unit"><input type="number" min={field === 'requestDueDay' || field === 'publishDay' ? 1 : 0} max={['requestDueDay', 'publishDay', 'maxConsecutiveWorkDays', 'maxWishDaysPerEmployee', 'monthlyRestDays'].includes(field) ? 31 : 100}
              value={ops[field]} onChange={event => setOp(field, Number(event.target.value))}/>{unit}</span>
          </label>)}
        </div>
        <label className="check"><input type="checkbox" checked={ops.requireRegularEachShift} onChange={event => setOp('requireRegularEachShift', event.target.checked)}/><span>오픈·마감에 일반직을 각각 한 명 이상 배치</span></label>
        <label className="check"><input type="checkbox" checked={ops.allowFullShiftGeneration} onChange={event => setOp('allowFullShiftGeneration', event.target.checked)}/><span>자동 편성에서 주말 종일근무 생성 허용 <small className="muted">정규직만 가능하며 한 주에 최대 1회입니다.</small></span></label>
        <label className="check"><input type="checkbox" checked={ops.weekendRegularFullShift} onChange={event => setOp('weekendRegularFullShift', event.target.checked)}/><span>주말 종일근무 <small className="muted">주말 정규직만 가능, 토·일 각각 1명, 정규직 한 명당 주 1회만 배정합니다. 평일·계약직 종일은 금지합니다.</small></span></label>
        <label className="check"><input type="checkbox" checked={ops.requireProduceOpener} onChange={event => setOp('requireProduceOpener', event.target.checked)}/><span>매일 농산 담당자 또는 대직자 오픈 배치</span></label>
        <label className="check"><input type="checkbox" checked={ops.noConsecutiveClose} onChange={event => setOp('noConsecutiveClose', event.target.checked)}/><span>일반직은 마감을 이틀 연속 하지 않음 <small className="muted">마감 → 마감 금지</small></span></label>
        <label className="check"><input type="checkbox" checked={ops.noFullCloseAdjacent} onChange={event => setOp('noFullCloseAdjacent', event.target.checked)}/><span>일반직은 종일과 마감을 연달아 하지 않음 <small className="muted">종일 → 마감, 마감 → 종일 금지</small></span></label>
      </section>

      <section className="panel pad rule-priority-panel settings-card-priority">
        <h2>자동 편성 룰 현황·우선순위</h2>
        <p className="muted small">숫자가 작을수록 더 우선합니다. 켜진 제약 룰은 1~3순위에서 필수로 고정하고, 4~19순위는 다른 조건과 충돌할 때 점수로 비교합니다. 희망휴무와 형평성은 순위에 따라 선호 점수가 달라집니다. 기준 휴무 초과를 줄이려면 ‘월 기준 휴무 일수’를 1~3순위로 올려 보세요. 다만 고정 근무나 직원별 휴무 조건과 충돌하면 가능한 편성이 줄어들 수 있습니다. 지키지 못한 룰은 후보의 확인 항목에 표시합니다.</p>
        <div className="rule-matrix-wrap"><table className="rule-matrix">
          <thead><tr><th scope="col">자동 편성 룰</th><th scope="col">상태</th><th scope="col">현재 설정</th><th scope="col">우선순위</th></tr></thead>
          <tbody>{sortedPriorityRows.map(row => <tr key={row.key}>
            <th scope="row">{row.title}</th>
            <td><span className={`pill ${row.status(ops, settings, fixedRuleEmployees, activeContractEmployees).startsWith('켜짐') ? 'pill-ok' : 'pill-off'}`}>{row.status(ops, settings, fixedRuleEmployees, activeContractEmployees)}</span></td>
            <td>{row.detail(ops, settings)}</td>
            <td><select aria-label={`${row.title} 우선순위`} value={ops.rulePriorities[row.key]} onChange={event => update(current => ({ ...current, operations: { ...current.operations, rulePriorities: { ...current.operations.rulePriorities, [row.key]: Number(event.target.value) } } }))}>{Array.from({ length: 19 }, (_, index) => index + 1).map(rank => <option key={rank} value={rank}>{rank}순위</option>)}</select></td>
          </tr>)}</tbody>
        </table></div>
        <h3>선호도 점수</h3>
        <p className="muted small">우선순위가 같은 조건끼리 후보를 고를 때 참고하는 선호 점수입니다. 0이면 선호하지 않습니다.</p>
        <div className="number-grid">
          {priorityFields.map(([field, label]) => <label className="field" key={field}>{label}
            <span className="unit"><input type="number" min={0} max={100} value={ops[field]} onChange={event => setOp(field, Number(event.target.value))}/>점</span>
          </label>)}
        </div>
        <p className="muted small">기본값은 승인 희망휴무를 대기 신청보다 3배 선호합니다.</p>
      </section>

      <section className="panel pad settings-card-dates">
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

      <section className="panel pad settings-card-pairs">
        <h2>동시 휴무 제한</h2>
        <p className="muted small">같은 날 함께 쉴 수 없는 직원 조합입니다.</p>
        {settings.daysOffPairs.length === 0 ? <p className="muted">등록된 제한이 없습니다.</p> : <ul className="list">{settings.daysOffPairs.map((pair, index) => <li key={index}>
          <span><b>{nameOf(pair.employeeIds[0])}</b> ↔ <b>{nameOf(pair.employeeIds[1])}</b></span>
          <button className="btn btn-sm btn-danger-ghost" onClick={() => update(current => ({ ...current, daysOffPairs: current.daysOffPairs.filter((_, i) => i !== index) }))}>삭제</button>
        </li>)}</ul>}
        <PairAdder employees={activeEmployees} existing={settings.daysOffPairs} onAdd={pair => update(current => ({ ...current, daysOffPairs: [...current.daysOffPairs, { employeeIds: pair }] }))}/>
      </section>

    </div>

    {user && <AdminAccountsPanel accounts={accounts} currentUserId={user.id} onChanged={() => void load()}/>}
  </>
}
