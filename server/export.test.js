import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { buildScheduleWorkbook } from './export.js'
import { buildSchedulePdf } from './exportPdf.js'

const sampleEmployees = [
  { id: 1, name: '김민수', employmentType: '정규직', produceQualified: false, produceBackup: false, active: true },
  { id: 2, name: '이영희', employmentType: '계약직', produceQualified: false, produceBackup: false, active: true },
  { id: 3, name: '남궁하늘', employmentType: '정규직', produceQualified: true, produceBackup: false, active: true },
]

const sampleShifts = [
  { employeeId: 1, date: '2026-11-02', code: 'open' },
  { employeeId: 2, date: '2026-11-02', code: 'close' },
  { employeeId: 3, date: '2026-11-03', code: 'full' },
]

const sampleStoreDuties = {
  '2026-11-02': { morning: 1, afternoon: 2 },
  '2026-11-03': { morning: 3, afternoon: null },
}

test('엑셀 월 표 내보내기는 선택한 매장 당번을 오전·오후 당번 행으로 출력한다', async () => {
  const buffer = await buildScheduleWorkbook({
    months: [{ month: '2026-11', employees: sampleEmployees, shifts: sampleShifts, holidays: [], storeDuties: sampleStoreDuties, restTarget: 9 }],
    layout: 'table',
    timeRows: [{ label: '오픈(정규직)', start: '08:00', end: '17:00' }],
  })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  // 3 employees (rows 5..7), headcount (row 8), morning duty (row 9), afternoon duty (row 10)
  assert.equal(sheet.getCell(9, 1).value, '오전 당번')
  assert.equal(sheet.getCell(10, 1).value, '오후 당번')
  // 2026-11-02 is column 4 (firstDayColumn = 3 -> day 1 is col 3, day 2 is col 4)
  assert.equal(sheet.getCell(9, 4).value, '김\n민\n수')
  assert.equal(sheet.getCell(10, 4).value, '이\n영\n희')
  assert.equal(sheet.getCell(9, 5).value, '남\n궁\n하\n늘')
  assert.equal(sheet.getCell(10, 5).value, null)
})

test('엑셀 달력 내보내기는 날짜 칸에 선택한 매장 당번을 함께 출력한다', async () => {
  const buffer = await buildScheduleWorkbook({
    months: [{ month: '2026-11', employees: sampleEmployees, shifts: sampleShifts, holidays: [], storeDuties: sampleStoreDuties, restTarget: 9 }],
    layout: 'calendar',
  })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  // 2026-11-01 is Sunday (col 1, row 4), so 2026-11-02 is col 2, row 4
  const cell2 = sheet.getCell(4, 2).value
  const text2 = cell2.richText.map(part => part.text).join('')
  assert.match(text2, /당번\s+오전 김민수 · 오후 이영희/)
  const cell3 = sheet.getCell(4, 3).value
  const text3 = cell3.richText.map(part => part.text).join('')
  assert.match(text3, /당번\s+오전 남궁하늘/)
  assert.doesNotMatch(text3, /오후/)
})

test('PDF 내보내기는 매장 당번이 있을 때 월 표와 달력 모두 가로 A4 PDF를 정상 생성한다', async () => {
  for (const layout of ['table', 'calendar']) {
    const buffer = await buildSchedulePdf({
      months: [{ month: '2026-11', employees: sampleEmployees, shifts: sampleShifts, holidays: [], storeDuties: sampleStoreDuties, restTarget: 9 }],
      layout,
      timeRows: [{ label: '오픈(정규직)', start: '08:00', end: '17:00' }],
    })
    const text = buffer.toString('latin1')
    assert.ok(text.startsWith('%PDF'))
    const boxes = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(match => [Number(match[1]), Number(match[2])])
    assert.equal(boxes.length, 1)
    assert.ok(boxes[0][0] > boxes[0][1], 'landscape A4')
  }
})
