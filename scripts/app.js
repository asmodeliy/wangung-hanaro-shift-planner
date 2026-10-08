import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
// Prefer the installed system runtime so npm start and npm run app share one SQLite ABI.
const systemNode = process.platform === 'win32' ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe') : null
const lts = process.platform === 'win32' && process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'NodeLTS', 'node-v24.21.0-win-x64', 'node.exe') : null
const runtime = systemNode && existsSync(systemNode) ? systemNode : lts && existsSync(lts) ? lts : process.execPath
process.env.PATH = path.dirname(runtime) + path.delimiter + process.env.PATH
function run(args) {
  const result = spawnSync(runtime, args, { cwd: root, stdio: 'inherit' })
  if (result.error) { console.error(result.error.message); process.exit(1) }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
if (!existsSync(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'))) {
  console.log('처음 실행: 필요한 패키지를 설치합니다.')
  const npmCli = path.join(path.dirname(runtime), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!existsSync(npmCli)) { console.error('먼저 npm install을 실행해 주세요.'); process.exit(1) }
  run([npmCli, 'ci'])
}
const nativeCheck = spawnSync(runtime, ['--input-type=module', '-e', 'import Database from "better-sqlite3"; new Database(":memory:").close()'], { cwd: root, stdio: 'ignore' })
if (nativeCheck.status !== 0) {
  console.log('현재 Node 버전에 맞춰 데이터베이스 모듈을 준비합니다.')
  run([path.join(path.dirname(runtime), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'rebuild', 'better-sqlite3'])
}
console.log('근무표 화면을 빌드합니다.')
run(['node_modules/typescript/bin/tsc', '-b'])
run(['node_modules/vite/bin/vite.js', 'build'])
console.log('접속 주소: http://localhost:' + (process.env.PORT ?? '3001'))
console.log('종료하려면 Ctrl+C를 누르세요.')
const server = spawn(runtime, ['server/index.js'], { cwd: root, stdio: 'inherit', env: process.env })
server.on('error', error => { console.error(error.message); process.exitCode = 1 })
server.on('exit', code => { process.exitCode = code ?? 0 })
process.on('SIGINT', () => server.kill('SIGINT'))
process.on('SIGTERM', () => server.kill('SIGTERM'))
