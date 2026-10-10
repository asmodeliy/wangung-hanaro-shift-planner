import { useEffect, useState } from 'react'
import type { AppState } from '../hooks/useApp'
import { api } from '../lib/api'
import { monthLabel, shiftShort, weekdays } from '../lib/schedule'
import { Modal } from './Modal'

/** Compare auto-planning alternatives on a month grid before anything is written. */
export function OptionsDialog({ app }: { app: AppState }) {
  const { scheduleOptions, setScheduleOptions, selectedOption, setSelectedOptionId, previewDays, previewShifts, activeEmployees, generating, findMoreOptions, applyScheduleOption } = app
  if (!scheduleOptions) return null
  const close = () => setScheduleOptions(null)
  return <Modal size="lg" title="자동 편성 대안 미리보기" onClose={close}
    description={`${scheduleOptions.month} · 기준 휴무 ${scheduleOptions.targetRestDays}일 · 적용 전에 월간 근무표를 비교하세요.`}
    footer={<>
      <button className="btn" disabled={generating || scheduleOptions.nextOffset >= 100000} onClick={() => void findMoreOptions()}>{generating ? '탐색 중…' : '다른 대안 더 찾기'}</button>
      <span className="spacer"/>
      <button className="btn" onClick={close}>취소</button>
      <button className="btn btn-primary" disabled={!selectedOption || generating} onClick={() => selectedOption && void applyScheduleOption(selectedOption)}>선택한 안 적용</button>
    </>}>
    <p className="muted small">서로 다른 안 {scheduleOptions.options.length}개를 찾았습니다. 안을 선택하면 오른쪽 표에 배정이 표시됩니다. 전체 조합을 모두 열거한 것은 아닙니다.</p>
    <div className="options">
      <ul className="option-list">{scheduleOptions.options.map(option => <li key={option.id}>
        <button type="button" className={selectedOption?.id === option.id ? 'is-selected' : ''} onClick={() => setSelectedOptionId(option.id)}>
          <b>대안 {option.id}</b>
          <small>{option.warnings.length ? `확인 항목 ${option.warnings.length}건` : '운영 기준 충족'}</small>
          {option.warnings.slice(0, 3).map((warning, index) => <small className="is-warn" key={`${index}-${warning}`}>{warning}</small>)}
          {option.warnings.length > 3 && <small className="is-warn">외 {option.warnings.length - 3}건</small>}
        </button>
      </li>)}</ul>
      <div className="option-preview">
        {selectedOption ? <>
          <p><b>대안 {selectedOption.id}</b> <span className="muted small">오 오픈 · 마 마감 · 종 종일 · 휴 휴무</span></p>
          <div className="grid-scroll"><table className="grid grid-mini">
            <thead><tr><th className="grid-staff">직원</th>{previewDays.map(day => {
              const date = `${scheduleOptions.month}-${String(day).padStart(2, '0')}`
              return <th key={date} className="grid-day"><span>{weekdays[new Date(`${date}T12:00:00`).getDay()]}</span><b>{day}</b></th>
            })}</tr></thead>
            <tbody>{activeEmployees.map(employee => <tr key={employee.id}>
              <th className="grid-staff">{employee.name}</th>
              {previewDays.map(day => {
                const date = `${scheduleOptions.month}-${String(day).padStart(2, '0')}`
                const code = previewShifts.get(`${employee.id}:${date}`)
                return <td key={date} className={code ? `mini-${code}` : ''}>{code ? shiftShort[code] : '·'}</td>
              })}
            </tr>)}</tbody>
          </table></div>
        </> : <p className="muted">표시할 대안이 없습니다.</p>}
      </div>
    </div>
  </Modal>
}

export function HistoryDialog({ app }: { app: AppState }) {
  const { showScheduleHistory, setShowScheduleHistory, historyLoading, scheduleHistory, openScheduleHistory, restoreScheduleHistory, month } = app
  if (!showScheduleHistory) return null
  const close = () => setShowScheduleHistory(false)
  return <Modal title={`${monthLabel(month)} 변경 이력`} onClose={close}
    description="수동 수정, 자동 편성, 초기화, 복원 전 상태가 저장됩니다. 되돌려도 현재 상태가 새 이력으로 남습니다."
    footer={<><button className="btn" onClick={() => void openScheduleHistory()}>새로고침</button><span className="spacer"/><button className="btn" onClick={close}>닫기</button></>}>
    {historyLoading ? <p className="muted">이력을 불러오는 중입니다.</p>
      : scheduleHistory.length === 0 ? <p className="muted">이 달에는 저장된 변경 이력이 없습니다.</p>
      : <ul className="list">{scheduleHistory.map(item => <li key={item.id}>
        <span><b>{item.action}</b><br/><small className="muted">{new Date(item.createdAt).toLocaleString('ko-KR')} · {item.username} · 배정 {item.shiftCount}칸</small></span>
        <button className="btn btn-sm" onClick={() => void restoreScheduleHistory(item)}>이 상태로 되돌리기</button>
      </li>)}</ul>}
  </Modal>
}

export function ReferenceDialog({ app }: { app: AppState }) {
  if (!app.showReference) return null
  return <Modal size="lg" title="수기 근무표 참고" description="관리자 전용 · 업로드한 원본 이미지" onClose={() => app.setShowReference(false)}>
    <img className="reference-image" src="/api/reference-schedule" alt="수기 근무표 참고 이미지"/>
  </Modal>
}

const monthText = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`

export type ExportFormat = 'pdf' | 'xlsx'

/** Choose file type, layout (month table or calendar) and months. PDF pages and Excel sheets are one per month. */
export function ExportDialog({ currentMonth, initialFormat, onClose }: { currentMonth: string; initialFormat: ExportFormat; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat)
  const [layout, setLayout] = useState<'table' | 'calendar'>('table')
  const [months, setMonths] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string[]>([currentMonth])
  const [failed, setFailed] = useState('')
  useEffect(() => {
    void api<string[]>('/api/export/months').then(list => setMonths([...new Set([...list, currentMonth])].sort()))
      .catch(error => setFailed(error instanceof Error ? error.message : '내보낼 월을 불러오지 못했습니다.'))
  }, [currentMonth])
  const toggle = (month: string) => setSelected(current => current.includes(month) ? current.filter(item => item !== month) : [...current, month].sort())
  const href = `/api/export/schedule.${format}?layout=${layout}&months=${selected.join(',')}`
  const choice = <T extends string>(value: T, current: T, set: (next: T) => void, title: string, hint: string) =>
    <button type="button" className={`choice ${value === current ? 'is-selected' : ''}`} aria-pressed={value === current} onClick={() => set(value)}><b>{title}</b><small>{hint}</small></button>
  return <Modal size="sm" title="내보내기" description="A4 가로 용지에 맞춰 한 달을 한 장(한 시트)으로 만듭니다. 선택한 월마다 한 장씩 만들어집니다." onClose={onClose}
    footer={<>
      <span className="spacer"/>
      <button className="btn" type="button" onClick={onClose}>취소</button>
      <a className={`btn btn-primary ${selected.length ? '' : 'is-disabled'}`} href={selected.length ? href : undefined} aria-disabled={!selected.length} download onClick={() => window.setTimeout(onClose, 300)}>
        {format === 'pdf' ? 'PDF' : '엑셀'} 파일 받기{selected.length ? ` · ${selected.length}개 월` : ''}
      </a>
    </>}>
    <div className="field">파일 형식
      <div className="choices">
        {choice('pdf', format, setFormat, 'PDF', '인쇄용 · 가로 A4')}
        {choice('xlsx', format, setFormat, '엑셀', '월마다 시트 · 수정 가능')}
      </div>
    </div>
    <div className="field">보기 방식
      <div className="choices">
        {choice('table', layout, setLayout, '월 표', '직원 × 날짜 표')}
        {choice('calendar', layout, setLayout, '달력', '날짜별 오픈·마감·휴무')}
      </div>
    </div>
    <div className="field">월 선택
      {failed ? <p className="muted">{failed}</p> : !months ? <p className="muted">불러오는 중입니다.</p>
        : <ul className="check-list">{months.map(month => <li key={month}>
          <label className="check"><input type="checkbox" checked={selected.includes(month)} onChange={() => toggle(month)}/><span>{monthText(month)}{month === currentMonth && <small className="muted"> · 현재 보는 월</small>}</span></label>
        </li>)}</ul>}
    </div>
  </Modal>
}
