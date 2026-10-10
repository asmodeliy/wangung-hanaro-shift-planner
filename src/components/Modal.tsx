import { useEffect, useId, type FormEvent, type ReactNode } from 'react'

type Props = {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  onSubmit?: (event: FormEvent) => void
}

/** Accessible dialog shell: backdrop click and Escape close it, content scrolls while header and footer stay put. */
export function Modal({ title, description, onClose, children, footer, size = 'md', onSubmit }: Props) {
  const titleId = useId()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const Shell = onSubmit ? 'form' : 'div'
  return <div className="backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <Shell className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} {...(onSubmit ? { onSubmit } : {})}>
      <header className="modal-head">
        <div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">×</button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </Shell>
  </div>
}
