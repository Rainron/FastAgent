import type { TerminalCreateOptions } from '../../shared/types'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 会话 id 来自主进程自己发的 uuid，这里只挡住空值与非字符串。 */
function requireId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) throw new Error('终端会话 id 无效')
  return id
}

export function registerTerminalIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('terminal:list', () => ctx.terminalManager.list())
  // cwd 不接受渲染进程指定：终端一律开在当前工作区，路径由主进程说了算。
  handle('terminal:create', (_event, options: TerminalCreateOptions | undefined) =>
    ctx.terminalManager.create({ cwd: ctx.workspaceRoot, cols: options?.cols, rows: options?.rows }))
  handle('terminal:attach', (_event, id: unknown) => ctx.terminalManager.attach(requireId(id)))
  handle('terminal:write', (_event, id: unknown, data: unknown) => {
    if (typeof data !== 'string') throw new Error('终端输入无效')
    ctx.terminalManager.write(requireId(id), data)
  })
  handle('terminal:resize', (_event, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof cols !== 'number' || typeof rows !== 'number') throw new Error('终端尺寸无效')
    ctx.terminalManager.resize(requireId(id), cols, rows)
  })
  handle('terminal:close', (_event, id: unknown) => ctx.terminalManager.close(requireId(id)))
}
