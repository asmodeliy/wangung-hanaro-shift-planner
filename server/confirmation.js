import { createHash } from 'node:crypto'

export function confirmationToken(month, problems) {
  const entries = problems.map(problem => ({ date: problem.date ?? '', employeeId: problem.employeeId ?? null, text: problem.text })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return createHash('sha256').update(JSON.stringify({ month, entries })).digest('hex')
}
