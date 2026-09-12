// 生成品牌图标：无外部图像依赖，直接按像素绘制后用 zlib 编码 PNG。
// 产物：build/icon.png（打包用）、src/main/app-icon.ts（运行时内嵌，避免打包后找不到文件）。
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const accent = [0x5f, 0x63, 0xd8]
const glyph = [0xff, 0xff, 0xff]

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8   // bit depth
  header[9] = 6   // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// 四角星：|x|^p + |y|^p <= 1，p < 1 时边缘内凹，正好是 sparkle 造型。
function inSparkle(x, y, cx, cy, radius, exponent) {
  const dx = Math.abs((x - cx) / radius)
  const dy = Math.abs((y - cy) / radius)
  return Math.pow(dx, exponent) + Math.pow(dy, exponent) <= 1
}

// 圆角方块：超椭圆，指数越大越接近正方形。
function inTile(x, y, half) {
  return Math.pow(Math.abs(x / half), 4) + Math.pow(Math.abs(y / half), 4) <= 1
}

function render(size, { padding }) {
  const samples = 4
  const pixels = Buffer.alloc(size * size * 4)
  const half = 1 - padding
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let tileHits = 0
      let glyphHits = 0
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = ((px + (sx + 0.5) / samples) / size) * 2 - 1
          const y = ((py + (sy + 0.5) / samples) / size) * 2 - 1
          if (!inTile(x, y, half)) continue
          tileHits += 1
          if (inSparkle(x, y, -0.09, -0.07, 0.60, 0.55) || inSparkle(x, y, 0.44, 0.45, 0.22, 0.55)) glyphHits += 1
        }
      }
      const total = samples * samples
      const alpha = tileHits / total
      const glyphRatio = tileHits ? glyphHits / tileHits : 0
      const offset = (py * size + px) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(accent[channel] * (1 - glyphRatio) + glyph[channel] * glyphRatio)
      }
      pixels[offset + 3] = Math.round(alpha * 255)
    }
  }
  return encodePng(size, pixels)
}

const appIcon = render(256, { padding: 0.06 })
const tray32 = render(32, { padding: 0.02 })
const tray16 = render(16, { padding: 0.02 })

mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build/icon.png'), appIcon)
writeFileSync(join(root, 'src/main/app-icon.ts'), `import { nativeImage } from 'electron'

// 由 scripts/generate-icon.mjs 生成，内嵌为 data URL 是为了打包后不依赖额外的资源路径。
const APP_ICON = '${appIcon.toString('base64')}'
const TRAY_ICON_1X = '${tray16.toString('base64')}'
const TRAY_ICON_2X = '${tray32.toString('base64')}'

export function appIcon() {
  return nativeImage.createFromDataURL(\`data:image/png;base64,\${APP_ICON}\`)
}

export function trayIcon() {
  // 托盘同时提供 1x / 2x，避免高 DPI 下由 32px 缩放导致的糊边。
  const image = nativeImage.createFromDataURL(\`data:image/png;base64,\${TRAY_ICON_1X}\`)
  image.addRepresentation({ scaleFactor: 2, dataURL: \`data:image/png;base64,\${TRAY_ICON_2X}\` })
  return image
}
`)

console.log('icon written: build/icon.png, src/main/app-icon.ts')
