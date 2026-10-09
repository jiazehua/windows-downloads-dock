// 生成应用图标：icon.svg -> 512x512 icon.png（electron-builder 会自动转 ico）
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

async function main() {
  const svg = fs.readFileSync(path.join(__dirname, 'assets', 'icon.svg'))
  const buf = await sharp(svg, { density: 300 }).resize(512, 512).png().toBuffer()
  const out = path.join(__dirname, 'assets', 'icon.png')
  fs.writeFileSync(out, buf)
  console.log(`icon.png generated (${buf.length} bytes) -> ${out}`)
}

main().catch(e => { console.error(e); process.exit(1) })
