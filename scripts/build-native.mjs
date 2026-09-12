// 构建 Agent 沙箱的两个原生程序，并把产物拷到 resources/sandbox 供打包与开发态使用。
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const nativeRoot = join(projectRoot, 'native')
const outputDir = join(projectRoot, 'resources', 'sandbox')
const binaries = ['fastagent-command-runner.exe', 'fastagent-sandbox-setup.exe']

const build = spawnSync('cargo', ['build', '--release'], { cwd: nativeRoot, stdio: 'inherit', shell: process.platform === 'win32' })
if (build.status !== 0) {
  console.error('原生沙箱程序构建失败；确认已安装 Rust 工具链（https://rustup.rs）')
  process.exit(build.status ?? 1)
}

mkdirSync(outputDir, { recursive: true })
for (const name of binaries) {
  copyFileSync(join(nativeRoot, 'target', 'release', name), join(outputDir, name))
}
console.log(`已输出沙箱原生程序到 ${outputDir}`)
