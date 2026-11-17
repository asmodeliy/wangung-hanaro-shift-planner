import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { createOvertimeHwpxFiles, createOvertimeHwpxArchive } from './overtime-hwpx.js'

test('원본 HWPX에 날짜, 실제 종료시각과 인정시간을 채우고 11건마다 나눈다', async () => {
  const overtime = Array.from({ length: 12 }, (_, i) => ({ employeeId: 1, employeeName: '홍&길동', date: `2026-11-${String(i+1).padStart(2, '0')}`, expectedEnd: '20:00', actualEnd: '20:45', minutes: 30 }))
  const input = { from: '2026-11-01', to: '2026-11-30', overtime }
  const files = await createOvertimeHwpxFiles(input)
  assert.equal(files.length, 2)
  const zip = await JSZip.loadAsync(files[0].data)
  const section = await zip.file('Contents/section0.xml').async('string')
  assert.match(section, /홍&amp;길동/)
  assert.match(section, /예상근무시간/)
  assert.match(section, /실제근무시간/)
  assert.match(section, /20:00/)
  assert.match(section, /20:45/)
  assert.match(section, /5\.5시간/)
  assert.equal((await createOvertimeHwpxArchive(input)).extension, 'zip')
  assert.equal((await createOvertimeHwpxArchive({ ...input, overtime: overtime.slice(0, 1) })).extension, 'hwpx')
})
