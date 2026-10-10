import type { AppState } from '../hooks/useApp'
import type { Employee, Shift } from '../types'
import { isLockedDate, shiftHours, shiftShort, shiftText } from '../lib/schedule'

type Props = { app: AppState; employee: Employee; date: string; day: number; showHours?: boolean; compact?: boolean }

/** One editable schedule cell: the shift chip plus the pin that keeps it fixed during auto-planning. */
export function ShiftCell({ app, employee, date, day, showHours = false, compact = false }: Props) {
  const { isAdmin, settings, shiftMap, requests, saveShift, cycleShift, toggleCellLock } = app
  const shift = shiftMap.get(`${employee.id}:${date}`)
  const request = requests.find(item => item.employeeId === employee.id && item.date === date && item.status !== 'rejected')
  const approved = request?.status === 'approved'
  const pastLocked = isLockedDate(date, settings)
  const frozen = pastLocked || Boolean(shift?.locked)
  const hours = shiftHours(employee, shift, settings, isAdmin)
  const label = shift ? shiftText[shift.code] : '미정'
  const title = [
    shift?.locked ? '입력 확정 · 수정 불가' : pastLocked ? '지난 날짜 · 수정 잠금' : null,
    label,
    hours ? `${hours.start}–${hours.end}` : null,
    request ? `희망휴무 ${approved ? '승인' : '신청'}` : null,
  ].filter(Boolean).join(' · ')
  return <>
    <button
      type="button"
      className={['chip', compact && 'chip-compact', shift ? `chip-${shift.code}` : 'chip-empty', request && 'has-request', approved && 'is-approved', frozen && 'is-frozen'].filter(Boolean).join(' ')}
      disabled={!isAdmin || frozen}
      title={title}
      aria-label={`${employee.name} ${date} ${label}`}
      onClick={() => void saveShift(employee.id, day, cycleShift(shift))}
    >
      <span className="chip-label">{shift ? (compact ? shiftShort[shift.code] : shiftText[shift.code]) : '·'}</span>
      {showHours && hours && <small className="chip-hours">{hours.start}–{hours.end}</small>}
      {approved && <i className="chip-flag" aria-hidden="true">{compact ? '' : '희망'}</i>}
      {request && !approved && <i className="chip-dot" aria-hidden="true"/>}
    </button>
    {isAdmin && shift && !pastLocked && <PinButton shift={shift} name={employee.name} onToggle={() => void toggleCellLock(shift)}/>}
  </>
}

function PinButton({ shift, name, onToggle }: { shift: Shift; name: string; onToggle: () => void }) {
  return <button
    type="button"
    className={`pin ${shift.locked ? 'is-on' : ''}`}
    aria-pressed={Boolean(shift.locked)}
    aria-label={`${name} ${shift.date} ${shift.locked ? '고정 해제' : '고정'}`}
    title={shift.locked ? '고정됨 · 눌러서 해제' : '이 칸을 자동 편성에서 고정'}
    onClick={onToggle}
  >{shift.locked ? '◆' : '◇'}</button>
}
