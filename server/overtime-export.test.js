import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { createOvertimeWorkbook } from './overtime-export.js'

test('overtime workbook follows the time-out record form with a sheet per employee', async () => {
  const workbook = await createOvertimeWorkbook({
    from: '2026-10-14', to: '2026-10-21',
    overtime: [
      { employeeId: 8, employeeName: '최창섭', date: '2026-10-15', expectedEnd: '17:00', minutes: 33 },
      { employeeId: 7, employeeName: '정지희', date: '2026-10-14', expectedEnd: '20:00', minutes: 40 },
      { employeeId: 8, employeeName: '최창섭', date: '2026-10-21', expectedEnd: '17:00', minutes: 45 },
    ],
  })
  const buffer = await workbook.xlsx.writeBuffer()
  const readBack = new ExcelJS.Workbook()
  await readBack.xlsx.load(buffer)

  assert.deepEqual(readBack.worksheets.map(sheet => sheet.name), ['정지희', '최창섭'])
  const sheet = readBack.getWorksheet('최창섭')
  assert.equal(sheet.getCell('A1').value, '시간외 근무 기록부')
  assert.equal(sheet.getCell('G2').value, '직 명')
  assert.equal(sheet.getCell('G3').value, '성 명')
  assert.equal(sheet.getCell('I3').value, '최창섭')
  assert.equal(sheet.getCell('E5').value, '사전결재')
  assert.equal(sheet.getCell('I5').value, '사후확인')
  assert.deepEqual([sheet.getCell('A7').value, sheet.getCell('C7').value, sheet.getCell('D7').value, sheet.getCell('I7').value], ['2026-10-15', '17:00', '33분', '33분'])
  assert.deepEqual([sheet.getCell('E7').value, sheet.getCell('F7').value, sheet.getCell('J7').value], ['', '', ''])
  assert.equal(sheet.pageSetup.orientation, 'portrait')
})

test('overtime workbook rejects invalid dates, employee identifiers and durations', async () => {
  const base = { from: '2026-10-14', to: '2026-10-21', overtime: [{ employeeId: 1, employeeName: '직원', date: '2026-10-15', expectedEnd: '17:00', minutes: 35 }] }
  await assert.rejects(createOvertimeWorkbook({ ...base, from: 'bad-date' }), /기간 형식/)
  await assert.rejects(createOvertimeWorkbook({ ...base, overtime: [{ ...base.overtime[0], minutes: 0 }] }), /잘못된 값/)
})
