const { app, BrowserWindow, dialog } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')

const root = app.getAppPath()
const port = process.env.PORT ?? '3001'
let origin
let server
let quitting = false

function startServer() {
  const runtime = process.env.HANARO_NODE_EXECUTABLE
  if (!runtime) throw new Error('Node.js 실행 경로를 찾을 수 없습니다. npm run app으로 다시 실행해 주세요.')

  return new Promise((resolve, reject) => {
    let ready = false
    const timeout = setTimeout(() => {
      server.kill()
      reject(new Error('근무표 서버 시작 시간이 초과되었습니다.'))
    }, 20000)
    server = spawn(runtime, ['server/index.js'], {
      cwd: root,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, PORT: String(port) },
    })
    server.on('message', message => {
      if (!ready && message?.type === 'ready' && Number.isInteger(message.port)) {
        ready = true
        clearTimeout(timeout)
        resolve(message.port)
      }
    })
    server.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    server.once('exit', code => {
      if (!ready) {
        clearTimeout(timeout)
        reject(new Error(`근무표 서버가 시작되기 전에 종료되었습니다. 종료 코드: ${code ?? '알 수 없음'}`))
      } else if (!quitting) {
        dialog.showErrorBox('서버 종료', '근무표 서버가 예기치 않게 종료되었습니다.')
        app.quit()
      }
    })
  })
}

async function waitForServer() {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`근무표 서버가 ${origin} 에서 응답하지 않습니다.`)
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: '왕궁농협 하나로마트 근무표',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${origin}/`)) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  return window.loadURL(origin)
}

app.whenReady().then(async () => {
  try {
    const actualPort = await startServer()
    origin = `http://127.0.0.1:${actualPort}`
    await waitForServer()
    await createWindow()
  } catch (error) {
    dialog.showErrorBox('앱 실행 오류', error.message)
    app.quit()
  }
})

app.on('before-quit', () => {
  quitting = true
  if (server && server.exitCode === null) server.kill()
})

app.on('window-all-closed', () => app.quit())
