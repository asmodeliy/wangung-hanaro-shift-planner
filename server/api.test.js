import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

let child, folder, baseUrl, cookie
const systemNode = process.platform === 'win32' ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe') : process.execPath
async function call(url, method = 'GET', body, auth = true) {
  const response = await fetch(baseUrl + url, { method, headers: { 'Content-Type': 'application/json', ...(auth && cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.getSetCookie().at(-1)?.split(';')[0] }
}
before(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'shift-planner-api-test-'))
  child = spawn(existsSync(systemNode) ? systemNode : process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: folder, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server did not start')), 30000)
    child.stdout.on('data', buffer => { const match = buffer.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { baseUrl = `http://127.0.0.1:${match[1]}`; clearTimeout(timer); resolve() } })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited: ${code}`)) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
  })
  const result = await call('/api/auth/setup', 'POST', { username: 'testadmin', password: 'test-password-only-2026' }, false)
  assert.equal(result.status, 201)
  cookie = result.cookie
})
after(async () => {
  if (child?.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
  if (folder?.startsWith(path.join(os.tmpdir(), 'shift-planner-api-test-'))) await rm(folder, { recursive: true, force: true })
})
test('invalid calendar dates return 400', async () => {
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 1, date: '2026-02-30', code: 'off' })).status, 400)
  assert.equal((await call('/api/requests', 'POST', { employeeId: 1, dates: ['2026-02-30'] })).status, 400)
})
test('holiday endpoint includes stored custom holidays', async () => {
  const settings = (await call('/api/settings')).data
  assert.equal((await call('/api/settings', 'PUT', { ...settings, additionalHolidays: ['2026-12-31'] })).status, 200)
  const response = await call('/api/holidays?year=2026')
  assert.equal(response.status, 200)
  assert.ok(response.data.some(holiday => holiday.date === '2026-12-31' && holiday.name === '추가 공휴일'))
})
test('manual assignments below three workers are saved and reported as a validation issue', async () => {
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'open' })).status, 200)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 2, date, code: 'close' })).status, 200)
  for (const employeeId of [3, 4, 5, 6]) assert.equal((await call('/api/shifts', 'PUT', { employeeId, date, code: 'off' })).status, 200)
  const saved = await call('/api/shifts', 'PUT', { employeeId: 7, date, code: 'off' })
  assert.equal(saved.status, 200)
  const validation = await call(`/api/shifts/validation?month=${date.slice(0, 7)}`)
  assert.ok(validation.data.issues.some(issue => issue.date === date && issue.text.startsWith(`${date} 최소 근무인원 미충족 (`)))
})
test('settings cannot mark an invalid schedule confirmed', async () => {
  await call('/api/settings', 'PUT', { confirmedMonths: ['2026-10'] })
  const settings = await call('/api/settings')
  assert.deepEqual(settings.data.confirmedMonths, [])
  assert.equal((await call('/api/shifts/confirm', 'POST', { month: '2026-10' })).status, 409)
})
test('manager can save date-level produce open exceptions', async () => {
  const settings = (await call('/api/settings')).data
  const date = '2026-11-19'
  assert.equal((await call('/api/settings', 'PUT', { ...settings, produceOpenExceptions: [date] })).status, 200)
  assert.ok((await call('/api/settings')).data.produceOpenExceptions.includes(date))
  assert.equal((await call('/api/settings', 'PUT', { ...settings, produceOpenExceptions: ['2026-11-31'] })).status, 400)
})
test('generation with fewer than three active staff preserves existing assignments', async () => {
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'open' })
  for (const employeeId of [3, 4, 5, 6, 7]) await call(`/api/employees/${employeeId}`, 'PUT', { name: `직원${employeeId}`, employmentType: '계약직', active: false, notes: '' })
  const beforeRows = (await call('/api/shifts?month=2026-10')).data
  const result = await call('/api/shifts/generate', 'POST', { month: '2026-10', mode: 'replace' })
  assert.equal(result.status, 422)
  assert.deepEqual((await call('/api/shifts?month=2026-10')).data, beforeRows)
  for (const employeeId of [3, 4, 5, 6, 7]) await call(`/api/employees/${employeeId}`, 'PUT', { name: `직원${employeeId}`, employmentType: '계약직', active: true, notes: '' })
})
test('locking existing shifts protects filled cells while allowing blank cells to be assigned', async () => {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(Date.now() + 7 * 86400000)
  const month = date.slice(0, 7)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'open' })).status, 200)
  const locked = await call('/api/shifts/lock-existing', 'POST', { month })
  assert.equal(locked.status, 200)
  assert.ok(locked.data.locked >= 1)
  const rows = (await call(`/api/shifts?month=${month}`)).data
  assert.ok(rows.find(row => row.employeeId === 1 && row.date === date).locked)
  const protectedEdit = await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'close' })
  assert.equal(protectedEdit.status, 409)
  assert.match(protectedEdit.data.error, /확정되어 수정할 수 없습니다/)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 2, date, code: 'close' })).status, 200)
  assert.equal((await call('/api/shifts/generate', 'POST', { month, mode: 'replace' })).status, 409)
})
test('manager can pin one manually selected shift cell for alternative generation', async () => {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(Date.now() + 35 * 86400000)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'off' })).status, 200)
  assert.equal((await call('/api/shifts/lock-cell', 'POST', { employeeId: 1, date, locked: true })).status, 200)
  let rows = await call(`/api/shifts?month=${date.slice(0, 7)}`)
  assert.equal(rows.data.find(row => row.employeeId === 1 && row.date === date).locked, true)
  assert.equal((await call('/api/shifts/lock-cell', 'POST', { employeeId: 1, date, locked: false })).status, 200)
  rows = await call(`/api/shifts?month=${date.slice(0, 7)}`)
  assert.equal(rows.data.find(row => row.employeeId === 1 && row.date === date).locked, false)
})
test('manager can select employment type staffing and invalid split floors are rejected', async () => {
  const original = (await call('/api/settings')).data
  const operations = {
    ...original.operations, staffingMode: 'employmentType',
    weekdayRegularTarget: 2, weekdayRegularMinimum: 1, weekdayContractTarget: 3, weekdayContractMinimum: 2,
    weekendRegularTarget: 2, weekendRegularMinimum: 1, weekendContractTarget: 2, weekendContractMinimum: 1,
  }
  assert.equal((await call('/api/settings', 'PUT', { ...original, operations })).status, 200)
  assert.equal((await call('/api/settings')).data.operations.staffingMode, 'employmentType')
  assert.equal((await call('/api/settings', 'PUT', { ...original, operations: { ...operations, weekdayContractMinimum: 4 } })).status, 400)
  assert.equal((await call('/api/settings', 'PUT', original)).status, 200)
})
test('employees cannot change settings and API omits private employment rules', async () => {
  await call('/api/users/employee/1', 'PUT', { username: 'testemployee', password: 'test-password-only-employee' })
  const adminCookie = cookie
  const login = await call('/api/auth/login', 'POST', { username: 'testemployee', password: 'test-password-only-employee' }, false)
  assert.equal(login.status, 200)
  cookie = login.cookie
  assert.equal((await call('/api/settings', 'PUT', { confirmedMonths: ['2026-10'] })).status, 403)
  assert.equal((await call('/api/shifts/confirm', 'POST', { month: '2026-10' })).status, 403)
  const rows = (await call('/api/employees')).data
  assert.ok(rows.every(e => !('employmentType' in e) && !('workRules' in e)))
  cookie = adminCookie
})
