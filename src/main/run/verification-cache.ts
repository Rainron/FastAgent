import { detectVerificationCommands, readWorkspaceManifests, type VerificationCommand } from '../agent/verification'

/**
 * 验证命令按工作区缓存：探测要读四个清单文件，而每轮 run 都会问一次。
 * 清单文件在会话进行中几乎不变，缓存到进程生命周期即可；改了 package.json 需要重开应用，
 * 这个代价远小于每轮四次同步读盘顶在 IPC 前面。
 */
const verificationCache = new Map<string, VerificationCommand[]>()

export function verificationCommandsFor(root: string | null): VerificationCommand[] {
  if (!root) return []
  const cached = verificationCache.get(root)
  if (cached) return cached
  try {
    const manifests = readWorkspaceManifests(root)
    const commands = detectVerificationCommands(manifests, manifests.packageManager)
    verificationCache.set(root, commands)
    return commands
  } catch (error) {
    console.error('[verification] 探测验证命令失败:', error)
    return []
  }
}
