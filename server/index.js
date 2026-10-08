import Holidays from 'date-holidays'
import express from 'express'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import postgres, { initializePostgres } from './postgres.js'
import { defaultRules, defaultOperationRules, normalizeRules, validDate, monthDates, weekDates, restTarget, validateSchedule, seoulDateKey } from './planner.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const isHosted = process.env.VERCEL === '1'
const Database = isHosted ? null : (await import('better-sqlite3')).default
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : isHosted ? path.join('/tmp', 'hanaro-data') : path.join(root, 'data')
mkdirSync(dataDir, { recursive: true })
const databasePath = path.join(dataDir, 'shift-planner.sqlite')
const seedDatabasePath = process.env.SEED_DATABASE_PATH ? path.resolve(root, process.env.SEED_DATABASE_PATH) : ''
if (!isHosted && !existsSync(databasePath) && seedDatabasePath && existsSync(seedDatabasePath)) copyFileSync(seedDatabasePath, databasePath)
const db = isHosted ? postgres : new Database(databasePath)
if (!isHosted) {
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    employment_type TEXT NOT NULL DEFAULT '정규직',
    duty_type TEXT NOT NULL DEFAULT 'support',
    produce_qualified INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS shifts (
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_date TEXT NOT NULL,
    code TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(employee_id, shift_date)
  );
  CREATE TABLE IF NOT EXISTS shift_locks (
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_date TEXT NOT NULL,
    code TEXT NOT NULL,
    PRIMARY KEY(employee_id, shift_date)
  );
  CREATE TABLE IF NOT EXISTS locked_months (
    month TEXT PRIMARY KEY,
    locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    request_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, request_date)
  );
  CREATE TABLE IF NOT EXISTS app_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'employee')),
    employee_id INTEGER UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`)
}
if (isHosted) await initializePostgres()

const defaultSettings = {
  shiftTimes: {
    open: { regular: { start: '08:00', end: '17:00' }, contract: { start: '08:30', end: '17:30' } },
    close: { regular: { start: '11:00', end: '20:00' }, contract: { start: '11:00', end: '20:00' } },
  },
  daysOffPairs: [], additionalHolidays: [], produceOpenExceptions: [], confirmedMonths: [], weeklyRestPolicy: 'minimum', operations: { ...defaultOperationRules },
}
const rosterProfiles = new Map([
  ['진해경', { employmentType: '정규직', dutyType: 'functional', produceQualified: 0 }],
  ['이화진', { employmentType: '정규직', dutyType: 'functional', produceQualified: 0 }],
  ['차용호', { employmentType: '정규직', dutyType: 'functional', produceQualified: 0 }],
  ['정지희', { employmentType: '계약직', dutyType: 'support', produceQualified: 0 }],
  ['김효섭', { employmentType: '계약직', dutyType: 'support', produceQualified: 0 }],
  ['최창섭', { employmentType: '계약직', dutyType: 'support', produceQualified: 0 }],
  ['김은주', { employmentType: '계약직', dutyType: 'support', produceQualified: 0 }],
])
function rosterProfile(name) { return rosterProfiles.get(String(name ?? '').trim()) }

if (!isHosted) {
const employeeCount = db.prepare('SELECT COUNT(*) AS n FROM employees').get().n
const employeeColumns = new Set(db.prepare('PRAGMA table_info(employees)').all().map(column => column.name))
if (!employeeColumns.has('work_rules')) db.exec("ALTER TABLE employees ADD COLUMN work_rules TEXT NOT NULL DEFAULT '{\"allowedShifts\":[\"open\",\"close\"],\"offRules\":[]}'")
if (!employeeColumns.has('duty_type')) db.exec("ALTER TABLE employees ADD COLUMN duty_type TEXT NOT NULL DEFAULT 'support'")
if (!employeeColumns.has('produce_qualified')) db.exec('ALTER TABLE employees ADD COLUMN produce_qualified INTEGER NOT NULL DEFAULT 0')
const updateKnownProfile = db.prepare('UPDATE employees SET employment_type = ?, duty_type = ?, produce_qualified = ? WHERE trim(name) = ? AND (employment_type != ? OR duty_type != ? OR produce_qualified != ?)')
let rosterProfileChanges = 0
db.transaction(() => { for (const [name, profile] of rosterProfiles) rosterProfileChanges += updateKnownProfile.run(profile.employmentType, profile.dutyType, profile.produceQualified, name, profile.employmentType, profile.dutyType, profile.produceQualified).changes })()
// Public demo seeds contain no personal employee information. Existing local data is preserved.
if (employeeCount === 0) {
  const seedPath = path.join(dataDir, 'initial-employees.json')
  const seed = existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, 'utf8').replace(/^\uFEFF/, '')) : Array.from({ length: 7 }, (_, index) => ({ name: `직원 ${String.fromCharCode(65 + index)}`, employmentType: '정규직' }))
  const insert = db.prepare('INSERT INTO employees (name, employment_type, duty_type, produce_qualified, work_rules, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
  db.transaction(() => seed.forEach((employee, index) => { const profile = rosterProfile(employee.name); insert.run(employee.name, profile?.employmentType ?? employee.employmentType, profile?.dutyType ?? (employee.dutyType === 'functional' ? 'functional' : employee.dutyType === 'other' ? 'other' : 'support'), profile?.produceQualified ?? (employee.produceQualified ? 1 : 0), JSON.stringify(normalizeRules(employee.workRules ?? defaultRules)), index) }))()
}

if (!db.prepare('SELECT 1 FROM app_settings WHERE setting_key = ?').get('main')) {
  const settings = structuredClone(defaultSettings)
  const seedPath = path.join(dataDir, 'initial-settings.json')
  if (existsSync(seedPath)) Object.assign(settings, JSON.parse(readFileSync(seedPath, 'utf8').replace(/^\uFEFF/, '')))
  db.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)').run('main', JSON.stringify(settings))
}
if (rosterProfileChanges > 0) {
  const row = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get('main')
  const settings = JSON.parse(row.setting_value)
  if (Array.isArray(settings.confirmedMonths) && settings.confirmedMonths.length) {
    settings.confirmedMonths = []
    db.prepare('UPDATE app_settings SET setting_value = ? WHERE setting_key = ?').run(JSON.stringify(settings), 'main')
  }
}
}
async function readSettings() {
  try {
    const row = await db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get('main')
    if (!row) return structuredClone(defaultSettings)
    const stored = JSON.parse(row.setting_value)
    const settings = { ...defaultSettings, ...stored, operations: { ...defaultOperationRules, ...(stored.operations ?? {}) } }
    if (!await db.prepare('SELECT 1 FROM employees WHERE active = 1 AND produce_qualified = 1 LIMIT 1').get()) settings.operations.produceOpenCount = 0
    settings.daysOffPairs = Array.isArray(settings.daysOffPairs) ? settings.daysOffPairs : []
    settings.produceOpenExceptions = Array.isArray(settings.produceOpenExceptions) ? settings.produceOpenExceptions.filter(validDate) : []
    const substituteIds = await Promise.all(['김효섭', '최창섭'].map(async name => (await db.prepare('SELECT id FROM employees WHERE trim(name) = ? AND active = 1 ORDER BY sort_order,id LIMIT 1').get(name))?.id))
    if (substituteIds.every(Number.isInteger) && !settings.daysOffPairs.some(pair => pair.employeeIds?.length === 2 && substituteIds.every(id => pair.employeeIds.includes(id)))) settings.daysOffPairs.push({ employeeIds: substituteIds })
    return settings
  }
  catch (error) {
    if (isHosted) throw error
    return structuredClone(defaultSettings)
  }
}
function shiftTimesForEmployee(name, employmentType, code, settings) {
  const type = code === 'open' && String(name ?? '').trim() === '정지희' ? 'regular' : employmentType === '계약직' ? 'contract' : 'regular'
  return settings.shiftTimes[code][type]
}
async function saveSettings(value) {
  await db.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value').run('main', JSON.stringify(value))
}
async function runTransaction(asyncWork, syncWork = asyncWork) {
  if (isHosted) return db.transaction(asyncWork)()
  return db.transaction(syncWork)()
}
async function invalidateConfirmed() { const settings = await readSettings(); settings.confirmedMonths = []; await saveSettings(settings) }
async function activeEmployees() {
  return (await db.prepare('SELECT id, name, employment_type AS employmentType, duty_type AS dutyType, produce_qualified AS produceQualified, active, notes, work_rules FROM employees WHERE active = 1 ORDER BY sort_order, id').all()).map(({ work_rules, produceQualified, ...employee }) => ({ ...employee, produceQualified: Boolean(produceQualified), workRules: JSON.parse(work_rules) }))
}
function holidaysFor(year, settings) {
  const holidays = new Holidays('KR').getHolidays(year).filter(item => item.type === 'public').map(item => ({ date: item.date.slice(0, 10), name: item.name }))
  const custom = settings.additionalHolidays.filter(date => date.startsWith(`${year}-`)).map(date => ({ date, name: '추가 공휴일' }))
  return [...new Map([...holidays, ...custom].map(item => [item.date, item])).values()].sort((a, b) => a.date.localeCompare(b.date))
}
async function planningInput(month) {
  const dates = monthDates(month)
  const [year, monthNumber] = month.split('-').map(Number)
  const previousMonthDate = new Date(Date.UTC(year, monthNumber - 2, 1))
  const previousMonth = `${previousMonthDate.getUTCFullYear()}-${String(previousMonthDate.getUTCMonth() + 1).padStart(2, '0')}`
  const shifts = await db.prepare(`SELECT s.employee_id AS employeeId, s.shift_date AS date, s.code,
    CASE WHEN l.employee_id IS NULL THEN 0 ELSE 1 END AS locked
    FROM shifts s LEFT JOIN shift_locks l ON l.employee_id = s.employee_id AND l.shift_date = s.shift_date
    WHERE s.shift_date >= ? AND s.shift_date <= ?`).all(`${previousMonth}-01`, weekDates(dates.at(-1))[6])
  const settings = await readSettings()
  return { month, employees: await activeEmployees(), settings, holidays: holidaysFor(Number(month.slice(0, 4)), settings), adjacentHolidays: holidaysFor(previousMonthDate.getUTCFullYear(), settings).filter(item => item.date.startsWith(`${previousMonth}-`)), existingShifts: shifts.filter(s => s.date.startsWith(month)), adjacentShifts: shifts.filter(s => !s.date.startsWith(month)), requests: await db.prepare("SELECT employee_id AS employeeId, request_date AS date, status FROM requests WHERE request_date >= ? AND request_date < ? AND status != 'rejected'").all(`${month}-01`, `${nextMonth(month)}-01`) }
}
async function photoIssues(month) {
  const data = await readDataJson('reference-import.json')
  if (!data) return []
  return data.month === month ? data.notes.filter(note => !note.resolved).map(note => ({ date: note.date, text: `사진 확인 필요: ${note.text}` })) : []
}
async function readDataJson(name) {
  if (isHosted) {
    const row = await db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(`file:${name}`)
    return row ? JSON.parse(row.setting_value) : null
  }
  const file = path.join(dataDir, name)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : null
}
async function writeDataJson(name, value) {
  const contents = JSON.stringify(value, null, 2)
  if (isHosted) {
    await db.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value').run(`file:${name}`, contents)
    return
  }
  writeFileSync(path.join(dataDir, name), contents, 'utf8')
}
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
function verifyPassword(password, stored) {
  try {
    const [salt, expected] = stored.split(':')
    const actual = scryptSync(password, salt, 64)
    const buffer = Buffer.from(expected, 'hex')
    return buffer.length === actual.length && timingSafeEqual(buffer, actual)
  } catch { return false }
}
function safeUser(user) {
  return { id: user.id, username: user.username, role: user.role, employeeId: user.employee_id ?? null, employeeName: user.employee_name ?? null }
}

const app = express()
let dataRevision = 0
async function currentDataRevision() {
  if (!isHosted) return dataRevision
  return Number((await db.prepare("SELECT meta_value FROM app_meta WHERE meta_key = 'data_revision'").get())?.meta_value ?? 0)
}
app.use('/api', (req, res, next) => {
  const pathname = req.originalUrl.split('?')[0]
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    && !pathname.startsWith('/api/auth/')
    && !pathname.startsWith('/api/users')
    && pathname !== '/api/shifts/options'
  if (mutating) {
    let revisionSaved = false
    const originalJson = res.json.bind(res)
    const originalEnd = res.end.bind(res)
    const sendAfterRevision = (send, args) => {
      if (!revisionSaved && res.statusCode < 400) {
        revisionSaved = true
        const bump = isHosted
          ? db.prepare("UPDATE app_meta SET meta_value = meta_value + 1 WHERE meta_key = 'data_revision'").run()
          : Promise.resolve(++dataRevision)
        Promise.resolve(bump).then(() => send(...args)).catch(error => {
          console.error('Could not update the schedule revision', error)
          if (!res.headersSent) { res.statusCode = 500; originalJson({ error: '변경 사항을 기록하지 못했습니다.' }) }
        })
        return res
      }
      return send(...args)
    }
    res.json = (...args) => sendAfterRevision(originalJson, args)
    res.end = (...args) => sendAfterRevision(originalEnd, args)
  }
  next()
})
app.disable('x-powered-by')
app.use(express.json({ limit: '100kb' }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Cache-Control', 'no-store')
  next()
})
const sessionSeconds = 60 * 60 * 24 * 14
const cookieName = 'hanaro_session'
async function createSession(user, res) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = Math.floor(Date.now() / 1000) + sessionSeconds
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), user.id, expiresAt)
  res.cookie(cookieName, token, { httpOnly: true, sameSite: 'strict', secure: isHosted || process.env.COOKIE_SECURE === 'true', maxAge: sessionSeconds * 1000, path: '/' })
}
async function clearSession(req, res) {
  const token = req.cookies?.[cookieName] ?? parseCookies(req.headers.cookie)[cookieName]
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(createHash('sha256').update(token).digest('hex'))
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', secure: isHosted || process.env.COOKIE_SECURE === 'true', path: '/' })
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]))
}
async function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[cookieName]
  if (token) {
    const digest = createHash('sha256').update(token).digest('hex')
    const user = await db.prepare(`SELECT u.id, u.username, u.role, u.employee_id, e.name AS employee_name
      FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN employees e ON e.id = u.employee_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND (u.role = 'admin' OR e.active = 1)`).get(digest, Math.floor(Date.now() / 1000))
    req.user = user ?? null
  }
  next()
}
app.use(loadUser)
const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: '로그인이 필요합니다.' })
const requireAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(req.user ? 403 : 401).json({ error: req.user ? '관리자 권한이 필요합니다.' : '로그인이 필요합니다.' })

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/auth/status', async (_req, res) => res.json({ setupNeeded: (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get()).n === 0, setupKeyRequired: isHosted }))
app.post('/api/auth/setup', async (req, res) => {
  if (await db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return res.status(409).json({ error: '관리자 계정이 이미 설정되어 있습니다. 로그인해 주세요.' })
  if (isHosted) {
    const expectedBytes = Buffer.from(String(process.env.INITIAL_ADMIN_SETUP_KEY ?? ''))
    const suppliedBytes = Buffer.from(String(req.body?.setupKey ?? ''))
    if (!expectedBytes.length || expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) return res.status(403).json({ error: '최초 관리자 설정 키를 확인해 주세요.' })
  } else {
    const address = String(req.socket.remoteAddress ?? '')
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return res.status(403).json({ error: '최초 관리자 계정은 서버 PC에서 설정해 주세요.' })
  }
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: '아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 3~32자 입력해 주세요.' })
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: '비밀번호는 10자 이상 입력해 주세요.' })
  const result = await db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hashPassword(password), 'admin')
  await createSession({ id: result.lastInsertRowid }, res)
  res.status(201).json({ user: { id: Number(result.lastInsertRowid), username, role: 'admin', employeeId: null, employeeName: null } })
})
app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  const user = await db.prepare(`SELECT u.id, u.username, u.password_hash, u.role, u.employee_id, e.name AS employee_name, e.active AS employee_active
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.username = ?`).get(username)
  if (!user || (user.role === 'employee' && !user.employee_active) || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: '아이디 또는 비밀번호를 확인해 주세요.' })
  await clearSession(req, res)
  await createSession(user, res)
  res.json({ user: safeUser(user) })
})
app.post('/api/auth/logout', async (req, res) => { await clearSession(req, res); res.status(204).end() })
app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: safeUser(req.user) }))
app.use('/api', (req, res, next) => ['/auth/status', '/auth/setup', '/auth/login', '/auth/logout', '/auth/me', '/health'].includes(req.path) ? next() : requireUser(req, res, next))
app.put('/api/auth/password', async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '')
  const newPassword = String(req.body?.newPassword ?? '')
  if (newPassword.length < 10 || newPassword.length > 128) return res.status(400).json({ error: '새 비밀번호는 10~128자로 입력해 주세요.' })
  const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id)
  if (!user || !verifyPassword(currentPassword, user.password_hash)) return res.status(400).json({ error: '현재 비밀번호를 확인해 주세요.' })
  const token = parseCookies(req.headers.cookie)[cookieName]
  const digest = createHash('sha256').update(token).digest('hex')
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id)
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, digest)
  res.json({ ok: true })
})

app.get('/api/employees', async (req, res) => {
  const rows = req.user.role === 'admin'
    ? (await db.prepare('SELECT id, name, employment_type AS employmentType, duty_type AS dutyType, produce_qualified AS produceQualified, active, notes, work_rules FROM employees ORDER BY sort_order, id').all()).map(({ work_rules, produceQualified, ...employee }) => ({ ...employee, produceQualified: Boolean(produceQualified), workRules: JSON.parse(work_rules) }))
    : await db.prepare('SELECT id, name, active FROM employees ORDER BY sort_order, id').all()
  res.json(rows)
})
app.get('/api/reference-schedule', requireAdmin, async (_req, res) => {
  if (isHosted) {
    const image = await db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get('file:reference-schedule.png')
    if (!image) return res.status(404).json({ error: '등록된 참고 이미지가 없습니다.' })
    return res.type('png').send(Buffer.from(image.setting_value, 'base64'))
  }
  const referencePath = path.join(dataDir, 'reference-schedule.png')
  if (!existsSync(referencePath)) return res.status(404).json({ error: '등록된 참고 이미지가 없습니다.' })
  res.type('png').sendFile(referencePath)
})
app.get('/api/reference-schedule/status', requireAdmin, async (_req, res) => {
  const image = isHosted ? await db.prepare('SELECT 1 FROM app_settings WHERE setting_key = ?').get('file:reference-schedule.png') : existsSync(path.join(dataDir, 'reference-schedule.png'))
  res.json({ available: Boolean(image) })
})
app.get('/api/reference-schedule/import', requireAdmin, async (_req, res) => {
  res.json(await readDataJson('reference-import.json'))
})
app.patch('/api/reference-schedule/import/:id', requireAdmin, async (req, res) => {
  const data = await readDataJson('reference-import.json')
  if (!data) return res.status(404).json({ error: '사진 반영 기록이 없습니다.' })
  const note = data.notes.find(note => note.id === Number(req.params.id))
  if (!note) return res.status(404).json({ error: '확인 항목이 없습니다.' })
  if (typeof req.body?.resolved !== 'boolean') return res.status(400).json({ error: '확인 상태를 확인해 주세요.' })
  note.resolved = req.body.resolved
  if (!note.resolved) await invalidateConfirmed()
  await writeDataJson('reference-import.json', data)
  res.json({ ok: true })
})
app.post('/api/employees', requireAdmin, async (req, res) => {
  const body = req.body ?? {}
  const name = String(body.name ?? '').trim()
  const profile = rosterProfile(name)
  const employmentType = profile?.employmentType ?? body.employmentType ?? '정규직'
  const dutyType = profile?.dutyType ?? body.dutyType ?? (employmentType === '정규직' ? 'functional' : 'support')
  const produceQualified = profile ? Boolean(profile.produceQualified) : body.produceQualified ?? false
  const { active = true, notes = '', workRules = defaultRules } = body
  if (!name) return res.status(400).json({ error: '직원명을 입력해 주세요.' })
  if (!['정규직', '계약직'].includes(employmentType)) return res.status(400).json({ error: '직원 정보를 확인해 주세요.' })
  if (!['functional', 'support', 'other'].includes(dutyType) || typeof produceQualified !== 'boolean') return res.status(400).json({ error: '운영 직무와 농산 담당 여부를 확인해 주세요.' })
  let rules
  try { rules = normalizeRules(workRules) } catch (error) { return res.status(400).json({ error: error.message }) }
  const result = await db.prepare(`INSERT INTO employees (name, employment_type, duty_type, produce_qualified, active, notes, work_rules, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM employees))`).run(String(name).trim(), employmentType, dutyType, produceQualified ? 1 : 0, active ? 1 : 0, String(notes).trim(), JSON.stringify(rules))
  await invalidateConfirmed()
  res.status(201).json({ id: Number(result.lastInsertRowid), name, employmentType, dutyType, produceQualified, active, notes, workRules: rules })
})
app.put('/api/employees/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  const { name, employmentType, active, notes } = req.body ?? {}
  if (!Number.isInteger(id) || !String(name ?? '').trim() || !['정규직', '계약직'].includes(employmentType)) return res.status(400).json({ error: '직원 정보를 확인해 주세요.' })
  const existing = await db.prepare('SELECT work_rules, duty_type, produce_qualified FROM employees WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' })
  const profile = rosterProfile(name)
  const dutyType = profile?.dutyType ?? req.body.dutyType ?? (employmentType === '정규직' ? 'functional' : 'support')
  const produceQualified = profile ? Boolean(profile.produceQualified) : req.body.produceQualified ?? false
  if (!['functional', 'support', 'other'].includes(dutyType) || typeof produceQualified !== 'boolean') return res.status(400).json({ error: '운영 직무와 농산 담당 여부를 확인해 주세요.' })
  let rules
  try { rules = normalizeRules(req.body.workRules ?? JSON.parse(existing.work_rules)) } catch (error) { return res.status(400).json({ error: error.message }) }
  const result = await db.prepare('UPDATE employees SET name = ?, employment_type = ?, duty_type = ?, produce_qualified = ?, active = ?, notes = ?, work_rules = ? WHERE id = ?').run(String(name).trim(), employmentType, dutyType, produceQualified ? 1 : 0, active ? 1 : 0, String(notes ?? '').trim(), JSON.stringify(rules), id)
  if (!result.changes) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' })
  await invalidateConfirmed()
  res.json({ id, name, employmentType, dutyType, produceQualified, active, notes, workRules: rules })
})
app.delete('/api/employees/:id', requireAdmin, async (req, res) => {
  const result = await db.prepare('DELETE FROM employees WHERE id = ?').run(Number(req.params.id))
  if (!result.changes) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' })
  await invalidateConfirmed()
  res.status(204).end()
})

app.get('/api/users', requireAdmin, async (_req, res) => res.json(await db.prepare(`SELECT u.id, u.username, u.role, u.employee_id AS employeeId, e.name AS employeeName
  FROM users u LEFT JOIN employees e ON e.id = u.employee_id ORDER BY u.role, e.sort_order, u.username`).all()))
app.post('/api/users/admin', requireAdmin, async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  if ((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get()).n >= 2) return res.status(409).json({ error: '관리자 계정은 최대 2개까지 만들 수 있습니다.' })
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: '아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 3~32자 입력해 주세요.' })
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: '비밀번호는 10~128자로 입력해 주세요.' })
  try {
    const result = await db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hashPassword(password), 'admin')
    res.status(201).json({ id: Number(result.lastInsertRowid), username, role: 'admin', employeeId: null, employeeName: null })
  } catch (error) {
    if (String(error?.code).includes('CONSTRAINT') || error?.code === '23505') return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' })
    throw error
  }
})
app.put('/api/users/admin/:id/password', requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  const password = String(req.body?.password ?? '')
  if (!Number.isInteger(id) || id === req.user.id) return res.status(400).json({ error: '다른 관리자 계정을 선택해 주세요.' })
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: '비밀번호는 10~128자로 입력해 주세요.' })
  const result = await db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND role = 'admin'").run(hashPassword(password), id)
  if (!result.changes) return res.status(404).json({ error: '관리자 계정을 찾을 수 없습니다.' })
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  res.json({ ok: true })
})
app.delete('/api/users/admin/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: '관리자 계정을 확인해 주세요.' })
  if (id === req.user.id) return res.status(409).json({ error: '현재 로그인한 관리자 계정은 여기서 삭제할 수 없습니다.' })
  if ((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get()).n <= 1) return res.status(409).json({ error: '관리자 계정은 최소 한 개 이상 유지해야 합니다.' })
  const result = await db.prepare("DELETE FROM users WHERE id = ? AND role = 'admin'").run(id)
  if (!result.changes) return res.status(404).json({ error: '관리자 계정을 찾을 수 없습니다.' })
  res.status(204).end()
})
app.put('/api/users/employee/:employeeId', requireAdmin, async (req, res) => {
  const employeeId = Number(req.params.employeeId)
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  if (!await db.prepare('SELECT 1 FROM employees WHERE id = ?').get(employeeId)) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' })
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: '아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 3~32자 입력해 주세요.' })
  if (password && password.length < 10) return res.status(400).json({ error: '새 비밀번호는 10자 이상 입력해 주세요.' })
  const existing = await db.prepare('SELECT id FROM users WHERE employee_id = ?').get(employeeId)
  try {
    if (existing) {
      await db.prepare(`UPDATE users SET username = ?, password_hash = CASE WHEN ? = '' THEN password_hash ELSE ? END WHERE employee_id = ?`)
        .run(username, password, password ? hashPassword(password) : '', employeeId)
    } else {
      if (!password) return res.status(400).json({ error: '처음 계정을 만들 때는 비밀번호가 필요합니다.' })
      await db.prepare('INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)').run(username, hashPassword(password), 'employee', employeeId)
    }
  } catch (error) {
    if (String(error?.code).includes('CONSTRAINT') || error?.code === '23505') return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' })
    throw error
  }
  res.json({ ok: true })
})
app.delete('/api/users/employee/:employeeId', requireAdmin, async (req, res) => {
  await db.prepare("DELETE FROM users WHERE employee_id = ? AND role = 'employee'").run(Number(req.params.employeeId))
  res.status(204).end()
})

app.get('/api/settings', requireAdmin, async (_req, res) => res.json(await readSettings()))
app.put('/api/settings', requireAdmin, async (req, res) => {
  const incoming = req.body ?? {}
  const settings = await readSettings()
  if (incoming.shiftTimes) {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
    for (const shift of ['open', 'close']) for (const type of ['regular', 'contract']) {
      const time = incoming.shiftTimes?.[shift]?.[type]
      if (!timePattern.test(String(time?.start ?? '')) || !timePattern.test(String(time?.end ?? ''))) return res.status(400).json({ error: '근무시간을 확인해 주세요.' })
    }
    settings.shiftTimes = incoming.shiftTimes
  }
  if (Array.isArray(incoming.daysOffPairs)) {
    const ids = new Set((await db.prepare('SELECT id FROM employees').all()).map(row => row.id))
    settings.daysOffPairs = incoming.daysOffPairs.filter(pair => Array.isArray(pair.employeeIds) && pair.employeeIds.length === 2 && pair.employeeIds.every(id => ids.has(Number(id))) && Number(pair.employeeIds[0]) !== Number(pair.employeeIds[1])).map(pair => ({ employeeIds: pair.employeeIds.map(Number) }))
  }
  if (Array.isArray(incoming.additionalHolidays)) {
    if (incoming.additionalHolidays.some(date => typeof date !== 'string' || !validDate(date))) return res.status(400).json({ error: '실제로 존재하는 공휴일 날짜를 입력해 주세요.' })
    settings.additionalHolidays = [...new Set(incoming.additionalHolidays)].sort()
  }
  if (Array.isArray(incoming.produceOpenExceptions)) {
    if (incoming.produceOpenExceptions.some(date => typeof date !== 'string' || !validDate(date))) return res.status(400).json({ error: '농산 오픈 예외 날짜를 확인해 주세요.' })
    settings.produceOpenExceptions = [...new Set(incoming.produceOpenExceptions)].sort()
  }
  if (incoming.weeklyRestPolicy && !['minimum', 'exact'].includes(incoming.weeklyRestPolicy)) return res.status(400).json({ error: '주간 휴무 기준을 확인해 주세요.' })
  if (incoming.weeklyRestPolicy) settings.weeklyRestPolicy = incoming.weeklyRestPolicy
  if (incoming.operations !== undefined) {
    const operations = { ...settings.operations, ...(incoming.operations ?? {}) }
    const ranges = {
      weekdayTarget: [1, 20], weekendTarget: [1, 20], weekdayMinimum: [1, 20], weekendMinimum: [1, 20],
      weekdayRegularTarget: [0, 20], weekdayRegularMinimum: [0, 20], weekdayContractTarget: [0, 20], weekdayContractMinimum: [0, 20],
      weekendRegularTarget: [0, 20], weekendRegularMinimum: [0, 20], weekendContractTarget: [0, 20], weekendContractMinimum: [0, 20],
      functionalMinOnDuty: [0, 9], supportMaxOff: [0, 9], produceOpenCount: [0, 9],
      maxConsecutiveWorkDays: [0, 31], maxWishDaysPerEmployee: [0, 31], supportMaxRequestsPerDate: [0, 9], requestDueDay: [1, 28], publishDay: [1, 28],
    }
    if (!operations || typeof operations !== 'object' || Array.isArray(operations) || typeof operations.requireRegularEachShift !== 'boolean' || !['combined', 'employmentType'].includes(operations.staffingMode)) return res.status(400).json({ error: '운영 기준을 확인해 주세요.' })
    for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isInteger(operations[key]) || operations[key] < min || operations[key] > max) return res.status(400).json({ error: '운영 기준의 인원 수와 날짜를 확인해 주세요.' })
    if (operations.weekdayMinimum > operations.weekdayTarget || operations.weekendMinimum > operations.weekendTarget) return res.status(400).json({ error: '최소 근무인원은 목표 인원보다 클 수 없습니다.' })
    for (const prefix of ['weekday', 'weekend']) for (const type of ['Regular', 'Contract']) if (operations[`${prefix}${type}Minimum`] > operations[`${prefix}${type}Target`]) return res.status(400).json({ error: '정규직·계약직 최소 인원은 해당 목표 인원보다 클 수 없습니다.' })
    settings.operations = { ...settings.operations, ...Object.fromEntries(Object.keys(ranges).map(key => [key, operations[key]])), staffingMode: operations.staffingMode, requireRegularEachShift: operations.requireRegularEachShift }
  }
  // A settings update can never mark a month confirmed; only the validated endpoint can.
  const previous = await readSettings()
  if (JSON.stringify({ ...settings, confirmedMonths: [] }) !== JSON.stringify({ ...previous, confirmedMonths: [] })) settings.confirmedMonths = []
  await saveSettings(settings)
  res.json(settings)
})

app.get('/api/holidays', async (req, res) => {
  const year = Number(req.query.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ error: '연도를 확인해 주세요.' })
  res.json(holidaysFor(year, await readSettings()))
})
app.get('/api/shifts', async (req, res) => {
  const month = String(req.query.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '월 형식은 YYYY-MM이어야 합니다.' })
  const rows = await db.prepare(`SELECT s.employee_id AS employeeId, s.shift_date AS date, s.code, e.name AS employeeName, e.employment_type AS employmentType, CASE WHEN l.employee_id IS NULL THEN 0 ELSE 1 END AS locked
    FROM shifts s JOIN employees e ON e.id = s.employee_id LEFT JOIN shift_locks l ON l.employee_id = s.employee_id AND l.shift_date = s.shift_date WHERE s.shift_date >= ? AND s.shift_date < ? ORDER BY s.shift_date, e.sort_order, e.id`)
    .all(`${month}-01`, `${nextMonth(month)}-01`)
  if (req.user.role === 'admin') return res.json(rows.map(row => ({ ...row, locked: Boolean(row.locked) })))
  const settings = await readSettings()
  res.json(rows.map(({ employmentType, locked, ...row }) => {
    const times = row.code === 'off' ? null : shiftTimesForEmployee(row.employeeName, employmentType, row.code, settings)
    return { ...row, locked: Boolean(locked), start: times?.start ?? null, end: times?.end ?? null }
  }))
})
app.put('/api/shifts', requireAdmin, async (req, res) => {
  const { employeeId, date, code } = req.body ?? {}
  if (!Number.isInteger(Number(employeeId)) || !validDate(String(date ?? '')) || !['open', 'close', 'off', ''].includes(code)) return res.status(400).json({ error: '근무표 입력을 확인해 주세요.' })
  if (date <= seoulDateKey()) return res.status(409).json({ error: `${date}는 지난 날짜라 고정되어 수정할 수 없습니다.` })
  if (!await db.prepare('SELECT id FROM employees WHERE id = ? AND active = 1').get(Number(employeeId))) return res.status(404).json({ error: '재직 직원을 찾을 수 없습니다.' })
  const employee = Number(employeeId)
  if (await db.prepare('SELECT 1 FROM shift_locks WHERE employee_id = ? AND shift_date = ?').get(employee, date)) return res.status(409).json({ error: `${date}에 이미 입력한 근무는 확정되어 수정할 수 없습니다. 빈칸만 편집해 주세요.` })
  if (code === '') await db.prepare('DELETE FROM shifts WHERE employee_id = ? AND shift_date = ?').run(Number(employeeId), date)
  else await db.prepare(`INSERT INTO shifts (employee_id, shift_date, code) VALUES (?, ?, ?) ON CONFLICT(employee_id, shift_date) DO UPDATE SET code = excluded.code, updated_at = CURRENT_TIMESTAMP`).run(Number(employeeId), date, code)
  await invalidateConfirmed()
  res.json({ ok: true })
})
app.get('/api/requests', async (req, res) => {
  const month = String(req.query.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '월 형식은 YYYY-MM이어야 합니다.' })
  let query = `SELECT r.id, r.employee_id AS employeeId, e.name AS employeeName, r.request_date AS date, r.status
    FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.request_date >= ? AND r.request_date < ?`
  const params = [`${month}-01`, `${nextMonth(month)}-01`]
  if (req.user.role === 'employee') { query += ' AND r.employee_id = ?'; params.push(req.user.employee_id) }
  query += ' ORDER BY r.request_date, e.sort_order, e.id'
  res.json(await db.prepare(query).all(...params))
})
app.post('/api/requests', async (req, res) => {
  const employeeId = req.user.role === 'employee' ? req.user.employee_id : Number(req.body?.employeeId)
  const dates = req.body?.dates
  if (!employeeId || !Array.isArray(dates) || !dates.length || dates.length > 31 || dates.some(date => typeof date !== 'string' || !validDate(date))) return res.status(400).json({ error: '희망휴무 날짜를 확인해 주세요.' })
  const employee = await db.prepare('SELECT id, duty_type AS dutyType FROM employees WHERE id = ? AND active = 1').get(employeeId)
  if (!employee) return res.status(404).json({ error: '재직 중인 직원을 찾을 수 없습니다.' })
  const uniqueDates = [...new Set(dates)]
  const operations = (await readSettings()).operations
  const maxPerMonth = operations.maxWishDaysPerEmployee
  if (employee.dutyType === 'support' && operations.supportMaxRequestsPerDate > 0) {
    for (const date of uniqueDates) {
      const existing = (await db.prepare("SELECT COUNT(*) AS n FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.request_date = ? AND r.status != 'rejected' AND e.active = 1 AND e.duty_type = 'support' AND r.employee_id != ?").get(date, employeeId)).n
      if (existing >= operations.supportMaxRequestsPerDate) return res.status(400).json({ error: `${date}: 계약직 희망휴무는 같은 날 최대 ${operations.supportMaxRequestsPerDate}명까지 신청할 수 있습니다.` })
    }
  }
  if (maxPerMonth > 0) {
    const byMonth = Map.groupBy(uniqueDates, date => date.slice(0, 7))
    for (const [month, selected] of byMonth) {
      const existing = await db.prepare("SELECT request_date AS date FROM requests WHERE employee_id = ? AND request_date >= ? AND request_date < ? AND status != 'rejected'").all(employeeId, `${month}-01`, `${nextMonth(month)}-01`)
      const pendingDates = new Set(existing.map(row => row.date))
      const additional = selected.filter(date => !pendingDates.has(date)).length
      if (pendingDates.size + additional > maxPerMonth) return res.status(400).json({ error: `한 달 희망휴무는 최대 ${maxPerMonth}일까지 신청할 수 있습니다.` })
    }
  }
  const insert = db.prepare("INSERT INTO requests (employee_id, request_date) VALUES (?, ?) ON CONFLICT(employee_id, request_date) DO UPDATE SET status = 'pending'")
  await runTransaction(async () => { for (const date of uniqueDates) await insert.run(employeeId, date) }, () => uniqueDates.forEach(date => insert.run(employeeId, date)))
  res.status(201).json({ ok: true })
})
app.patch('/api/requests/:id', requireAdmin, async (req, res) => {
  const status = req.body?.status
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: '신청 상태를 확인해 주세요.' })
  const result = await db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, Number(req.params.id))
  if (!result.changes) return res.status(404).json({ error: '신청을 찾을 수 없습니다.' })
  res.json({ ok: true })
})
app.delete('/api/requests/:id', async (req, res) => {
  const result = req.user.role === 'admin'
    ? await db.prepare('DELETE FROM requests WHERE id = ?').run(Number(req.params.id))
    : await db.prepare('DELETE FROM requests WHERE id = ? AND employee_id = ? AND status = ?').run(Number(req.params.id), req.user.employee_id, 'pending')
  if (!result.changes) return res.status(404).json({ error: '취소할 수 있는 신청을 찾을 수 없습니다.' })
  res.status(204).end()
})

app.get('/api/shifts/validation', requireAdmin, async (req, res) => {
  const month = String(req.query.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '월 형식을 확인해 주세요.' })
  const input = await planningInput(month)
  res.json(validateSchedule({ ...input, shifts: input.existingShifts }))
})
app.post('/api/shifts/lock-existing', requireAdmin, async (req, res) => {
  const month = String(req.body?.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '고정할 월 형식을 확인해 주세요.' })
  const alreadyLocked = await db.prepare('SELECT month FROM locked_months WHERE month = ?').get(month)
  if (alreadyLocked) {
    const count = (await db.prepare('SELECT COUNT(*) AS n FROM shift_locks WHERE shift_date >= ? AND shift_date < ?').get(`${month}-01`, `${nextMonth(month)}-01`)).n
    return res.json({ ok: true, month, locked: count, alreadyLocked: true })
  }
  const count = await runTransaction(async () => {
    await db.prepare(`INSERT INTO shift_locks (employee_id, shift_date, code)
      SELECT employee_id, shift_date, code FROM shifts WHERE shift_date >= ? AND shift_date < ?`).run(`${month}-01`, `${nextMonth(month)}-01`)
    await db.prepare('INSERT INTO locked_months (month) VALUES (?)').run(month)
    return (await db.prepare('SELECT COUNT(*) AS n FROM shift_locks WHERE shift_date >= ? AND shift_date < ?').get(`${month}-01`, `${nextMonth(month)}-01`)).n
  }, () => {
    db.prepare(`INSERT INTO shift_locks (employee_id, shift_date, code)
      SELECT employee_id, shift_date, code FROM shifts WHERE shift_date >= ? AND shift_date < ?`).run(`${month}-01`, `${nextMonth(month)}-01`)
    db.prepare('INSERT INTO locked_months (month) VALUES (?)').run(month)
    return db.prepare('SELECT COUNT(*) AS n FROM shift_locks WHERE shift_date >= ? AND shift_date < ?').get(`${month}-01`, `${nextMonth(month)}-01`).n
  })
  res.json({ ok: true, month, locked: count, alreadyLocked: false })
})
app.post('/api/shifts/lock-cell', requireAdmin, async (req, res) => {
  const employeeId = Number(req.body?.employeeId)
  const date = String(req.body?.date ?? '')
  const lock = req.body?.locked === true
  if (!Number.isInteger(employeeId) || !validDate(date) || date <= seoulDateKey()) return res.status(400).json({ error: '고정할 직원과 미래 날짜를 확인해 주세요.' })
  const shift = await db.prepare('SELECT code FROM shifts WHERE employee_id = ? AND shift_date = ?').get(employeeId, date)
  if (!shift) return res.status(404).json({ error: '먼저 근무 칸에 오픈·마감·휴무를 입력해 주세요.' })
  await runTransaction(async () => {
    if (lock) {
      await db.prepare('INSERT INTO shift_locks (employee_id, shift_date, code) VALUES (?, ?, ?) ON CONFLICT(employee_id, shift_date) DO UPDATE SET code = excluded.code').run(employeeId, date, shift.code)
      await db.prepare('INSERT INTO locked_months (month) VALUES (?) ON CONFLICT(month) DO NOTHING').run(date.slice(0, 7))
    } else await db.prepare('DELETE FROM shift_locks WHERE employee_id = ? AND shift_date = ?').run(employeeId, date)
  }, () => {
    if (lock) {
      db.prepare('INSERT INTO shift_locks (employee_id, shift_date, code) VALUES (?, ?, ?) ON CONFLICT(employee_id, shift_date) DO UPDATE SET code = excluded.code').run(employeeId, date, shift.code)
      db.prepare('INSERT INTO locked_months (month) VALUES (?) ON CONFLICT(month) DO NOTHING').run(date.slice(0, 7))
    } else db.prepare('DELETE FROM shift_locks WHERE employee_id = ? AND shift_date = ?').run(employeeId, date)
  })
  res.json({ ok: true, locked: lock })
})
app.post('/api/shifts/confirm', requireAdmin, async (req, res) => {
  const month = String(req.body?.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '월 형식을 확인해 주세요.' })
  const input = await planningInput(month)
  const validation = validateSchedule({ ...input, shifts: input.existingShifts })
  const staffingGaps = validation.issues.filter(issue => /^\d{4}-\d{2}-\d{2} (오픈|마감) 정규직 없음$/.test(issue.text))
  const blockingIssues = validation.issues.filter(issue => !staffingGaps.includes(issue))
  const problems = [...blockingIssues, ...validation.pending, ...await photoIssues(month)]
  if (problems.length) return res.status(409).json({ error: '확정 전 확인: ' + problems.slice(0, 4).map(i => i.text).join(' · '), validation })
  const settings = await readSettings()
  settings.confirmedMonths = [...new Set([...settings.confirmedMonths, month])]
  await saveSettings(settings)
  res.json({ ok: true })
})
app.post('/api/shifts/reset', requireAdmin, async (req, res, next) => {
  const month = String(req.body?.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '초기화할 월 형식을 확인해 주세요.' })
  try {
    const lockedThroughDate = seoulDateKey()
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    let backupPath
    if (isHosted) backupPath = await db.backup(`${month}-before-reset-${stamp}`)
    else {
      const backupDir = path.join(dataDir, 'backups')
      mkdirSync(backupDir, { recursive: true })
      backupPath = path.join(backupDir, `${month}-before-reset-${stamp}.sqlite`)
      await db.backup(backupPath)
    }

    const currentImport = await readDataJson('reference-import.json')
    if (currentImport?.month === month) {
      const history = await readDataJson('reference-import-history.json') ?? []
      history.push({ ...currentImport, archivedAt: new Date().toISOString(), archivedBy: req.user.username, reason: '월간 근무표 초기화' })
      await writeDataJson('reference-import-history.json', history)
      await writeDataJson('reference-import.json', { month, entries: [], notes: [], resetAt: new Date().toISOString() })
    }
    const result = await runTransaction(async () => (await db.prepare(`DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ?
        AND NOT EXISTS (SELECT 1 FROM shift_locks l WHERE l.employee_id = shifts.employee_id AND l.shift_date = shifts.shift_date)`).run(lockedThroughDate, `${month}-01`, `${nextMonth(month)}-01`)).changes,
    () => db.prepare(`DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ?
        AND NOT EXISTS (SELECT 1 FROM shift_locks l WHERE l.employee_id = shifts.employee_id AND l.shift_date = shifts.shift_date)`).run(lockedThroughDate, `${month}-01`, `${nextMonth(month)}-01`).changes)
    await invalidateConfirmed()
    res.json({ ok: true, month, deleted: result, preservedThrough: lockedThroughDate, backup: isHosted ? backupPath : path.relative(root, backupPath).replaceAll('\\', '/') })
  } catch (error) { next(error) }
})
let generating = false
function solveInWorker(input, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let received = false
    const worker = new Worker(new URL('./planner-worker.js', import.meta.url), { workerData: input })
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('자동편성 시간이 초과되었습니다.')) }, timeoutMs)
    worker.once('message', value => { received = true; clearTimeout(timer); resolve(value) })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', code => { clearTimeout(timer); if (!received || code !== 0) reject(new Error('자동편성 작업이 종료되었습니다.')) })
  })
}
app.post('/api/shifts/options', requireAdmin, async (req, res, next) => {
  const month = String(req.body?.month ?? '')
  const mode = req.body?.mode ?? 'replace'
  const offset = Number(req.body?.offset ?? 0)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !['replace', 'fill', 'rebalance'].includes(mode)) return res.status(400).json({ error: '월과 자동편성 방식을 확인해 주세요.' })
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) return res.status(400).json({ error: '추가 탐색 값을 확인해 주세요.' })
  if (mode === 'replace' && await db.prepare('SELECT 1 FROM locked_months WHERE month = ?').get(month)) return res.status(409).json({ error: `${month}은 기존에 입력한 근무가 확정되어 있습니다. 빈칸 채우기를 사용해 주세요.` })
  if (mode === 'rebalance' && !await db.prepare('SELECT 1 FROM locked_months WHERE month = ?').get(month)) return res.status(409).json({ error: '먼저 ‘입력된 칸 고정’으로 직접 입력한 근무를 보호해 주세요.' })
  if (generating) return res.status(409).json({ error: '자동편성 중입니다. 잠시 후 다시 실행해 주세요.' })
  generating = true
  const revision = await currentDataRevision()
  try {
    const input = { ...await planningInput(month), mode, lockedThroughDate: seoulDateKey(), alternativeSearch: true }
    const options = []
    const seen = new Set()
    const results = await Promise.allSettled(Array.from({ length: 3 }, (_, attempt) => solveInWorker({ ...input, seed: 7717 + (offset + attempt) * 104729 }, 55_000)))
    const explored = results.length
    for (const attempt of results) {
      if (attempt.status !== 'fulfilled' || attempt.value.error) continue
      const result = attempt.value
      const hardIssues = validateSchedule({ ...input, shifts: result.shifts }).issues.filter(issue => issue.text.includes('미편성'))
      if (hardIssues.length) continue
      const signature = result.shifts.map(shift => `${shift.employeeId}:${shift.date}:${shift.code}`).join('|')
      if (seen.has(signature)) continue
      seen.add(signature)
      options.push({ id: options.length + 1, shifts: result.shifts, warnings: result.warnings ?? [], optimal: result.optimal })
    }
    if (revision !== await currentDataRevision()) return res.status(409).json({ error: '편성 중 직원·일정·조건이 변경되었습니다. 최신 정보로 다시 실행해 주세요.' })
    if (!options.length) return res.status(422).json({ error: '조건을 충족하는 대안을 찾지 못했습니다. 제약 기준과 기존 고정 배정을 확인해 주세요.' })
    res.json({ month, mode, targetRestDays: restTarget(monthDates(month), input.holidays), options, exhaustive: false, explored: offset + explored, nextOffset: offset + explored, revision })
  } catch (error) { next(error) }
  finally { generating = false }
})
app.post('/api/shifts/apply-option', requireAdmin, async (req, res, next) => {
  const month = String(req.body?.month ?? '')
  const shifts = req.body?.shifts
  const mode = req.body?.mode ?? 'replace'
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !['replace', 'fill', 'rebalance'].includes(mode) || !Array.isArray(shifts)) return res.status(400).json({ error: '선택한 편성안을 확인해 주세요.' })
  if (mode === 'replace' && await db.prepare('SELECT 1 FROM locked_months WHERE month = ?').get(month)) return res.status(409).json({ error: `${month}은 기존 입력이 고정되어 있습니다. 고정 입력을 유지하는 방식으로 다시 대안을 찾아 주세요.` })
  if (mode === 'rebalance' && !await db.prepare('SELECT 1 FROM locked_months WHERE month = ?').get(month)) return res.status(409).json({ error: '고정된 근무 칸이 없습니다. 다시 대안을 찾아 주세요.' })
  if (!Number.isInteger(req.body?.revision) || req.body.revision !== await currentDataRevision()) return res.status(409).json({ error: '대안을 만든 뒤 근무표나 조건이 변경되었습니다. 최신 정보로 다시 대안을 찾아 주세요.' })
  try {
    const input = { ...await planningInput(month), mode, lockedThroughDate: seoulDateKey() }
    const dates = new Set(monthDates(month))
    const employeeIds = new Set(input.employees.map(employee => employee.id))
    if (shifts.length !== dates.size * employeeIds.size || shifts.some(item => !employeeIds.has(Number(item.employeeId)) || !dates.has(item.date) || !['open', 'close', 'off'].includes(item.code))) return res.status(400).json({ error: '편성안의 직원·날짜·근무 항목이 올바르지 않습니다.' })
    if (new Set(shifts.map(item => `${item.employeeId}:${item.date}`)).size !== shifts.length) return res.status(400).json({ error: '편성안에 중복된 근무 칸이 있습니다.' })
    const issues = validateSchedule({ ...input, shifts }).issues.filter(issue => issue.text.includes('미편성'))
    if (issues.length) return res.status(422).json({ error: '편성안에 미입력된 칸이 있습니다.' })
    const existingCells = new Set(input.existingShifts.map(entry => `${entry.employeeId}:${entry.date}`))
    await runTransaction(async () => {
      if (mode === 'replace') await db.prepare('DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ?').run(input.lockedThroughDate, `${month}-01`, `${nextMonth(month)}-01`)
      if (mode === 'rebalance') await db.prepare(`DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ? AND NOT EXISTS (SELECT 1 FROM shift_locks l WHERE l.employee_id = shifts.employee_id AND l.shift_date = shifts.shift_date)`).run(input.lockedThroughDate, `${month}-01`, `${nextMonth(month)}-01`)
      const insert = db.prepare('INSERT INTO shifts (employee_id, shift_date, code) VALUES (?, ?, ?) ON CONFLICT(employee_id, shift_date) DO NOTHING')
      for (const entry of shifts) if (entry.date > input.lockedThroughDate || existingCells.has(`${entry.employeeId}:${entry.date}`)) await insert.run(entry.employeeId, entry.date, entry.code)
    }, () => {
      if (mode === 'replace') db.prepare('DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ?').run(input.lockedThroughDate, `${month}-01`, `${nextMonth(month)}-01`)
      if (mode === 'rebalance') db.prepare(`DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ? AND NOT EXISTS (SELECT 1 FROM shift_locks l WHERE l.employee_id = shifts.employee_id AND l.shift_date = shifts.shift_date)`).run(input.lockedThroughDate, `${month}-01`, `${nextMonth(month)}-01`)
      const insert = db.prepare('INSERT INTO shifts (employee_id, shift_date, code) VALUES (?, ?, ?) ON CONFLICT(employee_id, shift_date) DO NOTHING')
      for (const entry of shifts) if (entry.date > input.lockedThroughDate || existingCells.has(`${entry.employeeId}:${entry.date}`)) insert.run(entry.employeeId, entry.date, entry.code)
    })
    await invalidateConfirmed()
    res.json({ ok: true })
  } catch (error) { next(error) }
})
app.post('/api/shifts/generate', requireAdmin, async (req, res, next) => {
  const month = String(req.body?.month ?? '')
  const mode = req.body?.mode ?? 'replace'
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !['replace', 'fill', 'rebalance'].includes(mode)) return res.status(400).json({ error: '월과 자동편성 방식을 확인해 주세요.' })
  if (mode === 'replace' && await db.prepare('SELECT 1 FROM locked_months WHERE month = ?').get(month)) return res.status(409).json({ error: `${month}은 기존에 입력한 근무가 확정되어 있습니다. 기존 입력을 유지하려면 ‘빈칸 채우기’를 사용해 주세요.` })
  if (mode === 'rebalance' && !await db.prepare('SELECT 1 FROM locked_months WHERE month = ?').get(month)) return res.status(409).json({ error: '먼저 ‘입력된 칸 고정’으로 직접 입력한 근무를 보호해 주세요.' })
  if (generating) return res.status(409).json({ error: '자동편성 중입니다. 잠시 후 다시 실행해 주세요.' })
  generating = true
  const revision = await currentDataRevision()
  try {
    const lockedThroughDate = seoulDateKey()
    const preferredDates = Array.isArray(req.body?.prioritizeRegularCoverageDates)
      ? [...new Set(req.body.prioritizeRegularCoverageDates.map(String).filter(date => validDate(date) && date.startsWith(`${month}-`)))]
      : []
    const rawGapPreference = req.body?.preferEmployeeOffOnRegularGap
    const gapEmployeeId = Number(rawGapPreference?.employeeId)
    const preferEmployeeOffOnRegularGap = Number.isInteger(gapEmployeeId) && (await planningInput(month)).employees.some(employee => employee.id === gapEmployeeId && employee.employmentType === '정규직')
      ? { employeeId: gapEmployeeId, excludedDates: Array.isArray(rawGapPreference?.excludedDates) ? [...new Set(rawGapPreference.excludedDates.map(String).filter(date => validDate(date) && date.startsWith(`${month}-`)))] : [] }
      : undefined
    const input = { ...await planningInput(month), mode, lockedThroughDate, prioritizeRegularCoverageDates: preferredDates, preferEmployeeOffOnRegularGap }
    const result = await new Promise((resolve, reject) => {
      let received = false
      const worker = new Worker(new URL('./planner-worker.js', import.meta.url), { workerData: input })
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('자동편성 시간이 초과되었습니다. 조건을 확인해 주세요.')) }, 30000)
      worker.once('message', value => { received = true; clearTimeout(timer); resolve(value) })
      worker.once('error', error => { clearTimeout(timer); reject(error) })
      worker.once('exit', code => { clearTimeout(timer); if (!received || code !== 0) reject(new Error('자동편성 작업이 종료되었습니다.')) })
    })
    if (result.error) return res.status(422).json({ error: result.error })
    if (revision !== await currentDataRevision()) return res.status(409).json({ error: '편성 중 직원·일정·조건이 변경되었습니다. 최신 정보로 다시 실행해 주세요. 기존 근무표는 유지됩니다.' })
    const validation = validateSchedule({ ...input, shifts: result.shifts })
    const regularCoverageGaps = validation.issues.filter(issue => /^\d{4}-\d{2}-\d{2} (오픈|마감) 정규직 없음$/.test(issue.text))
    const hardIssues = validation.issues.filter(issue => issue.text.includes('미편성'))
    if (hardIssues.length) return res.status(422).json({ error: `검증 실패: ${hardIssues.slice(0, 3).map(issue => issue.text).join(' · ')}` })
    const warnings = [...(result.warnings ?? [])]
    if (regularCoverageGaps.length && !warnings.some(warning => warning.includes('정규직 오픈·마감 배치'))) {
      warnings.unshift(`월 휴무 기준을 유지해 정규직 오픈·마감 배치가 ${regularCoverageGaps.length}회 부족합니다. ${regularCoverageGaps.map(issue => issue.text).join(' · ')} 해당 근무는 가능한 직원으로 편성했습니다.`)
    }
    const existingCells = new Set(input.existingShifts.map(entry => `${entry.employeeId}:${entry.date}`))
    const skippedLockedBlanks = result.shifts.filter(entry => entry.date <= lockedThroughDate && !existingCells.has(`${entry.employeeId}:${entry.date}`))
    if (skippedLockedBlanks.length) warnings.push(`지난 날짜 ${lockedThroughDate}까지 입력되지 않은 ${skippedLockedBlanks.length}칸은 고정 기간이라 자동 편성하지 않았습니다.`)
    let backupPath
    if (mode === 'rebalance') {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
      if (isHosted) backupPath = await db.backup(`${month}-before-rebalance-${stamp}`)
      else {
        const backupDir = path.join(dataDir, 'backups')
        mkdirSync(backupDir, { recursive: true })
        backupPath = path.join(backupDir, `${month}-before-rebalance-${stamp}.sqlite`)
        await db.backup(backupPath)
      }
    }
    await runTransaction(async () => {
      if (mode === 'replace') await db.prepare('DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ?').run(lockedThroughDate, month + '-01', nextMonth(month) + '-01')
      if (mode === 'rebalance') await db.prepare(`DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ?
        AND NOT EXISTS (SELECT 1 FROM shift_locks l WHERE l.employee_id = shifts.employee_id AND l.shift_date = shifts.shift_date)`).run(lockedThroughDate, month + '-01', nextMonth(month) + '-01')
      const insert = db.prepare('INSERT INTO shifts (employee_id, shift_date, code) VALUES (?, ?, ?) ON CONFLICT(employee_id, shift_date) DO NOTHING')
      for (const entry of result.shifts) if (entry.date > lockedThroughDate || existingCells.has(`${entry.employeeId}:${entry.date}`)) await insert.run(entry.employeeId, entry.date, entry.code)
    }, () => {
      if (mode === 'replace') db.prepare('DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ?').run(lockedThroughDate, month + '-01', nextMonth(month) + '-01')
      if (mode === 'rebalance') db.prepare(`DELETE FROM shifts WHERE shift_date > ? AND shift_date >= ? AND shift_date < ?
        AND NOT EXISTS (SELECT 1 FROM shift_locks l WHERE l.employee_id = shifts.employee_id AND l.shift_date = shifts.shift_date)`).run(lockedThroughDate, month + '-01', nextMonth(month) + '-01')
      const insert = db.prepare('INSERT INTO shifts (employee_id, shift_date, code) VALUES (?, ?, ?) ON CONFLICT(employee_id, shift_date) DO NOTHING')
      for (const entry of result.shifts) if (entry.date > lockedThroughDate || existingCells.has(`${entry.employeeId}:${entry.date}`)) insert.run(entry.employeeId, entry.date, entry.code)
    })
    await invalidateConfirmed()
    res.json({ ok: true, targetRestDays: result.targetRestDays, assignments: result.shifts.length - skippedLockedBlanks.length, warnings, optimal: result.optimal, backup: backupPath ? isHosted ? backupPath : path.relative(root, backupPath).replaceAll('\\', '/') : undefined })
  } catch (error) { next(error) }
  finally { generating = false }
})

function nextMonth(month) {
  const [year, number] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, number, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const dist = path.join(root, 'dist')
if (!isHosted && existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*path', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}
app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' })
})

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'
const server = createServer(app)
if (!isHosted) server.listen(port, host, () => {
  const actualPort = server.address().port
  console.log(`왕궁농협 하나로마트 근무표 서버가 http://${host}:${actualPort} 에서 실행 중입니다.`)
  if (process.send) process.send({ type: 'ready', port: actualPort })
})

export { app }
