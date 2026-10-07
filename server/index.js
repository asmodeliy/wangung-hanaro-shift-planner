import Database from 'better-sqlite3'
import Holidays from 'date-holidays'
import express from 'express'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dataDir = path.join(root, 'data')
mkdirSync(dataDir, { recursive: true })
const db = new Database(path.join(dataDir, 'shift-planner.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    employment_type TEXT NOT NULL DEFAULT '정규직',
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

const employeeCount = db.prepare('SELECT COUNT(*) AS n FROM employees').get().n
// Public demo seeds contain no personal employee information. Existing local data is preserved.
if (employeeCount === 0) {
  const insert = db.prepare('INSERT INTO employees (name, sort_order) VALUES (?, ?)')
  db.transaction(() => Array.from({ length: 7 }, (_, index) => insert.run(`직원 ${String.fromCharCode(65 + index)}`, index)))()
}

const defaultSettings = {
  shiftTimes: {
    open: { regular: { start: '08:00', end: '17:00' }, contract: { start: '08:30', end: '17:30' } },
    close: { regular: { start: '11:00', end: '20:00' }, contract: { start: '11:00', end: '20:00' } },
  },
  daysOffPairs: [], additionalHolidays: [], confirmedMonths: [],
}
if (!db.prepare('SELECT 1 FROM app_settings WHERE setting_key = ?').get('main')) {
  db.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)').run('main', JSON.stringify(defaultSettings))
}
function readSettings() {
  try { return { ...defaultSettings, ...JSON.parse(db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get('main').setting_value) } }
  catch { return structuredClone(defaultSettings) }
}
function saveSettings(value) {
  db.prepare('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value').run('main', JSON.stringify(value))
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
function createSession(user, res) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = Math.floor(Date.now() / 1000) + sessionSeconds
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), user.id, expiresAt)
  res.cookie(cookieName, token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: sessionSeconds * 1000, path: '/' })
}
function clearSession(req, res) {
  const token = req.cookies?.[cookieName] ?? parseCookies(req.headers.cookie)[cookieName]
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(createHash('sha256').update(token).digest('hex'))
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/' })
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]))
}
function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[cookieName]
  if (token) {
    const digest = createHash('sha256').update(token).digest('hex')
    const user = db.prepare(`SELECT u.id, u.username, u.role, u.employee_id, e.name AS employee_name
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
app.get('/api/auth/status', (_req, res) => res.json({ setupNeeded: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n === 0 }))
app.post('/api/auth/setup', (req, res) => {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return res.status(409).json({ error: '관리자 계정이 이미 설정되어 있습니다. 로그인해 주세요.' })
  const address = String(req.socket.remoteAddress ?? '')
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return res.status(403).json({ error: '최초 관리자 계정은 서버 PC에서 설정해 주세요.' })
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: '아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 3~32자 입력해 주세요.' })
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: '비밀번호는 10자 이상 입력해 주세요.' })
  const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hashPassword(password), 'admin')
  createSession({ id: result.lastInsertRowid }, res)
  res.status(201).json({ user: { id: Number(result.lastInsertRowid), username, role: 'admin', employeeId: null, employeeName: null } })
})
app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  const user = db.prepare(`SELECT u.id, u.username, u.password_hash, u.role, u.employee_id, e.name AS employee_name, e.active AS employee_active
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.username = ?`).get(username)
  if (!user || (user.role === 'employee' && !user.employee_active) || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: '아이디 또는 비밀번호를 확인해 주세요.' })
  clearSession(req, res)
  createSession(user, res)
  res.json({ user: safeUser(user) })
})
app.post('/api/auth/logout', (req, res) => { clearSession(req, res); res.status(204).end() })
app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: safeUser(req.user) }))
app.use('/api', (req, res, next) => ['/auth/status', '/auth/setup', '/auth/login', '/auth/logout', '/auth/me', '/health'].includes(req.path) ? next() : requireUser(req, res, next))

app.get('/api/employees', (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT id, name, employment_type AS employmentType, active, notes FROM employees ORDER BY sort_order, id').all()
    : db.prepare('SELECT id, name, active FROM employees ORDER BY sort_order, id').all()
  res.json(rows)
})
app.get('/api/reference-schedule', requireAdmin, (_req, res) => {
  const referencePath = path.join(dataDir, 'reference-schedule.png')
  if (!existsSync(referencePath)) return res.status(404).json({ error: '등록된 참고 이미지가 없습니다.' })
  res.type('png').sendFile(referencePath)
})
app.get('/api/reference-schedule/status', requireAdmin, (_req, res) => {
  res.json({ available: existsSync(path.join(dataDir, 'reference-schedule.png')) })
})
app.post('/api/employees', requireAdmin, (req, res) => {
  const { name, employmentType = '정규직', active = true, notes = '' } = req.body ?? {}
  if (!String(name ?? '').trim()) return res.status(400).json({ error: '직원명을 입력해 주세요.' })
  if (!['정규직', '계약직'].includes(employmentType)) return res.status(400).json({ error: '직원 정보를 확인해 주세요.' })
  const result = db.prepare(`INSERT INTO employees (name, employment_type, active, notes, sort_order)
    VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM employees))`).run(String(name).trim(), employmentType, active ? 1 : 0, String(notes).trim())
  res.status(201).json(db.prepare('SELECT id, name, employment_type AS employmentType, active, notes FROM employees WHERE id = ?').get(result.lastInsertRowid))
})
app.put('/api/employees/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const { name, employmentType, active, notes } = req.body ?? {}
  if (!Number.isInteger(id) || !String(name ?? '').trim() || !['정규직', '계약직'].includes(employmentType)) return res.status(400).json({ error: '직원 정보를 확인해 주세요.' })
  const result = db.prepare('UPDATE employees SET name = ?, employment_type = ?, active = ?, notes = ? WHERE id = ?').run(String(name).trim(), employmentType, active ? 1 : 0, String(notes ?? '').trim(), id)
  if (!result.changes) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' })
  res.json(db.prepare('SELECT id, name, employment_type AS employmentType, active, notes FROM employees WHERE id = ?').get(id))
})
app.delete('/api/employees/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM employees WHERE id = ?').run(Number(req.params.id))
  if (!result.changes) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' })
  res.status(204).end()
})

app.get('/api/users', requireAdmin, (_req, res) => res.json(db.prepare(`SELECT u.id, u.username, u.role, u.employee_id AS employeeId, e.name AS employeeName
  FROM users u LEFT JOIN employees e ON e.id = u.employee_id ORDER BY u.role, e.sort_order, u.username`).all()))
app.put('/api/users/employee/:employeeId', requireAdmin, (req, res) => {
  const employeeId = Number(req.params.employeeId)
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')
  if (!db.prepare('SELECT 1 FROM employees WHERE id = ?').get(employeeId)) return res.status(404).json({ error: '직원을 찾을 수 없습니다.' })
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: '아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 3~32자 입력해 주세요.' })
  if (password && password.length < 10) return res.status(400).json({ error: '새 비밀번호는 10자 이상 입력해 주세요.' })
  const existing = db.prepare('SELECT id FROM users WHERE employee_id = ?').get(employeeId)
  try {
    if (existing) {
      db.prepare(`UPDATE users SET username = ?, password_hash = CASE WHEN ? = '' THEN password_hash ELSE ? END WHERE employee_id = ?`)
        .run(username, password, password ? hashPassword(password) : '', employeeId)
    } else {
      if (!password) return res.status(400).json({ error: '처음 계정을 만들 때는 비밀번호가 필요합니다.' })
      db.prepare('INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)').run(username, hashPassword(password), 'employee', employeeId)
    }
  } catch (error) {
    if (String(error?.code).includes('CONSTRAINT')) return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' })
    throw error
  }
  res.json({ ok: true })
})
app.delete('/api/users/employee/:employeeId', requireAdmin, (req, res) => {
  db.prepare("DELETE FROM users WHERE employee_id = ? AND role = 'employee'").run(Number(req.params.employeeId))
  res.status(204).end()
})

app.get('/api/settings', requireAdmin, (_req, res) => res.json(readSettings()))
app.put('/api/settings', requireAdmin, (req, res) => {
  const incoming = req.body ?? {}
  const settings = readSettings()
  if (incoming.shiftTimes) {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
    for (const shift of ['open', 'close']) for (const type of ['regular', 'contract']) {
      const time = incoming.shiftTimes?.[shift]?.[type]
      if (!timePattern.test(String(time?.start ?? '')) || !timePattern.test(String(time?.end ?? ''))) return res.status(400).json({ error: '근무시간을 확인해 주세요.' })
    }
    settings.shiftTimes = incoming.shiftTimes
  }
  if (Array.isArray(incoming.daysOffPairs)) {
    const ids = new Set(db.prepare('SELECT id FROM employees').all().map(row => row.id))
    settings.daysOffPairs = incoming.daysOffPairs.filter(pair => Array.isArray(pair.employeeIds) && pair.employeeIds.length === 2 && pair.employeeIds.every(id => ids.has(Number(id))) && Number(pair.employeeIds[0]) !== Number(pair.employeeIds[1])).map(pair => ({ employeeIds: pair.employeeIds.map(Number) }))
  }
  if (Array.isArray(incoming.additionalHolidays)) settings.additionalHolidays = [...new Set(incoming.additionalHolidays.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort()
  if (Array.isArray(incoming.confirmedMonths)) settings.confirmedMonths = [...new Set(incoming.confirmedMonths.filter(month => /^\d{4}-\d{2}$/.test(month)))]
  saveSettings(settings)
  res.json(settings)
})

app.get('/api/holidays', (req, res) => {
  const year = Number(req.query.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ error: '연도를 확인해 주세요.' })
  const holidays = new Holidays('KR').getHolidays(year).filter(item => item.type === 'public').map(item => ({ date: item.date.slice(0, 10), name: item.name }))
  const custom = readSettings().additionalHolidays.filter(date => date.startsWith(`${year}-`)).map(date => ({ date, name: '추가 공휴일' }))
  res.json([...new Map([...holidays, ...custom].map(item => [item.date, item])).values()].sort((a, b) => a.date.localeCompare(b.date)))
})
app.get('/api/shifts', (req, res) => {
  const month = String(req.query.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '월 형식은 YYYY-MM이어야 합니다.' })
  const rows = db.prepare(`SELECT s.employee_id AS employeeId, s.shift_date AS date, s.code, e.name AS employeeName, e.employment_type AS employmentType
    FROM shifts s JOIN employees e ON e.id = s.employee_id WHERE s.shift_date >= ? AND s.shift_date < ? ORDER BY s.shift_date, e.sort_order, e.id`)
    .all(`${month}-01`, `${nextMonth(month)}-01`)
  if (req.user.role === 'admin') return res.json(rows)
  const settings = readSettings()
  res.json(rows.map(({ employmentType, ...row }) => {
    const times = row.code === 'off' ? null : settings.shiftTimes[row.code][employmentType === '계약직' ? 'contract' : 'regular']
    return { ...row, start: times?.start ?? null, end: times?.end ?? null }
  }))
})
app.put('/api/shifts', requireAdmin, (req, res) => {
  const { employeeId, date, code } = req.body ?? {}
  if (!Number.isInteger(Number(employeeId)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) || !['open', 'close', 'off', ''].includes(code)) return res.status(400).json({ error: '근무표 입력을 확인해 주세요.' })
  if (code === '') db.prepare('DELETE FROM shifts WHERE employee_id = ? AND shift_date = ?').run(Number(employeeId), date)
  else db.prepare(`INSERT INTO shifts (employee_id, shift_date, code) VALUES (?, ?, ?) ON CONFLICT(employee_id, shift_date) DO UPDATE SET code = excluded.code, updated_at = CURRENT_TIMESTAMP`).run(Number(employeeId), date, code)
  const settings = readSettings(); settings.confirmedMonths = settings.confirmedMonths.filter(value => value !== String(date).slice(0, 7)); saveSettings(settings)
  res.json({ ok: true })
})
app.get('/api/requests', (req, res) => {
  const month = String(req.query.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '월 형식은 YYYY-MM이어야 합니다.' })
  let query = `SELECT r.id, r.employee_id AS employeeId, e.name AS employeeName, r.request_date AS date, r.status
    FROM requests r JOIN employees e ON e.id = r.employee_id WHERE r.request_date >= ? AND r.request_date < ?`
  const params = [`${month}-01`, `${nextMonth(month)}-01`]
  if (req.user.role === 'employee') { query += ' AND r.employee_id = ?'; params.push(req.user.employee_id) }
  query += ' ORDER BY r.request_date, e.sort_order, e.id'
  res.json(db.prepare(query).all(...params))
})
app.post('/api/requests', (req, res) => {
  const employeeId = req.user.role === 'employee' ? req.user.employee_id : Number(req.body?.employeeId)
  const dates = req.body?.dates
  if (!employeeId || !Array.isArray(dates) || !dates.length || dates.length > 31 || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date))) return res.status(400).json({ error: '희망휴무 날짜를 확인해 주세요.' })
  const employee = db.prepare('SELECT id FROM employees WHERE id = ? AND active = 1').get(employeeId)
  if (!employee) return res.status(404).json({ error: '재직 중인 직원을 찾을 수 없습니다.' })
  const insert = db.prepare("INSERT INTO requests (employee_id, request_date) VALUES (?, ?) ON CONFLICT(employee_id, request_date) DO UPDATE SET status = 'pending'")
  db.transaction(() => [...new Set(dates)].forEach(date => insert.run(employeeId, date)))()
  res.status(201).json({ ok: true })
})
app.patch('/api/requests/:id', requireAdmin, (req, res) => {
  const status = req.body?.status
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: '신청 상태를 확인해 주세요.' })
  const result = db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, Number(req.params.id))
  if (!result.changes) return res.status(404).json({ error: '신청을 찾을 수 없습니다.' })
  res.json({ ok: true })
})
app.delete('/api/requests/:id', (req, res) => {
  const result = req.user.role === 'admin'
    ? db.prepare('DELETE FROM requests WHERE id = ?').run(Number(req.params.id))
    : db.prepare('DELETE FROM requests WHERE id = ? AND employee_id = ? AND status = ?').run(Number(req.params.id), req.user.employee_id, 'pending')
  if (!result.changes) return res.status(404).json({ error: '취소할 수 있는 신청을 찾을 수 없습니다.' })
  res.status(204).end()
})

app.post('/api/shifts/generate', requireAdmin, (req, res) => {
  const month = String(req.body?.month ?? '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: '월 형식은 YYYY-MM이어야 합니다.' })
  const employees = db.prepare('SELECT id, employment_type AS employmentType FROM employees WHERE active = 1 ORDER BY sort_order, id').all()
  if (!employees.length) return res.status(400).json({ error: '재직 중인 직원이 없습니다. 직원 관리에서 직원을 먼저 등록해 주세요.' })
  const settings = readSettings()
  const [year, monthNumber] = month.split('-').map(Number)
  const dayCount = new Date(year, monthNumber, 0).getDate()
  const holidays = new Set(new Holidays('KR').getHolidays(year).filter(item => item.type === 'public').map(item => item.date.slice(0, 10)))
  for (const date of settings.additionalHolidays) if (date.startsWith(`${month}-`)) holidays.add(date)
  const dates = Array.from({ length: dayCount }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
  const targetRest = dates.filter(date => { const d = new Date(`${date}T12:00:00`); return d.getDay() === 0 || d.getDay() === 6 || holidays.has(date) }).length
  const requestRows = db.prepare(`SELECT employee_id AS employeeId, request_date AS date, status FROM requests WHERE request_date >= ? AND request_date < ? AND status != 'rejected'`).all(`${month}-01`, `${nextMonth(month)}-01`)
  const employeeIds = new Set(employees.map(employee => employee.id))
  const pairs = settings.daysOffPairs.map(pair => pair.employeeIds.map(Number)).filter(pair => pair.length === 2 && pair.every(id => employeeIds.has(id)))
  const offByDay = new Map(dates.map(date => [date, new Set()]))
  const offCount = new Map(employees.map(employee => [employee.id, 0]))
  const requestMap = new Map()
  for (const request of requestRows) {
    if (!employeeIds.has(request.employeeId) || !dates.includes(request.date)) continue
    const existing = requestMap.get(request.employeeId) ?? []
    existing.push(request)
    requestMap.set(request.employeeId, existing)
  }
  const pairConflicts = (employeeId, day) => pairs.filter(pair => pair.includes(employeeId) && pair.some(other => other !== employeeId && offByDay.get(day).has(other))).length
  // Preserve approved requests first; pending requests are honored when they fit a monthly quota.
  const requests = [...requestRows].sort((a, b) => (a.status === 'approved' ? 0 : 1) - (b.status === 'approved' ? 0 : 1))
  for (const request of requests) {
    if (!employeeIds.has(request.employeeId) || !dates.includes(request.date)) continue
    const required = request.status === 'approved'
    if (!required && offCount.get(request.employeeId) >= targetRest) continue
    if (offByDay.get(request.date).has(request.employeeId)) continue
    if (!required && pairConflicts(request.employeeId, request.date)) continue
    offByDay.get(request.date).add(request.employeeId)
    offCount.set(request.employeeId, offCount.get(request.employeeId) + 1)
  }
  const regularCount = employees.filter(employee => employee.employmentType === '정규직').length
  for (const employee of employees) {
    const quota = Math.max(targetRest, offCount.get(employee.id))
    while (offCount.get(employee.id) < quota) {
      const candidates = dates.filter(date => !offByDay.get(date).has(employee.id)).map(date => {
        const dayOff = offByDay.get(date)
        const remaining = employees.length - dayOff.size - 1
        const regularWorking = employees.filter(item => item.employmentType === '정규직' && item.id !== employee.id && !dayOff.has(item.id)).length
        const pairPenalty = pairConflicts(employee.id, date) * 1000
        const coveragePenalty = employee.employmentType === '정규직' && regularWorking < 2 ? 160 : 0
        const staffingPenalty = remaining < 2 ? (2 - remaining) * 120 : 0
        const spreadPenalty = dayOff.size * 12
        const weekendBias = new Date(`${date}T12:00:00`).getDay() % 6 === 0 ? -0.3 : 0
        return { date, score: pairPenalty + coveragePenalty + staffingPenalty + spreadPenalty + Math.random() + weekendBias }
      }).sort((a, b) => a.score - b.score)
      const pick = candidates[0]
      if (!pick) break
      offByDay.get(pick.date).add(employee.id)
      offCount.set(employee.id, offCount.get(employee.id) + 1)
    }
  }

  const opened = new Map(employees.map(employee => [employee.id, 0]))
  const closed = new Map(employees.map(employee => [employee.id, 0]))
  const assignment = []
  const dayWarnings = []
  for (const date of dates) {
    const off = offByDay.get(date)
    const workers = employees.filter(employee => !off.has(employee.id))
    const regulars = workers.filter(employee => employee.employmentType === '정규직')
    const assigned = new Map()
    const leastUsed = (list, countMap, except = new Set()) => {
      const choices = list.filter(employee => !except.has(employee.id))
      if (!choices.length) return null
      const min = Math.min(...choices.map(employee => countMap.get(employee.id)))
      return choices.filter(employee => countMap.get(employee.id) === min)[Math.floor(Math.random() * choices.filter(employee => countMap.get(employee.id) === min).length)]
    }
    const openLead = leastUsed(regulars.length ? regulars : workers, opened)
    if (openLead) assigned.set(openLead.id, 'open')
    const closeLead = leastUsed(regulars.length > 1 ? regulars : workers, closed, new Set(openLead ? [openLead.id] : []))
    if (closeLead) assigned.set(closeLead.id, 'close')
    for (const employee of workers) {
      if (assigned.has(employee.id)) continue
      const openLoad = opened.get(employee.id)
      const closeLoad = closed.get(employee.id)
      const code = openLoad < closeLoad || (openLoad === closeLoad && Math.random() < 0.5) ? 'open' : 'close'
      assigned.set(employee.id, code)
    }
    if (!workers.length) dayWarnings.push(`${Number(date.slice(-2))}일 근무자가 없습니다.`)
    if (workers.length && !workers.some(employee => assigned.get(employee.id) === 'open' && employee.employmentType === '정규직')) dayWarnings.push(`${Number(date.slice(-2))}일 오픈 정규직 배치가 필요합니다.`)
    if (workers.length && !workers.some(employee => assigned.get(employee.id) === 'close' && employee.employmentType === '정규직')) dayWarnings.push(`${Number(date.slice(-2))}일 마감 정규직 배치가 필요합니다.`)
    for (const employee of employees) {
      const code = off.has(employee.id) ? 'off' : assigned.get(employee.id)
      if (!code) continue
      assignment.push({ employeeId: employee.id, date, code })
      if (code === 'open') opened.set(employee.id, opened.get(employee.id) + 1)
      if (code === 'close') closed.set(employee.id, closed.get(employee.id) + 1)
    }
  }
  const restShortfalls = employees.filter(employee => offCount.get(employee.id) !== targetRest).map(employee => `${employee.id}번 직원 휴무 ${offCount.get(employee.id)}/${targetRest}일`)
  const pairDays = dates.filter(date => pairs.some(pair => pair.every(id => offByDay.get(date).has(id))))
  const requestMisses = requestRows.filter(item => item.status !== 'approved' && !offByDay.get(item.date)?.has(item.employeeId))
  const warnings = [...new Set([...dayWarnings, ...restShortfalls, ...pairDays.map(date => `${Number(date.slice(-2))}일 동시휴무 제한 확인`), ...(requestMisses.length ? [`희망휴무 ${requestMisses.length}건 미반영`] : []), ...(regularCount < 2 ? ['오픈과 마감에 정규직을 각각 배치하려면 정규직이 2명 이상 필요합니다.'] : [])])]
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM shifts WHERE shift_date >= ? AND shift_date < ?').run(`${month}-01`, `${nextMonth(month)}-01`)
    const insert = db.prepare('INSERT INTO shifts (employee_id, shift_date, code) VALUES (?, ?, ?)')
    for (const entry of assignment) insert.run(entry.employeeId, entry.date, entry.code)
    const current = readSettings(); current.confirmedMonths = current.confirmedMonths.filter(value => value !== month); saveSettings(current)
  })
  replace()
  res.json({ ok: true, targetRestDays: targetRest, assignments: assignment.length, warnings })
})

function nextMonth(month) {
  const [year, number] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, number, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const dist = path.join(root, 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*path', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}
app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' })
})

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'
createServer(app).listen(port, host, () => console.log(`왕궁농협 하나로마트 근무표 서버가 http://${host}:${port} 에서 실행 중입니다.`))
