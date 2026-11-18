export const dutyGroups = ['office', 'compose', 'butcher']
export const dutyPeriods = ['morning', 'afternoon']

export function eligibleStoreDuty(code, period) {
  return code === 'full' || code === (period === 'morning' ? 'open' : 'close')
}

export function assignStoreDuties(dates, shifts, groups) {
  const assignments = {}
  const counts = new Map()
  const exclusions = new Set(groups.butcher)
  const office = new Set(groups.office)
  const compose = new Set(groups.compose)
  const byDate = new Map(dates.map(date => [date, []]))
  for (const shift of shifts) if (!exclusions.has(shift.employeeId)) byDate.get(shift.date)?.push(shift)
  for (const date of dates) {
    const duty = {}
    for (const period of dutyPeriods) {
      const options = byDate.get(date).filter(shift => eligibleStoreDuty(shift.code, period)).map(shift => shift.employeeId)
      options.sort((a, b) => Number(office.has(a)) - Number(office.has(b))
        || Number(compose.has(a)) - Number(compose.has(b))
        || Number(a === duty.morning) - Number(b === duty.morning)
        || (counts.get(a) ?? 0) - (counts.get(b) ?? 0)
        || a - b)
      const id = options[0] ?? null
      duty[period] = id
      if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    assignments[date] = duty
  }
  return assignments
}
