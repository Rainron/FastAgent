import { realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { containsPath } from '../workspace-files'
import { rootToken } from './preview-url'

/**
 * 协议主机名 → 工作区根目录。
 * 主机名是根路径的哈希，反查只能靠「已知的根」：显式登记过的（本次运行的 cwd、界面打开的文件），
 * 再加 candidates 现取的项目列表与快速对话目录——重启后界面里的旧卡片照样点得开。
 * 不在这些根里的目录永远解析不出来，渲染进程也就无法借协议读任意路径。
 */
export class PreviewRootRegistry {
  private readonly roots = new Map<string, string>()

  constructor(private readonly candidates: () => Iterable<string | null | undefined> = () => []) {}

  register(root: string): string {
    const token = rootToken(root)
    this.roots.set(token, resolve(root))
    return token
  }

  resolve(token: string): string | null {
    const known = this.roots.get(token)
    if (known) return known
    for (const candidate of this.candidates()) {
      if (candidate && rootToken(candidate) === token) return this.roots.get(this.register(candidate)) ?? null
    }
    return null
  }
}

export type PreviewFileResult = { ok: true; absolutePath: string } | { ok: false; status: 403 | 404 }

/**
 * 把协议里的相对路径落到磁盘文件：目录取其中的 index.html；
 * 先按字符串判越界，再用 realpath 查符号链接逃逸（链接指向根内其他位置是允许的）。
 */
export async function resolvePreviewFile(root: string, relativePath: string): Promise<PreviewFileResult> {
  let absolute = resolve(root, relativePath)
  if (!containsPath(root, absolute)) return { ok: false, status: 403 }
  try {
    let info = await stat(absolute)
    if (info.isDirectory()) {
      absolute = join(absolute, 'index.html')
      info = await stat(absolute)
    }
    if (!info.isFile()) return { ok: false, status: 404 }
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(absolute)])
    if (!containsPath(realRoot, realTarget)) return { ok: false, status: 403 }
    return { ok: true, absolutePath: absolute }
  } catch {
    return { ok: false, status: 404 }
  }
}
