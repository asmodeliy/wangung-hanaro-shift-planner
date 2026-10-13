import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Page } from '../types'

type FeedbackPageKey = Exclude<Page, 'feedback'> | 'common'
type Category = 'bug' | 'feedback'
const pageOptions: { value: FeedbackPageKey; label: string }[] = [
  { value: 'schedule', label: '월간 근무표' }, { value: 'requests', label: '희망휴무' },
  { value: 'attendance', label: '근태 모니터링' }, { value: 'employees', label: '직원 관리' },
  { value: 'settings', label: '운영 설정' }, { value: 'common', label: '공통·로그인' },
]
const areas: Record<FeedbackPageKey, string[]> = {
  schedule: ['달력·근무표 표시', '자동 편성', '확인 항목·룰 위반', '근무 수정·확정', '내보내기·인쇄', '기타 위치'],
  requests: ['희망휴무 신청·취소', '신청 목록', '관리자 승인·반려', '기타 위치'],
  attendance: ['파일 업로드', '근태 비교 결과', '직원 이름 매칭', '기타 위치'],
  employees: ['직원 목록', '직원 정보 수정', '계정 관리', '기타 위치'],
  settings: ['근무시간', '자동 편성 룰', '룰 우선순위', '휴일·날짜 예외', '기타 위치'],
  common: ['로그인·계정', '메뉴·화면', '모바일 사용', '기타 위치'],
}
const maxImageSize = 1024 * 1024

export function FeedbackPage({ initialPage }: { initialPage: FeedbackPageKey }) {
  const [category, setCategory] = useState<Category>('bug')
  const [page, setPage] = useState<FeedbackPageKey>(initialPage)
  const [area, setArea] = useState(areas[initialPage][0])
  const [detail, setDetail] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const photoSize = photos.reduce((total, photo) => total + photo.size, 0)

  useEffect(() => {
    setPage(initialPage)
    setArea(areas[initialPage][0])
  }, [initialPage])

  useEffect(() => {
    let active = true
    fetch('/api/feedback/status', { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() as Promise<{ configured: boolean }> : Promise.reject(new Error('status unavailable')))
      .then(result => { if (active) setConfigured(result.configured) })
      .catch(() => { if (active) setConfigured(false) })
    return () => { active = false }
  }, [])

  const updatePage = (next: FeedbackPageKey) => { setPage(next); setArea(areas[next][0]) }
  const selectPhotos = (selection: FileList | null) => {
    setError('')
    setSuccess(false)
    const selected = Array.from(selection ?? [])
    if (selected.length > 3) { setError('사진은 최대 3장까지 첨부할 수 있습니다.'); return }
    if (selected.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) { setError('PNG, JPEG, WebP 사진만 첨부할 수 있습니다.'); return }
    if (selected.some(file => file.size > maxImageSize)) { setError('사진 한 장은 1MB 이하로 올려 주세요.'); return }
    if (selected.reduce((total, file) => total + file.size, 0) > 3 * maxImageSize) { setError('사진 전체 용량은 3MB 이하로 올려 주세요.'); return }
    setPhotos(selected)
    if (photoInput.current) photoInput.current.value = ''
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || !configured) return
    setSubmitting(true)
    setError('')
    setSuccess(false)
    const form = new FormData()
    form.set('category', category)
    form.set('page', page)
    form.set('area', area)
    form.set('detail', detail)
    form.set('title', title)
    form.set('description', description)
    photos.forEach(photo => form.append('photos', photo))
    try {
      const response = await fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', body: form })
      const result = await response.json().catch(() => null) as { error?: string; sent?: boolean } | null
      if (!response.ok) throw new Error(result?.error ?? '피드백 메일을 보내지 못했습니다.')
      setSuccess(true)
      setTitle('')
      setDescription('')
      setDetail('')
      setPhotos([])
      if (photoInput.current) photoInput.current.value = ''
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '피드백을 보내지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return <>
    <header className="page-head">
      <div><h1>피드백·버그 신고</h1><p>불편한 점이나 오류를 알려 주세요. 화면 위치와 사진을 함께 보내면 더 빠르게 확인할 수 있습니다.</p></div>
    </header>

    <form className="panel pad feedback-form" onSubmit={event => void submit(event)}>
      {configured === false && <div className="alert alert-error feedback-config" role="status"><p><b>메일 발송 설정이 필요합니다.</b> Gmail 앱 비밀번호를 Vercel의 <code>GMAIL_APP_PASSWORD</code> 비밀 환경변수로 등록한 뒤 배포하면 제출 내용이 rillerosion@gmail.com으로 전송됩니다.</p></div>}
      {success && <div className="alert feedback-success" role="status"><p>피드백을 이메일로 보냈습니다. 감사합니다.</p></div>}
      {error && <div className="alert alert-error" role="alert"><p>{error}</p></div>}

      <fieldset className="feedback-kind"><legend>보내실 내용</legend>
        <label className={`feedback-kind-option ${category === 'bug' ? 'is-selected' : ''}`}><input type="radio" name="category" value="bug" checked={category === 'bug'} onChange={() => setCategory('bug')}/><span><b>버그 신고</b><small>오류가 발생하거나 예상대로 동작하지 않아요.</small></span></label>
        <label className={`feedback-kind-option ${category === 'feedback' ? 'is-selected' : ''}`}><input type="radio" name="category" value="feedback" checked={category === 'feedback'} onChange={() => setCategory('feedback')}/><span><b>사용성 의견</b><small>화면이나 기능을 개선했으면 해요.</small></span></label>
      </fieldset>

      <div className="feedback-location">
        <label className="field">화면
          <select value={page} onChange={event => updatePage(event.target.value as FeedbackPageKey)}>{pageOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        </label>
        <label className="field">수정이 필요한 곳
          <select value={area} onChange={event => setArea(event.target.value)}>{areas[page].map(value => <option key={value}>{value}</option>)}</select>
        </label>
        <label className="field feedback-detail">세부 위치 <span className="muted small">선택</span>
          <input value={detail} maxLength={120} onChange={event => setDetail(event.target.value)} placeholder="예: 12월 자동 편성 결과의 확인 항목 숫자"/>
        </label>
      </div>

      <label className="field">제목
        <input required minLength={3} maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder={category === 'bug' ? '예: 휴무일에 근무가 배정돼요' : '예: 주간 근무표에 직원 검색이 필요해요'}/>
      </label>
      <label className="field">상세 내용
        <textarea required minLength={10} maxLength={5000} rows={7} value={description} onChange={event => setDescription(event.target.value)} placeholder={category === 'bug' ? '무엇을 하다가 문제가 생겼는지, 기대한 결과와 실제 결과를 적어 주세요.' : '어떤 상황에서 어떤 점이 불편한지, 어떻게 바뀌면 좋을지 적어 주세요.'}/>
        <small className="muted small">{description.length}/5,000자</small>
      </label>
      <label className="field feedback-photos">사진 첨부 <span className="muted small">선택 · PNG, JPEG, WebP · 최대 3장, 장당 1MB</span>
        <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => selectPhotos(event.currentTarget.files)}/>
      </label>
      {photos.length > 0 && <ul className="feedback-photo-list" aria-label="첨부한 사진">{photos.map((photo, index) => <li key={`${photo.name}:${photo.lastModified}`}><span>{photo.name} <small>{(photo.size / 1024).toFixed(0)}KB</small></span><button type="button" className="link" onClick={() => setPhotos(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${photo.name} 첨부 제거`}>제거</button></li>)}</ul>}
      <div className="feedback-submit-row"><small className="muted">첨부 사진은 이메일 전송에 사용하며 앱에 저장하지 않습니다. {photos.length ? `총 ${(photoSize / 1024).toFixed(0)}KB` : ''}</small><button className="btn btn-primary" type="submit" disabled={submitting || !configured}>{submitting ? '전송 중…' : '피드백 보내기'}</button></div>
    </form>
  </>
}
