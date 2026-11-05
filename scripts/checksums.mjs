import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('release')
const files = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(exe|dmg|zip|deb|AppImage|tar\.gz)$/.test(entry.name) && !entry.name.includes('__uninstaller'))
  .map((entry) => entry.name).sort()
if (!files.length) throw new Error('No desktop packages found')
const rows = []
for (const file of files) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path.join(root, file))) hash.update(chunk)
  rows.push(`${hash.digest('hex')}  ${file}`)
}
await writeFile(path.join(root, 'SHA256SUMS.txt'), rows.join('\n') + '\n')
console.log(rows.join('\n'))
