// 下载内置工具链的二进制，校验 sha256 后解压到 resources/runtime/<platform>-<arch>/bin。
// 版本写死在这里：runtime 的意义就是各台机器执行环境一致，不能跟着上游 latest 漂。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const RUNTIME_VERSION = '2026.09'

// kind 说明：
//   zip-entry  从 zip 里挑一个可执行文件
//   zip-tree   整个 zip 解到一个目录（MinGit 是目录树，不是单文件）
//   raw        上游直接发布可执行文件，不用解压
//   sevenzip   .7z，用 Windows 自带的 bsdtar（System32\tar.exe）解，Git Bash 的 GNU tar 读不了 7z
// sha256 来源：ripgrep 取上游随包发布的 .sha256；其余上游未发布校验文件，此处的值由首次下载后本地计算并锁定。
const TOOLS = {
  'win32-x64': [
    {
      kind: 'zip-entry',
      name: 'rg',
      display: 'ripgrep',
      version: '15.2.0',
      license: 'MIT OR Unlicense',
      source: 'https://github.com/BurntSushi/ripgrep/tree/15.2.0',
      url: 'https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip',
      archiveSha256: '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5',
      entry: /(^|\/)rg\.exe$/,
      output: 'bin/rg.exe',
      licenses: [
        { from: 'COPYING', to: 'licenses/ripgrep-COPYING.txt' },
        { from: 'LICENSE-MIT', to: 'licenses/ripgrep-LICENSE-MIT.txt' },
        { from: 'UNLICENSE', to: 'licenses/ripgrep-UNLICENSE.txt' }
      ]
    },
    {
      kind: 'zip-entry',
      name: 'fd',
      display: 'fd',
      version: '10.5.0',
      license: 'MIT OR Apache-2.0',
      source: 'https://github.com/sharkdp/fd/tree/v10.5.0',
      url: 'https://github.com/sharkdp/fd/releases/download/v10.5.0/fd-v10.5.0-x86_64-pc-windows-msvc.zip',
      archiveSha256: 'a227701b8551c35a9931d9f6da75503cf86d88e182d71fb849a70864c5d57cd7',
      entry: /(^|\/)fd\.exe$/,
      output: 'bin/fd.exe',
      licenses: [
        { from: 'LICENSE-MIT', to: 'licenses/fd-LICENSE-MIT.txt' },
        { from: 'LICENSE-APACHE', to: 'licenses/fd-LICENSE-APACHE.txt' }
      ]
    },
    {
      kind: 'raw',
      name: 'jq',
      display: 'jq',
      version: '1.8.2',
      license: 'MIT',
      source: 'https://github.com/jqlang/jq/tree/jq-1.8.2',
      url: 'https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-windows-amd64.exe',
      archiveSha256: 'a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627',
      output: 'bin/jq.exe',
      // 上游直接发布裸 exe，许可证不在产物里，单独取一份
      licenses: [{ url: 'https://raw.githubusercontent.com/jqlang/jq/jq-1.8.2/COPYING', to: 'licenses/jq-COPYING.txt' }]
    },
    {
      kind: 'sevenzip',
      name: '7zz',
      display: '7-Zip (7za 命令行版)',
      version: '26.03',
      license: 'LGPL-2.1-or-later',
      source: 'https://github.com/ip7z/7zip/releases/tag/26.03',
      url: 'https://github.com/ip7z/7zip/releases/download/26.03/7z2603-extra.7z',
      archiveSha256: '191894e6acb3647ffb69ce630479ff318523b2e2b9890aa7f05c1127c2e59b8f',
      // -extra 里的 x64/7za.exe 是自包含的命令行版；Windows 上没有叫 7zz 的官方产物，
      // 统一落成 7zz 让模型在各平台写同一条命令，不再额外留一份 7za 副本（同一文件存两遍）。
      // 该版本只含 7z/zip/gzip/bzip2/tar/xz 编解码，不含 rar，因此 unRAR 附加限制不适用。
      members: ['x64/7za.exe', 'License.txt'],
      entryFile: 'x64/7za.exe',
      output: 'bin/7zz.exe',
      licenses: [{ from: 'License.txt', to: 'licenses/7zip-License.txt' }]
    },
    {
      kind: 'zip-tree',
      name: 'git',
      display: 'Git for Windows (MinGit)',
      version: '2.55.0.5',
      license: 'GPL-2.0-only',
      source: 'https://github.com/git-for-windows/git/tree/v2.55.0.windows.5',
      url: 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/MinGit-2.55.0.5-64-bit.zip',
      archiveSha256: '56d7b226b7693196cfc71fef26568f536c4a021ab6c37ff2db4287bed908e96e',
      treeDir: 'git',
      output: 'git/cmd/git.exe',
      // MinGit 自带许可证文本，整树复制即随附；这里只复制一份到 licenses 便于集中查看
      licenses: [{ from: 'LICENSE.txt', to: 'licenses/git-LICENSE.txt' }],
      // GPLv2 §3(b) 要求随二进制提供书面源码承诺，逐条写进 THIRD-PARTY-NOTICES
      requiresSourceOffer: true
    },
    {
      // MinGit 不带 bash（只有 dash），没有它 Agent 在未装 Git for Windows 的机器上只能用 PowerShell。
      // 从同一版本的完整版 Git for Windows 里取 bash 及 /etc/profile 依赖的 which、locale：
      // 同版本共用一套 msys-2.0.dll，ABI 与 MinGit 树一致；缺 which/locale 会让每条命令多两行报错。
      kind: 'sevenzip-sfx',
      name: 'bash',
      display: 'Bash (Git for Windows)',
      version: '2.55.0.5',
      license: 'GPL-2.0-only',
      source: 'https://github.com/git-for-windows/git/tree/v2.55.0.windows.5',
      url: 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/PortableGit-2.55.0.5-64-bit.7z.exe',
      archiveSha256: '5aa8a20f6e9abb2c755f0e73c91c687701a46b309ad84a0ca6509380fa4ae290',
      members: ['usr/bin/bash.exe', 'usr/bin/which.exe', 'usr/bin/locale.exe'],
      // 补进 MinGit 树内，共用它的 MSYS 运行时，不单独成目录
      into: 'git',
      output: 'git/usr/bin/bash.exe',
      // 与 git 同一发行版、同一许可证，共用已经取下来的那份许可证原文，不重复落盘
      licenseRef: 'licenses/git-LICENSE.txt',
      requiresSourceOffer: true,
      // bash 靠显式路径调用，不进 PATH：把 git/usr/bin 挂上去会让 PowerShell 会话里的
      // find / sort / date 被 MSYS 版本遮蔽。
      pathEntry: false
    }
  ]
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const platformKey = process.env.FASTAGENT_RUNTIME_PLATFORM || `${process.platform}-${process.arch}`
const specs = TOOLS[platformKey]
if (!specs) {
  console.error(`当前平台 ${platformKey} 暂无内置工具链清单；跳过`)
  process.exit(0)
}

const outputDir = join(projectRoot, 'resources', 'runtime', platformKey)
const manifestPath = join(outputDir, 'manifest.json')
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/**
 * Node 的 fetch（undici）不读 HTTP_PROXY / HTTPS_PROXY，代理环境下会直接 ECONNRESET。
 * 设了代理就走 curl（它自己认这些变量），没设才用 fetch。
 */
async function download(url) {
  const proxied = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy)
  if (proxied) {
    const temp = join(tmpdir(), `fastagent-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    const result = spawnSync('curl', ['-fsSL', '--max-time', '300', '-o', temp, url], { stdio: ['ignore', 'inherit', 'inherit'] })
    if (result.status !== 0) throw new Error(`curl 下载失败（退出码 ${result.status}）：${url}`)
    const buffer = readFileSync(temp)
    rmSync(temp, { force: true })
    return buffer
  }
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败：${url} → HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function readManifest() {
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch {
    return null
  }
}

// 已经是目标版本且文件都在就不重复下载：package:win 会反复跑这个脚本。
const existing = readManifest()
const upToDate = existing?.runtimeVersion === RUNTIME_VERSION && specs.every((spec) => {
  const entry = existing.tools?.[spec.name]
  return entry?.version === spec.version && existsSync(join(outputDir, ...spec.output.split('/')))
})
if (upToDate) console.log(`内置工具链已是 ${RUNTIME_VERSION}，跳过下载`)

// 沿用已装版本的清单条目。清单与声明始终重写：只改了元数据（许可证、来源）而工具没变时，
// 早退会让声明僵在旧内容——这类文本正是要跟着元数据走的。
const tools = upToDate ? { ...existing.tools } : {}
for (const spec of upToDate ? [] : specs) {
  console.log(`下载 ${spec.name} ${spec.version} …`)
  let archive
  try {
    archive = await download(spec.url)
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    process.exit(1)
  }
  const actual = sha256(archive)
  if (actual !== spec.archiveSha256) {
    console.error(`${spec.name} 校验失败：期望 ${spec.archiveSha256}，实际 ${actual}`)
    process.exit(1)
  }
  const target = join(outputDir, ...spec.output.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  // 归档内的许可证文本，键是归档内路径；raw 类型没有归档，靠单独的 url 取。
  let archiveFiles = null

  if (spec.kind === 'zip-entry' || spec.kind === 'raw') {
    let binary = archive
    if (spec.kind === 'zip-entry') {
      const files = unzipSync(new Uint8Array(archive))
      archiveFiles = files
      const match = Object.keys(files).find((path) => spec.entry.test(path))
      if (!match) {
        console.error(`${spec.name} 压缩包里没有匹配 ${spec.entry} 的可执行文件`)
        process.exit(1)
      }
      binary = Buffer.from(files[match])
    }
    rmSync(target, { force: true })
    writeFileSync(target, binary)
  } else if (spec.kind === 'zip-tree') {
    const files = unzipSync(new Uint8Array(archive))
    archiveFiles = files
    const treeRoot = join(outputDir, spec.treeDir)
    rmSync(treeRoot, { recursive: true, force: true })
    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith('/')) continue
      const path = join(treeRoot, ...name.split('/'))
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, Buffer.from(content))
    }
    if (!existsSync(target)) {
      console.error(`${spec.name} 解压后缺少 ${spec.output}`)
      process.exit(1)
    }
  } else if (spec.kind === 'sevenzip') {
    // .7z 用 Windows 自带的 bsdtar 解；PATH 上的 tar 可能是读不了 7z 的 GNU tar，走绝对路径。
    const bsdtar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
    const workDir = join(tmpdir(), `fastagent-7z-${Date.now()}`)
    const archivePath = join(workDir, '7z.7z')
    mkdirSync(workDir, { recursive: true })
    writeFileSync(archivePath, archive)
    const extracted = spawnSync(bsdtar, ['-xf', archivePath, '-C', workDir, ...spec.members], { stdio: ['ignore', 'inherit', 'inherit'] })
    if (extracted.status !== 0) {
      console.error(`${spec.name} 解压失败（需要 Windows 自带的 bsdtar：${bsdtar}）`)
      process.exit(1)
    }
    const binary = readFileSync(join(workDir, ...spec.entryFile.split('/')))
    rmSync(target, { force: true })
    writeFileSync(target, binary)
    // bsdtar 解出来的成员直接按归档内路径读，与 zip 分支保持同一套取法
    archiveFiles = Object.fromEntries((spec.members ?? []).map((member) => [member, readFileSync(join(workDir, ...member.split('/')))]))
    rmSync(workDir, { recursive: true, force: true })
  } else if (spec.kind === 'sevenzip-sfx') {
    // 7-Zip 自解压 exe，bsdtar 读不了；用前面已经取下来的 7zz 解，工序自洽不引入外部依赖。
    const sevenZip = join(outputDir, 'bin', '7zz.exe')
    if (!existsSync(sevenZip)) {
      console.error(`${spec.name} 需要先取到 7zz（检查 TOOLS 里的顺序）`)
      process.exit(1)
    }
    const workDir = join(tmpdir(), `fastagent-sfx-${Date.now()}`)
    const archivePath = join(workDir, 'archive.exe')
    mkdirSync(workDir, { recursive: true })
    writeFileSync(archivePath, archive)
    const extracted = spawnSync(sevenZip, ['x', archivePath, `-o${workDir}`, ...spec.members], { stdio: ['ignore', 'ignore', 'inherit'] })
    if (extracted.status !== 0) {
      console.error(`${spec.name} 解压失败（退出码 ${extracted.status}）`)
      process.exit(1)
    }
    for (const member of spec.members) {
      const path = join(outputDir, spec.into, ...member.split('/'))
      mkdirSync(dirname(path), { recursive: true })
      rmSync(path, { force: true })
      writeFileSync(path, readFileSync(join(workDir, ...member.split('/'))))
    }
    rmSync(workDir, { recursive: true, force: true })
  }

  // 许可证随二进制一起分发：MIT / Apache 类要求随附原文与版权声明，GPL / LGPL 同样要求。
  for (const license of spec.licenses ?? []) {
    const licensePath = join(outputDir, ...license.to.split('/'))
    mkdirSync(dirname(licensePath), { recursive: true })
    if (license.url) {
      writeFileSync(licensePath, await download(license.url))
    } else {
      const content = archiveFiles && Object.entries(archiveFiles).find(([path]) => path === license.from || path.endsWith(`/${license.from}`))?.[1]
      if (!content) {
        console.error(`${spec.name} 归档里找不到许可证文件 ${license.from}`)
        process.exit(1)
      }
      writeFileSync(licensePath, Buffer.from(content))
    }
  }

  tools[spec.name] = {
    version: spec.version,
    path: spec.output,
    sha256: sha256(readFileSync(target)),
    ...(spec.pathEntry === false ? { pathEntry: false } : {})
  }
  console.log(`  → ${target}`)
}

writeFileSync(manifestPath, `${JSON.stringify({ runtimeVersion: RUNTIME_VERSION, tools }, null, 2)}\n`, 'utf-8')
console.log(`已输出内置工具链清单到 ${manifestPath}`)

const noticesPath = join(outputDir, 'THIRD-PARTY-NOTICES.md')
writeFileSync(noticesPath, buildNotices(specs), 'utf-8')
console.log(`已输出第三方声明到 ${noticesPath}`)

/**
 * 第三方声明。随二进制分发就要随附许可证与来源，与是否修改过源码、是否使用其源码无关。
 * GPL 二进制额外需要 GPLv2 §3(b) 的书面源码承诺，这里逐条给出上游源码地址与索取方式。
 */
function buildNotices(list) {
  const lines = [
    '# 第三方组件声明',
    '',
    `FastAgent 的内置工具链（Runtime ${RUNTIME_VERSION}，${platformKey}）包含以下独立可执行程序。`,
    '它们以未经修改的原始二进制形式随本产品分发，各自作为独立进程被调用，未与 FastAgent 自身代码链接。',
    '',
    '| 组件 | 版本 | 许可证 | 许可证原文 | 上游源码 |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const spec of list) {
    const files = [...(spec.licenses ?? []).map((license) => license.to), ...(spec.licenseRef ? [spec.licenseRef] : [])]
      .map((path) => `\`${path}\``)
      .join('<br>') || '—'
    lines.push(`| ${spec.display} | ${spec.version} | ${spec.license} | ${files} | ${spec.source} |`)
  }
  const copyleft = list.filter((spec) => spec.requiresSourceOffer)
  if (copyleft.length) {
    lines.push(
      '',
      '## 源码获取（GPL 组件）',
      '',
      ...copyleft.flatMap((spec) => [
        `**${spec.display} ${spec.version}**（${spec.license}）的完整对应源码可从上游获取：`,
        '',
        `- ${spec.source}`,
        ''
      ]),
      '此外，自本产品发布之日起三年内，任何人可按不超过实际分发成本的费用，向下列联系方式索取上述组件的完整对应源码：',
      '',
      '> 联系方式：<待填写：发行方邮箱或工单地址>',
      ''
    )
  }
  lines.push(
    '## 其他',
    '',
    '- Electron 与 Chromium 的第三方声明见随包的 `LICENSES.chromium.html`。',
    '- 本文件由 `scripts/fetch-runtime.mjs` 随工具链一同生成，改动工具清单时会自动更新。',
    ''
  )
  return lines.join('\n')
}
