import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confirmationToken } from './confirmation.js'

test('확정 확인값은 월과 확인 항목에 묶이고 표시 순서에는 영향을 받지 않는다', () => {
  const problems = [{ date: '2026-12-01', text: '인원 부족' }, { date: '2026-12-02', text: '확인 필요' }]
  const token = confirmationToken('2026-12', problems)
  assert.equal(token, confirmationToken('2026-12', [...problems].reverse()))
  assert.notEqual(token, confirmationToken('2026-11', problems))
  assert.notEqual(token, confirmationToken('2026-12', [...problems, { date: '2026-12-03', text: '새 항목' }]))
})
