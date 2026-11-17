import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { createOvertimeWorkbook } from './overtime-export.js'

test('명령부는 직원과 월별로 실제 종료시각과 인정시간을 표시한다', async () => {
  const overtime = [
    { employeeId: 1, employeeName: '홍길동', date: '2026-10-15', actualEnd: '20:45', expectedEnd: '20:00', minutes: 30 },
    { employeeId: 1, employeeName: '홍길동', date: '2026-10-16', actualEnd: '21:10', expectedEnd: '20:00', minutes: 60 },
    { employeeId: 1, employeeName: '홍길동', date: '2026-11-01', actualEnd: '21:00', expectedEnd: '20:00', minutes: 60 },
  ]
  const workbook = await createOvertimeWorkbook({ from: '2026-10-01', to: '2026-11-30', overtime })
  const copy = new ExcelJS.Workbook(); await copy.xlsx.load(await workbook.xlsx.writeBuffer())
  assert.equal(copy.worksheets.length, 2)
  const s = copy.worksheets[0]
  assert.equal(s.getCell('A1').value, '시간외(휴일)근무 명령부')
  assert.equal(s.getCell('D5').value, '사 전 결 재')
  assert.equal(s.getCell('K5').value, '사 후 확 인')
  assert.equal(s.getCell('I7').value, '20:45')
  assert.equal(s.getCell('C7').value, null)
  assert.equal(s.getCell('J7').value, .5)
  assert.equal(s.getCell('I18').value.result, 1.5)
  assert.equal(s.getCell('I18').value.formula, 'SUM(J7:J17)')
  assert.equal(s.pageSetup.orientation, 'landscape')
})

test('잘못된 실제 종료시각을 거부한다', async () => {
  await assert.rejects(createOvertimeWorkbook({ from:'2026-10-01', to:'2026-10-31', overtime:[{employeeId:1, employeeName:'직원', date:'2026-10-15', actualEnd:'99:99', minutes:30}] }), /잘못된 값/)
})
