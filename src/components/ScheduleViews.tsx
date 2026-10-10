import { useMemo } from 'react'
import type { AppState } from '../hooks/useApp'
import type { Employee } from '../types'
import { dateKey, employmentLabel, isLockedDate, shiftHours, shiftText, todayKey, weekdays } from '../lib/schedule'
import { ShiftCell } from './ShiftCell'

const dayTone = (weekday: number, holiday: boolean) => weekday === 0 || holiday ? 'is-sun' : weekday === 6 ? 'is-sat' : ''

function StaffName({ employee, own, tone, compact = false }: { employee: Employee; own: boolean; tone: number; compact?: boolean }) {
  if (compact) return <span className={`staff-compact ${employee.employmentType === '계약직' ? 'is-contract' : 'is-regular'}`} title={`${employee.name} · ${employmentLabel(employee)}`}>
    <span className="staff-compact-name"><b>{employee.name}</b>{own && <em>나</em>}</span>
    <span className="staff-compact-meta">
      <small>{employmentLabel(employee)}</small>
      {employee.produceQualified && <i className="staff-badge">농산</i>}
      {employee.produceBackup && <i className="staff-badge">대직</i>}
    </span>
  </span>
  return <span className="staff">
    <span className={`avatar tone-${tone % 5}`} aria-hidden="true">{employee.name.slice(-1)}</span>
    <span className="staff-text"><b>{employee.name}{own && <em>나</em>}</b><small>{employmentLabel(employee)}</small></span>
  </span>
}

function useTotals(app: AppState) {
  const { shifts } = app
  return useMemo(() => {
    const totals = new Map<number, { rest: number; open: number; close: number }>()
    for (const shift of shifts) {
      const row = totals.get(shift.employeeId) ?? { rest: 0, open: 0, close: 0 }
      if (shift.code === 'off') row.rest++
      if (shift.code === 'open' || shift.code === 'full') row.open++
      if (shift.code === 'close' || shift.code === 'full') row.close++
      totals.set(shift.employeeId, row)
    }
    return totals
  }, [shifts])
}

function TotalsCell({ app, employee, totals, compact = false }: { app: AppState; employee: Employee; totals: ReturnType<typeof useTotals>; compact?: boolean }) {
  const stat = app.employeeStats.get(employee.id)
  const row = totals.get(employee.id) ?? { rest: 0, open: 0, close: 0 }
  const mismatch = row.rest !== app.restTarget
  if (compact) return <td className={`totals totals-compact ${mismatch ? 'is-mismatch' : ''}`}
    title={`휴무 ${row.rest}일 (기준 ${app.restTarget}일) · 오픈 ${row.open} · 마감 ${row.close}${app.isAdmin ? ` · 주말 ${stat?.weekendWork ?? 0}회 · 최장 ${stat?.longestConsecutive ?? 0}일 연속` : ''}`}>
    <b>휴 {row.rest}</b><span>오{row.open} 마{row.close}</span>
  </td>
  return <td className={`totals ${mismatch ? 'is-mismatch' : ''}`}>
    <b title={`기준 휴무 ${app.restTarget}일`}>휴무 {row.rest}</b>
    <span>오픈 {row.open} · 마감 {row.close}</span>
    {app.isAdmin && <small>주말 {stat?.weekendWork ?? 0}회 · 최장 {stat?.longestConsecutive ?? 0}일 연속</small>}
  </td>
}

/** Whole-month matrix: one row per employee, one column per day. */
export function MonthTable({ app }: { app: AppState }) {
  const { activeEmployees, monthSlots, holidayMap, visibleScheduleNotices, user } = app
  const totals = useTotals(app)
  return <div className="grid-scroll" tabIndex={0} role="region" aria-label="월간 근무표">
    <table className="grid grid-month">
      <thead><tr>
        <th className="grid-staff">직원</th>
        {monthSlots.map(slot => <th key={slot.date} className={`grid-day ${dayTone(slot.d.getDay(), holidayMap.has(slot.date))} ${slot.date === todayKey ? 'is-today' : ''} ${slot.d.getDay() === 1 ? 'is-week-start' : ''} ${visibleScheduleNotices.some(item => item.date === slot.date) ? 'has-warning' : ''}`} title={holidayMap.get(slot.date)}>
          <span>{weekdays[slot.d.getDay()]}</span><b>{slot.day}</b>
        </th>)}
        <th className="grid-total">합계</th>
      </tr></thead>
      <tbody>{activeEmployees.map((employee, row) => {
        const own = user?.role === 'employee' && employee.id === user.employeeId
        return <tr key={employee.id} className={own ? 'is-own' : ''}>
          <th className="grid-staff"><StaffName employee={employee} own={own} tone={row} compact/></th>
          {monthSlots.map(slot => {
            const warn = visibleScheduleNotices.some(item => item.date === slot.date)
            return <td key={slot.date} className={`grid-cell ${dayTone(slot.d.getDay(), holidayMap.has(slot.date))} ${slot.date === todayKey ? 'is-today' : ''} ${slot.d.getDay() === 1 ? 'is-week-start' : ''} ${warn ? 'has-warning' : ''}`}>
              <ShiftCell app={app} employee={employee} date={slot.date} day={slot.day} compact/>
            </td>
          })}
          <TotalsCell app={app} employee={employee} totals={totals} compact/>
        </tr>
      })}</tbody>
    </table>
  </div>
}

/** Seven-day view with hours and per-day staffing counters. */
export function WeekTable({ app }: { app: AppState }) {
  const { activeEmployees, weekDates, holidayMap, shifts, settings, visibleScheduleNotices, user } = app
  const totals = useTotals(app)
  return <div className="grid-scroll" tabIndex={0} role="region" aria-label="주간 근무표">
    <table className="grid grid-week">
      <thead><tr>
        <th className="grid-staff">직원</th>
        {weekDates.map((slot, column) => {
          if (!slot) return <th key={`blank-${column}`} className="grid-day is-blank">—</th>
          const off = slot.d.getDay() === 0 || slot.d.getDay() === 6 || holidayMap.has(slot.date)
          const target = off ? settings.operations.weekendTarget : settings.operations.weekdayTarget
          const assigned = shifts.filter(shift => shift.date === slot.date && ['open', 'close', 'full'].includes(shift.code)).length
          return <th key={slot.date} className={`grid-day ${dayTone(slot.d.getDay(), holidayMap.has(slot.date))}`}>
            <span>{weekdays[slot.d.getDay()]}</span><b>{slot.day}일</b>
            {app.isAdmin && <small className={assigned < target ? 'is-short' : ''}>출근 {assigned}/{target}</small>}
          </th>
        })}
        <th className="grid-total">월 합계</th>
      </tr></thead>
      <tbody>{activeEmployees.map((employee, row) => {
        const own = user?.role === 'employee' && employee.id === user.employeeId
        return <tr key={employee.id} className={own ? 'is-own' : ''}>
          <th className="grid-staff"><StaffName employee={employee} own={own} tone={row}/></th>
          {weekDates.map((slot, column) => {
            if (!slot) return <td key={`blank-${column}`} className="grid-cell is-blank">—</td>
            const warn = visibleScheduleNotices.some(item => item.date === slot.date)
            return <td key={slot.date} className={`grid-cell grid-cell-wide ${dayTone(slot.d.getDay(), holidayMap.has(slot.date))} ${warn ? 'has-warning' : ''}`}>
              <ShiftCell app={app} employee={employee} date={slot.date} day={slot.day} showHours/>
            </td>
          })}
          <TotalsCell app={app} employee={employee} totals={totals}/>
        </tr>
      })}</tbody>
    </table>
  </div>
}

/** Calendar layout: each day lists who opens, closes and rests. */
export function MonthCalendar({ app }: { app: AppState }) {
  const { month, dayCount, calendarLead, activeEmployees, shiftMap, holidayMap, visibleScheduleNotices, requests, settings, isAdmin } = app
  return <div className="calendar">
    <div className="calendar-head">{weekdays.map((weekday, index) => <span key={weekday} className={dayTone(index, false)}>{weekday}</span>)}</div>
    <div className="calendar-body">
      {Array.from({ length: calendarLead }, (_, index) => <div className="calendar-blank" key={`blank-${index}`}/>)}
      {Array.from({ length: dayCount }, (_, index) => {
        const d = new Date(month.getFullYear(), month.getMonth(), index + 1)
        const date = dateKey(d)
        const holiday = holidayMap.get(date)
        const notices = visibleScheduleNotices.filter(item => item.date === date)
        const hasFull = activeEmployees.some(employee => shiftMap.get(`${employee.id}:${date}`)?.code === 'full')
        const groups = (['open', 'close', 'full', 'off'] as const).filter(code => code !== 'full' || hasFull)
        return <article key={date} className={`calendar-day ${dayTone(d.getDay(), Boolean(holiday))} ${notices.length ? 'has-warning' : ''}`}>
          <header><b>{index + 1}</b>{holiday && <span>{holiday}</span>}{isAdmin && notices.length > 0 && <small>확인 {notices.length}</small>}</header>
          {groups.map(code => {
            const people = activeEmployees.filter(employee => shiftMap.get(`${employee.id}:${date}`)?.code === code)
            return <div className="calendar-group" key={code}>
              <span className={`tag tag-${code}`}>{shiftText[code]}</span>
              <div className="calendar-people">{people.length === 0 ? <small>—</small> : people.map(employee => {
                const shift = shiftMap.get(`${employee.id}:${date}`)
                const request = requests.find(item => item.employeeId === employee.id && item.date === date && item.status !== 'rejected')
                const frozen = isLockedDate(date, settings) || shift?.locked
                return <span key={employee.id} className={`person ${frozen ? 'is-frozen' : ''}`} title={request ? `희망휴무 ${request.status === 'approved' ? '승인' : '신청'}` : undefined}>
                  {employee.name}{shift?.locked && ' ◆'}{request?.status === 'approved' && <i>희망</i>}
                </span>
              })}</div>
            </div>
          })}
        </article>
      })}
    </div>
  </div>
}

/** Narrow-screen layout: one card per day of the selected week. */
export function WeekCards({ app }: { app: AppState }) {
  const { weekDates, activeEmployees, shiftMap, holidayMap, visibleScheduleNotices, requests, settings, isAdmin, user, saveShift, cycleShift } = app
  return <div className="day-cards">
    {weekDates.filter((slot): slot is NonNullable<typeof slot> => slot !== null).map(slot => {
      const holiday = holidayMap.get(slot.date)
      const notices = visibleScheduleNotices.filter(item => item.date === slot.date)
      return <article key={slot.date} className={`day-card ${notices.length ? 'has-warning' : ''}`}>
        <header>
          <b>{slot.day}</b><span className={dayTone(slot.d.getDay(), Boolean(holiday))}>{weekdays[slot.d.getDay()]}</span>
          {holiday && <em>{holiday}</em>}{isAdmin && notices.length > 0 && <small>확인 {notices.length}건</small>}
        </header>
        <ul>{activeEmployees.map((employee, index) => {
          const shift = shiftMap.get(`${employee.id}:${slot.date}`)
          const request = requests.find(item => item.employeeId === employee.id && item.date === slot.date && item.status !== 'rejected')
          const own = user?.role === 'employee' && employee.id === user.employeeId
          const hours = shiftHours(employee, shift, settings, isAdmin)
          const frozen = isLockedDate(slot.date, settings) || Boolean(shift?.locked)
          return <li key={employee.id}>
            <button type="button" className={`day-row ${own ? 'is-own' : ''}`} disabled={!isAdmin || frozen} onClick={() => void saveShift(employee.id, slot.day, cycleShift(shift))}>
              <span className={`avatar tone-${index % 5}`} aria-hidden="true">{employee.name.slice(-1)}</span>
              <span className="day-row-name">{employee.name}{own && <em>나</em>}{request && <i className="chip-dot" title="희망휴무"/>}</span>
              <span className={`tag ${shift ? `tag-${shift.code}` : 'tag-empty'}`}>{shift ? shiftText[shift.code] : '미정'}{hours && <small>{hours.start}–{hours.end}</small>}</span>
            </button>
          </li>
        })}</ul>
      </article>
    })}
  </div>
}
