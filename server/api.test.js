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
    const timer = setTimeout(() => reject(new Error('Test server did not start')), 10000)
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
test('admins can approve selected pending leave requests in one atomic batch', async () => {
  const created = await call('/api/requests', 'POST', { employeeId: 1, dates: ['2026-12-03', '2026-12-04'] })
  assert.equal(created.status, 201)
  const requests = (await call('/api/requests?month=2026-12')).data
  const ids = requests.map(item => item.id)
  assert.equal(ids.length, 2)
  const approved = await call('/api/requests/bulk', 'PATCH', { ids, status: 'approved' })
  assert.equal(approved.status, 200)
  assert.equal(approved.data.approved, 2)
  assert.ok((await call('/api/requests?month=2026-12')).data.every(item => item.status === 'approved'))
  assert.equal((await call('/api/requests/bulk', 'PATCH', { ids, status: 'approved' })).status, 409)
  assert.equal((await call('/api/requests/bulk', 'PATCH', { ids: [], status: 'approved' })).status, 400)
  assert.equal((await call('/api/requests', 'POST', { employeeId: 1, dates: ['2026-12-03', '2026-12-04'] })).status, 201)
  const rejected = await call('/api/requests/bulk', 'PATCH', { ids, status: 'rejected' })
  assert.equal(rejected.status, 200)
  assert.equal(rejected.data.rejected, 2)
  assert.deepEqual((await call('/api/requests?month=2026-12')).data, [])
  await call('/api/requests', 'POST', { employeeId: 1, dates: ['2026-12-05'] })
  const singleRequest = (await call('/api/requests?month=2026-12')).data[0]
  assert.equal((await call(`/api/requests/${singleRequest.id}`, 'DELETE')).status, 204)
  assert.deepEqual((await call('/api/requests?month=2026-12')).data, [])
})
test('employee records save agricultural role and agricultural open hours override employment defaults', async () => {
  const created = await call('/api/employees', 'POST', { name: '농산 담당', employmentType: '계약직', isAgricultural: true })
  assert.equal(created.status, 201)
  assert.equal(created.data.isAgricultural, true)
  const backup = await call('/api/employees', 'POST', { name: '농산 대직', employmentType: '정규직', isAgriculturalBackup: true })
  assert.equal(backup.data.isAgriculturalBackup, true)
  const backupUpdated = await call(`/api/employees/${backup.data.id}`, 'PUT', { name: '농산 대직', employmentType: '정규직', isAgriculturalBackup: true, active: true, notes: '' })
  assert.equal(backupUpdated.data.isAgriculturalBackup, true)
  const updated = await call(`/api/employees/${created.data.id}`, 'PUT', { name: '농산 담당', employmentType: '계약직', isAgricultural: true, active: true, notes: '' })
  assert.equal(updated.data.isAgricultural, true)
  assert.ok((await call('/api/employees')).data.find(employee => employee.id === created.data.id).isAgricultural)
  assert.ok((await call('/api/employees')).data.find(employee => employee.id === backup.data.id).isAgriculturalBackup)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: created.data.id, date: '2026-12-03', code: 'open' })).status, 200)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: created.data.id, date: '2026-12-04', code: 'full' })).status, 200)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: backup.data.id, date: '2026-12-05', code: 'open' })).status, 200)
  assert.equal((await call('/api/users/employee/' + created.data.id, 'PUT', { username: 'farmworker', password: 'farm-worker-test-pass' })).status, 200)
  const adminCookie = cookie
  const login = await call('/api/auth/login', 'POST', { username: 'farmworker', password: 'farm-worker-test-pass' }, false)
  assert.equal(login.status, 200)
  cookie = login.cookie
  const shifts = await call('/api/shifts?month=2026-12')
  assert.deepEqual(shifts.data.find(shift => shift.employeeId === created.data.id).start, '08:00')
  assert.deepEqual(shifts.data.find(shift => shift.employeeId === created.data.id).end, '17:00')
  const fullShift = shifts.data.find(shift => shift.employeeId === created.data.id && shift.date === '2026-12-04')
  assert.equal(fullShift.code, 'full')
  assert.deepEqual(fullShift.start, '08:00')
  assert.deepEqual(fullShift.end, '20:00')
  const backupShift = shifts.data.find(shift => shift.employeeId === backup.data.id && shift.date === '2026-12-05')
  assert.deepEqual(backupShift.start, '08:00')
  assert.deepEqual(backupShift.end, '17:00')
  cookie = adminCookie
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
