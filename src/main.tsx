import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class RenderErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('화면을 표시하지 못했습니다.', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <main className="render-error"><h1>화면을 표시하지 못했습니다</h1><p>오류 기록을 확인한 뒤 다시 불러와 주세요.</p><pre>{this.state.error.message}</pre><button onClick={() => window.location.reload()}>다시 불러오기</button></main>
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RenderErrorBoundary><App /></RenderErrorBoundary>
  </StrictMode>,
)
