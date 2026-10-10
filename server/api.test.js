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
test('full-day manual assignments are accepted and returned without losing the full code', async () => {
  const date = '2026-10-20'
  const saved = await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'full' })
  assert.equal(saved.status, 200)
  const rows = await call('/api/shifts?month=2026-10')
  assert.ok(rows.data.some(row => row.employeeId === 1 && row.date === date && row.code === 'full'))
})
test('past dates are frozen unless the manager explicitly allows them in settings', async () => {
  const date = '2026-01-07'
  const blocked = await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'off' })
  assert.equal(blocked.status, 409)
  const settings = (await call('/api/settings')).data
  assert.equal((await call('/api/settings', 'PUT', { ...settings, editablePastShiftDates: [date] })).status, 200)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'off' })).status, 200)
  assert.ok((await call('/api/shifts?month=2026-01')).data.some(row => row.employeeId === 1 && row.date === date && row.code === 'off'))
  assert.equal((await call('/api/settings', 'PUT', { ...settings, editablePastShiftDates: [] })).status, 200)
})
test('history restore brings back earlier shifts but never rewrites frozen past dates', async () => {
  const month = '2026-12'
  const date = '2026-12-14'
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'open' })).status, 200)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'close' })).status, 200)
  const history = (await call(`/api/shifts/history?month=${month}`)).data
  const before = history.find(item => item.action.includes(date))
  assert.ok(before, 'edit should be recorded in history')
  const oldest = history.at(-1)
  assert.equal((await call(`/api/shifts/history/${oldest.id}/restore`, 'POST')).status, 200)
  const rows = (await call(`/api/shifts?month=${month}`)).data
  assert.ok(!rows.some(row => row.employeeId === 1 && row.date === date), 'restoring the oldest snapshot clears the cell')
  assert.ok((await call(`/api/shifts/history?month=${month}`)).data.some(item => item.action.startsWith('복원 전 상태')), 'restore itself is recorded')
})
test('history restore keeps frozen past dates untouched', async () => {
  const month = '2026-01'
  const date = '2026-01-12'
  const settings = (await call('/api/settings')).data
  await call('/api/settings', 'PUT', { ...settings, editablePastShiftDates: [date] })
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 1, date, code: 'open' })).status, 200)
  await call('/api/settings', 'PUT', { ...settings, editablePastShiftDates: [] })
  const target = (await call(`/api/shifts/history?month=${month}`)).data.at(-1)
  const result = await call(`/api/shifts/history/${target.id}/restore`, 'POST')
  assert.equal(result.status, 200)
  assert.ok(result.data.keptPastDates >= 1)
  assert.ok((await call(`/api/shifts?month=${month}`)).data.some(row => row.employeeId === 1 && row.date === date && row.code === 'open'))
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
test('manager can change a named employee employment type and produce assignment', async () => {
  const update = await call('/api/employees/1', 'PUT', {
    name: '진해경', employmentType: '계약직', dutyType: 'other', produceQualified: true,
    active: true, notes: '수정 확인', workRules: { allowedShifts: ['open', 'close'], offRules: [] },
  })
  assert.equal(update.status, 200)
  assert.equal(update.data.employmentType, '계약직')
  assert.equal(update.data.produceQualified, true)
  assert.equal((await call('/api/employees')).data.find(employee => employee.id === 1).employmentType, '계약직')
})
test('manager can designate and persist an agricultural backup opener', async () => {
  const created = await call('/api/employees', 'POST', { name: '농산 대직 테스트', employmentType: '정규직', produceBackup: true })
  assert.equal(created.status, 201)
  assert.equal(created.data.produceBackup, true)
  const updated = await call(`/api/employees/${created.data.id}`, 'PUT', { name: '농산 대직 테스트', employmentType: '정규직', dutyType: 'functional', produceBackup: true, active: true, notes: '' })
  assert.equal(updated.data.produceBackup, true)
  assert.equal((await call('/api/employees')).data.find(employee => employee.id === created.data.id).produceBackup, true)
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: created.data.id, date: '2026-12-05', code: 'open' })).status, 200)
  await call(`/api/users/employee/${created.data.id}`, 'PUT', { username: 'producebackup', password: 'backup-worker-test-pass' })
  const adminCookie = cookie
  const login = await call('/api/auth/login', 'POST', { username: 'producebackup', password: 'backup-worker-test-pass' }, false)
  assert.equal(login.status, 200)
  cookie = login.cookie
  const shifts = await call('/api/shifts?month=2026-12')
  const opener = shifts.data.find(shift => shift.employeeId === created.data.id && shift.date === '2026-12-05')
  assert.equal(opener.start, '08:00')
  assert.equal(opener.end, '17:00')
  cookie = adminCookie
})
test('partial saved shift-time settings are safely filled with defaults', async () => {
  const original = (await call('/api/settings')).data
  assert.equal((await call('/api/settings', 'PUT', { ...original, shiftTimes: {} })).status, 200)
  const settings = (await call('/api/settings')).data
  assert.deepEqual(settings.shiftTimes, {
    open: { regular: { start: '08:00', end: '17:00' }, contract: { start: '08:30', end: '17:30' } },
    close: { regular: { start: '11:00', end: '20:00' }, contract: { start: '11:00', end: '20:00' } },
    produceOpen: { start: '08:00', end: '17:00' },
  })
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

test('excel export creates one landscape sheet per selected month and rejects bad input', async () => {
  const { default: ExcelJS } = await import('exceljs')
  assert.equal((await call('/api/shifts', 'PUT', { employeeId: 1, date: '2026-12-21', code: 'open' })).status, 200)
  const months = (await call('/api/export/months')).data
  assert.ok(months.includes('2026-12'))
  const response = await fetch(`${baseUrl}/api/export/schedule.xlsx?months=2026-12,2027-01`, { headers: { Cookie: cookie } })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /spreadsheetml/)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()))
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['2026년 12월', '2027년 1월'])
  assert.equal(workbook.worksheets[0].pageSetup.orientation, 'landscape')
  assert.equal(workbook.worksheets[0].getCell(5, 23).value, '오')
  assert.equal((await call('/api/export/schedule.xlsx?months=2026-13')).status, 400)
  assert.equal((await call('/api/export/schedule.xlsx')).status, 400)
})

test('pdf export is a real landscape A4 page for both table and calendar layouts', async () => {
  for (const layout of ['table', 'calendar']) {
    const response = await fetch(`${baseUrl}/api/export/schedule.pdf?layout=${layout}&months=2026-12,2027-01`, { headers: { Cookie: cookie } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/pdf')
    const text = Buffer.from(await response.arrayBuffer()).toString('latin1')
    assert.ok(text.startsWith('%PDF'))
    const boxes = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(match => [Number(match[1]), Number(match[2])])
    assert.equal(boxes.length, 2, 'one page per month')
    for (const [width, height] of boxes) assert.ok(width > height, 'page is landscape')
    assert.ok(!/\/Rotate/.test(text), 'content is never rotated')
  }
  assert.equal((await fetch(`${baseUrl}/api/export/schedule.pdf?months=bad`, { headers: { Cookie: cookie } })).status, 400)
})
