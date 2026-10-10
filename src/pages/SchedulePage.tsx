import { useState, type MouseEvent } from 'react'
import type { AppState } from '../hooks/useApp'
import { monthKey, monthLabel } from '../lib/schedule'
import { Icon } from '../components/Icon'
import { MonthCalendar, MonthTable, WeekCards, WeekTable } from '../components/ScheduleViews'
import { ExportDialog, type ExportFormat } from '../components/ScheduleDialogs'

const closeMenu = (event: MouseEvent<HTMLElement>) => event.currentTarget.closest('details')?.removeAttribute('open')

export function SchedulePage({ app }: { app: AppState }) {
  const {
    user, isAdmin, month, viewMode, changeViewMode, changeMonth, goToToday, weekIndex, setWeekIndex, weekCount, weekRangeLabel,
    generating, hasLockedShifts, lockedShiftCount, generate, lockExistingShifts, resetMonth, openScheduleHistory, confirmed, confirmSchedule,
    referenceAvailable, setShowReference, loading, restTarget, activeEmployees, workCount, requests, settings,
    visibleScheduleNotices, visibleRequestWarnings, dismissNotice, photoImport, resolvePhotoNote,
  } = app
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null)
  const noticeCount = visibleScheduleNotices.length + visibleRequestWarnings.length
  const title = isAdmin ? '월간 근무표' : `${user?.employeeName ?? '내'} 근무 일정`
  const subtitle = isAdmin ? '희망휴무와 운영 조건을 확인하며 이번 달 일정을 완성하세요.' : '매장 근무 일정을 확인하고 희망휴무를 신청할 수 있어요.'

  return <>
    <header className="page-head">
      <div><h1>{title}</h1><p>{subtitle}</p></div>
      <div className="page-actions">
        <button className="btn btn-ghost" onClick={() => setExportFormat('xlsx')}><Icon name="download" size={16}/>엑셀 내보내기</button>
        <button className="btn btn-ghost" onClick={() => setExportFormat('pdf')}><Icon name="print" size={16}/>PDF 내보내기</button>
        {isAdmin && <>
          <button className="btn" disabled={generating} onClick={() => void generate('fill')}>빈칸 채우기</button>
          <button className="btn btn-primary" disabled={generating || hasLockedShifts} title={hasLockedShifts ? '고정된 입력이 있어 빈칸 채우기만 사용할 수 있습니다.' : undefined} onClick={() => void generate()}>
            <Icon name="spark" size={16}/>{generating ? '편성 중…' : '전체 자동 편성'}
          </button>
          <details className="menu">
            <summary className="btn btn-ghost" aria-label="더보기">더보기 <span aria-hidden="true">▾</span></summary>
            <div className="menu-list" role="menu">
              <button role="menuitem" onClick={event => { closeMenu(event); void openScheduleHistory() }}>변경 이력 · 되돌리기</button>
              {hasLockedShifts
                ? <button role="menuitem" disabled={generating} onClick={event => { closeMenu(event); void generate('rebalance') }}>고정 칸 유지하고 재편성</button>
                : <button role="menuitem" disabled={generating} onClick={event => { closeMenu(event); void lockExistingShifts() }}>입력된 칸 모두 고정</button>}
              {referenceAvailable && <button role="menuitem" onClick={event => { closeMenu(event); setShowReference(true) }}>수기 근무표 보기</button>}
              <hr/>
              <button role="menuitem" className="is-danger" disabled={generating} onClick={event => { closeMenu(event); void resetMonth() }}>{monthLabel(month)} 초기화</button>
            </div>
          </details>
        </>}
      </div>
    </header>

    <section className="panel schedule-panel">
      <div className="toolbar">
        <div className="stepper" role="group" aria-label="월 이동">
          <button aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button>
          <strong>{monthLabel(month)}</strong>
          <button aria-label="다음 달" onClick={() => changeMonth(1)}>›</button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={goToToday}>오늘</button>
        {<div className="stepper only-narrow" role="group" aria-label="주 이동">
          <button aria-label="이전 주" disabled={weekIndex === 0} onClick={() => setWeekIndex(index => Math.max(0, index - 1))}>‹</button>
          <strong>{weekIndex + 1}주차 <small>{weekRangeLabel}</small></strong>
          <button aria-label="다음 주" disabled={weekIndex >= weekCount - 1} onClick={() => setWeekIndex(index => Math.min(weekCount - 1, index + 1))}>›</button>
        </div>}
        {viewMode === 'week' && <div className="stepper only-wide" role="group" aria-label="주 이동">
          <button aria-label="이전 주" disabled={weekIndex === 0} onClick={() => setWeekIndex(index => Math.max(0, index - 1))}>‹</button>
          <strong>{weekIndex + 1}주차 <small>{weekRangeLabel}</small></strong>
          <button aria-label="다음 주" disabled={weekIndex >= weekCount - 1} onClick={() => setWeekIndex(index => Math.min(weekCount - 1, index + 1))}>›</button>
        </div>}
        <div className="toolbar-spacer"/>
        <div className="tabs only-wide" role="tablist" aria-label="보기 방식">
          {([['table', '월 표'], ['week', '주간'], ['calendar', '달력']] as const).map(([value, label]) =>
            <button key={value} role="tab" aria-selected={viewMode === value} className={viewMode === value ? 'is-active' : ''} onClick={() => changeViewMode(value)}>{label}</button>)}
        </div>
      </div>

      <div className="status-row">
        <span className="pill"><Icon name="clock" size={14}/>직원별 기준 휴무 <b>{restTarget}일</b></span>
        {isAdmin && <span className={`pill ${confirmed ? 'pill-ok' : 'pill-draft'}`}>{confirmed ? '확정된 근무표' : '작성 중'}</span>}
        {isAdmin && hasLockedShifts && <span className="pill">◆ 고정 {lockedShiftCount}칸</span>}
        {isAdmin && <span className={`pill ${noticeCount ? 'pill-warn' : ''}`}>확인 항목 <b>{noticeCount}건</b></span>}
        <span className="pill-note">{isAdmin ? '칸을 누르면 오픈 → 마감 → 종일 → 휴무 → 비움 순서로 바뀝니다.' : '본인 일정은 이름 옆에 “나”로 표시됩니다.'}</span>
      </div>

      {isAdmin && <dl className="stats">
        <div><dt>재직 직원</dt><dd>{activeEmployees.length}<small>명</small></dd></div>
        <div><dt>배정 근무</dt><dd>{workCount}<small>건</small></dd></div>
        <div><dt>휴무 신청</dt><dd>{requests.length}<small>건</small></dd></div>
        <div><dt>평일 · 주말 목표</dt><dd>{settings.operations.weekdayTarget}<small> · </small>{settings.operations.weekendTarget}<small>명</small></dd></div>
      </dl>}

      <ul className="legend" aria-label="범례">
        <li><span className="tag tag-open">오픈</span></li><li><span className="tag tag-close">마감</span></li>
        <li><span className="tag tag-full">종일</span></li><li><span className="tag tag-off">휴무</span></li>
        <li><i className="chip-dot"/>희망휴무 신청</li><li><i className="chip-flag">희망</i>승인됨</li><li>◆ 고정</li>
      </ul>

      {loading ? <div className="state"><i className="spinner"/>근무표를 불러오는 중입니다.</div> : <>
        <div className="only-wide">
          {viewMode === 'table' && <MonthTable app={app}/>}
          {viewMode === 'week' && <WeekTable app={app}/>}
          {viewMode === 'calendar' && <MonthCalendar app={app}/>}
        </div>
        <div className="only-narrow"><WeekCards app={app}/></div>
      </>}

      {isAdmin && noticeCount > 0 && <section className="notices" aria-label="확인이 필요한 항목">
        <header><b>확인이 필요한 항목</b><span>{noticeCount}건</span></header>
        <ul>{[...visibleScheduleNotices, ...visibleRequestWarnings].map((notice, index) => <li key={`${notice.date ?? ''}:${notice.text}:${index}`}>
          <span>{notice.text}</span>
          <button className="link" onClick={() => dismissNotice(notice)} aria-label={`${notice.text} 숨기기`}>숨기기</button>
        </li>)}</ul>
      </section>}

      <footer className="panel-foot">
        <span>{isAdmin ? '근무시간은 직원 설정을 따릅니다. 확정 전에 확인 항목을 점검해 주세요.' : '근무 변경 요청은 관리자에게 전달해 주세요.'}</span>
        {isAdmin && <button className="btn btn-primary" disabled={confirmed} onClick={() => void confirmSchedule()}>{confirmed ? '확정됨' : `${monthKey(month).slice(5)}월 근무표 확정`}<Icon name="arrow" size={16}/></button>}
      </footer>
    </section>

    {isAdmin && photoImport?.month === monthKey(month) && (photoImport.entries.length > 0 || photoImport.notes.length > 0) && <section className="panel pad">
      <h2>사진 근무표 반영</h2>
      <p className="muted">읽을 수 있는 근무 {photoImport.entries.length}건을 반영했습니다. 원본과 비교해 필요한 칸을 수정한 뒤 확인 완료를 눌러 주세요.</p>
      <ul className="list">{photoImport.notes.map(note => <li key={note.id} className={note.resolved ? 'is-done' : ''}>
        <span><b>{Number(note.date.slice(-2))}일</b> {note.text}</span>
        <button className="btn btn-sm" onClick={() => void resolvePhotoNote(note.id, !note.resolved)}>{note.resolved ? '되돌리기' : '확인 완료'}</button>
      </li>)}</ul>
    </section>}
    {exportFormat && <ExportDialog currentMonth={monthKey(month)} initialFormat={exportFormat} onClose={() => setExportFormat(null)}/>}
  </>
}
