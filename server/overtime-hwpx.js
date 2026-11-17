import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { groupOvertime } from './overtime-export.js'

const template = fileURLToPath(new URL('./templates/overtime.hwpx', import.meta.url))
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c])
function setCell(table, row, col, value) {
  let changed = false
  const result = table.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, cell => {
    if (!cell.includes(`colAddr="${col}" rowAddr="${row}"`)) return cell
    changed = true
    const text = `<hp:t>${escapeXml(value)}</hp:t>`
    if (/<hp:t(?:\s[^>]*)?>[\s\S]*?<\/hp:t>/.test(cell)) cell = cell.replace(/<hp:t(?:\s[^>]*)?>[\s\S]*?<\/hp:t>/, () => text)
    else if (/<hp:run\b[^>]*\/>/.test(cell)) cell = cell.replace(/<hp:run\b([^>]*)\/>/, (_, attributes) => `<hp:run${attributes}>${text}</hp:run>`)
    else cell = cell.replace(/(<hp:run\b[^>]*>)/, (_, opening) => opening + text)
    return cell.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '')
  })
  if (!changed) throw new Error('원본 양식의 입력 칸을 찾지 못했습니다.')
  return result
}

export async function createOvertimeHwpxFiles(input) {
  const groups = groupOvertime(input)
  const raw = await readFile(template)
  const files = []
  for (const group of groups) {
    group.records.sort((a,b) => a.date.localeCompare(b.date))
    for (let offset = 0; offset < group.records.length; offset += 11) {
      const records = group.records.slice(offset, offset + 11)
      const zip = await JSZip.loadAsync(raw)
      let xml = await zip.file('Contents/section0.xml').async('string')
      let index = 0
      xml = xml.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g, table => {
        if (index++ === 0) {
          table = setCell(table, 0, 0, `( ${Number(group.month.slice(5))} )월`)
          return setCell(table, 0, 4, group.name)
        }
        for (let i=0; i<11; i++) {
          const record = records[i]
          table = setCell(table, i+2, 0, record ? Number(record.date.slice(8)) : '')
          table = setCell(table, i+2, 8, record?.actualEnd ?? '')
          table = setCell(table, i+2, 9, record ? String(record.minutes / 60) : '')
        }
        return setCell(table, 13, 9, `${records.reduce((sum,r) => sum + r.minutes,0) / 60}시간`)
      })
      if (index !== 2) throw new Error('원본 양식의 표 구조가 올바르지 않습니다.')
      zip.file('Contents/section0.xml', xml)
      zip.file('mimetype', await zip.file('mimetype').async('nodebuffer'), { compression: 'STORE' })
      zip.remove('Preview/PrvImage.png')
      zip.file('Preview/PrvText.txt', `${group.month} ${group.name} 시간외(휴일)근무 명령부`)
      const safeName = group.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      files.push({ name: `${safeName}_${group.id}_${group.month}_${Math.floor(offset/11)+1}.hwpx`, data: await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE' }) })
    }
  }
  return files
}

export async function createOvertimeHwpxArchive(input) {
  const files = await createOvertimeHwpxFiles(input)
  if (files.length === 1) return { data:files[0].data, type:'application/hwp+zip', extension:'hwpx' }
  const archive = new JSZip()
  for (const file of files) archive.file(file.name, file.data)
  return { data: await archive.generateAsync({type:'nodebuffer', compression:'DEFLATE'}), type:'application/zip', extension:'zip' }
}
