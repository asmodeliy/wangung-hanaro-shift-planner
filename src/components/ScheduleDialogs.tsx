import type { AppState } from '../hooks/useApp'
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
