import { isExternalHttpUrl } from '../../renderer/ai-response/sanitize-url'
import type { GitStatusEntry, GitWorkspaceState, PageQuery, WorkspaceSnapshot } from '../../shared/types'
import { readAgentContextFiles } from '../agent-context'
import { AGENT_INIT_FILE_NAME, buildAgentInitTemplate, detectExistingAgentInitFile } from '../agent-init'
import { createDraft, draftFilePath, isDraftPath, launchConfiguredEditor, readDraft, removeDraft } from '../external-editor'
import { checkoutBranch, createBranch, execGit, listLocalBranches, parsePorcelain, resolveGitWorkspaceState } from '../git'
import { hideQuickWindow, setQuickWindowPinned } from '../quick-window'
import { deleteWorkspaceEntry, listWorkspaceDirectory, readAttachmentImage, readWorkspaceFile, readWorkspaceImage, resolveWorkspaceDirectory, resolveWorkspaceFile, searchWorkspaceFiles, workspaceFileExists } from '../workspace-files'
import { openTerminalAt } from '../open-terminal'
import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 工作区根、项目、文件读写与定位、Git 状态与小窗。 */
export function registerWorkspaceIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('workspace:pick-root', async () => ctx.pickWorkspaceRoot())
  // 传 null / 空串表示离开工作区：不清掉的话新建的快速对话仍然能 @ 到上一个项目的文件。
  handle('workspace:set-root', (_event, path: string | null) => ctx.setWorkspaceRoot(path))
  handle('workspace:init-project', (_event, options: { force?: boolean } = {}) => {
    if (!ctx.workspaceRoot) {
      return { status: 'error', path: '', message: '请先打开一个项目工作区再执行 /init' }
    }
    const existing = detectExistingAgentInitFile(readdirSync(ctx.workspaceRoot))
    if (existing && !options.force) {
      return { status: 'exists', path: join(ctx.workspaceRoot, existing) }
    }
    const target = join(ctx.workspaceRoot, AGENT_INIT_FILE_NAME)
    writeFileSync(target, buildAgentInitTemplate(basename(ctx.workspaceRoot)), 'utf8')
    return { status: 'created', path: target }
  })
  handle('projects:list', () => ctx.store.listProjects(ctx.requireNamespace()))
  handle('projects:list-page', (_event, query: PageQuery = {}) => ctx.store.listProjectsPage(ctx.requireNamespace(), query, Boolean(query.includeArchived)))
  handle('projects:add', (_event, input: { path: string; name?: string }) => {
    const namespace = ctx.requireNamespace()
    const existing = ctx.store.getProjectByPath(namespace, input.path)
    const color = existing?.color ?? (ctx.store.listProjects(namespace).length % 2 === 0 ? 'calm' : 'tech')
    const project = ctx.store.upsertProject(namespace, { id: existing?.id ?? `project-${randomUUID()}`, name: input.name || basename(input.path) || input.path, path: input.path, color })
    const contextFiles = readAgentContextFiles({ projectRoot: input.path }).files
      .filter((file) => file.source === 'project')
      .map((file) => file.name)
    return { ...project, agentContextFiles: contextFiles }
  })
  handle('projects:touch', (_event, id: string) => ctx.store.touchProject(ctx.requireNamespace(), id))
  handle('projects:archive', (_event, id: string) => ctx.store.archiveProject(ctx.requireNamespace(), id))
  handle('projects:remove', (_event, id: string) => ctx.store.removeProject(ctx.requireNamespace(), id))
  handle('shell:open-path', (_event, path: string) => shell.openPath(path))
  // 会话头的「打开终端」：在项目根目录起一个系统终端窗口。目录来自已打开的工作区，
  // 参数数组传给 spawn，不拼 shell 字符串——路径里的空格与 & 都不能变成注入点。
  handle('workspace:open-terminal', async () => {
    if (!ctx.workspaceRoot) return '尚未打开工作区'
    try {
      return await openTerminalAt(ctx.workspaceRoot, spawn as never)
    } catch (error) {
      return error instanceof Error ? error.message : '无法打开终端'
    }
  })
  // Ctrl+G 外部编辑：草稿写入系统临时目录，配置了编辑器就用它打开，否则交给系统默认应用。
  // 窗口重新聚焦时由渲染进程读回回填。
  handle('composer:external-edit-open', (_event, text: string) => {
    const path = draftFilePath()
    createDraft(typeof text === 'string' ? text : '', path)
    if (!launchConfiguredEditor(path, ctx.settings.externalEditorPath, () => void shell.openPath(path))) void shell.openPath(path)
    return { path }
  })
  handle('composer:external-edit-read', (_event, path: string) => {
    if (!isDraftPath(path)) return null
    const content = readDraft(path)
    removeDraft(path)
    return content
  })
  handle('workspace:snapshot', (): WorkspaceSnapshot => ({ rootPath: ctx.workspaceRoot, changes: [] }))
  handle('git:state', async (): Promise<GitWorkspaceState | null> => {
    if (!ctx.workspaceRoot) return null
    try {
      return await resolveGitWorkspaceState(ctx.workspaceRoot)
    } catch (error) {
      // 读取失败降级隐藏，并记录日志便于事后排查（git 缺失/仓库损坏/权限等）。
      console.warn('Failed to resolve Git workspace state', error)
      return null
    }
  })
  handle('git:branches', (): Promise<string[]> => {
    if (!ctx.workspaceRoot) return Promise.resolve([])
    return listLocalBranches(ctx.workspaceRoot)
  })
  handle('git:status', async (): Promise<GitStatusEntry[]> => {
    if (!ctx.workspaceRoot) return []
    const result = await execGit(ctx.workspaceRoot, ['status', '--porcelain'])
    if (result.code !== 0) return []
    return parsePorcelain(result.stdout)
  })
  handle('git:checkout', async (_event, branch: string) => {
    if (!ctx.workspaceRoot) return { ok: false, error: '尚未打开工作区' }
    const result = await checkoutBranch(ctx.workspaceRoot, branch)
    if (result.ok) ctx.broadcastGitChanged()
    return result
  })
  handle('git:create', async (_event, name: string) => {
    if (!ctx.workspaceRoot) return { ok: false, error: '尚未打开工作区' }
    const result = await createBranch(ctx.workspaceRoot, name)
    if (result.ok) ctx.broadcastGitChanged()
    return result
  })
  handle('quick:hide', () => { hideQuickWindow() })
  handle('quick:setPinned', (_event, pinned: boolean) => { setQuickWindowPinned(Boolean(pinned)) })
  handle('workspace:read-file', (_event, path: string) => readWorkspaceFile(ctx.workspaceRoot, path))
  handle('workspace:read-image', (_event, path: string) => readWorkspaceImage(ctx.workspaceRoot, path))
  handle('files:read-image', (_event, path: string) => readAttachmentImage(path))
  handle('files:save-clipboard-image', (_event, dataUrl: string, name: string, type: string) => {
    const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl)
    if (!match) throw new Error('剪贴板图片格式无效')
    const dir = join(ctx.appPaths.attachmentsDir, 'clipboard')
    mkdirSync(dir, { recursive: true })
    const safeExt = extname(name) || `.${type.split('/')[1] || 'png'}`
    const target = join(dir, `${randomUUID()}${safeExt}`)
    writeFileSync(target, Buffer.from(match[1], 'base64'))
    return target
  })
  handle('workspace:list-directory', (_event, path: string) => listWorkspaceDirectory(ctx.workspaceRoot, path))
  handle('workspace:search-files', (_event, query: string) => searchWorkspaceFiles(ctx.workspaceRoot, query))
  // 右键菜单「在资源管理器中显示」：解析到绝对路径后定位文件；目录同样选中定位。
  // 空串表示根目录（文件树根节点），解析到工作区根路径本身；resolveWorkspaceFile 拒绝空串，所以根目录单独走 resolveWorkspaceDirectory。
  const resolveWorkspaceAbsolute = (path: string): string =>
    path ? resolveWorkspaceFile(ctx.workspaceRoot, path) : resolveWorkspaceDirectory(ctx.workspaceRoot, '')
  handle('workspace:reveal', (_event, path: string) => {
    if (!ctx.workspaceRoot) return '尚未打开工作区'
    try {
      shell.showItemInFolder(resolveWorkspaceAbsolute(path))
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : '无法定位文件'
    }
  })
  // 回答里的文件引用在渲染成可点芯片之前先问一次存在性，不存在就当普通文本。
  handle('workspace:exists', (_event, path: string) => workspaceFileExists(ctx.workspaceRoot, path))
  // 右键菜单「复制绝对路径」：与 reveal 同一套解析，空串表示根目录；返回绝对路径字符串供剪贴板写入。
  handle('workspace:absolute-path', (_event, path: string) => {
    if (!ctx.workspaceRoot) return '尚未打开工作区'
    try {
      return resolveWorkspaceAbsolute(path)
    } catch (error) {
      return error instanceof Error ? error.message : '无法解析路径'
    }
  })
  // 右键菜单「用本地应用打开」：解析到绝对路径后交给系统默认应用（文件用默认软件，目录开资源管理器窗口）。
  handle('workspace:open-external', async (_event, path: string) => {
    if (!ctx.workspaceRoot) return '尚未打开工作区'
    try {
      return await shell.openPath(resolveWorkspaceFile(ctx.workspaceRoot, path))
    } catch (error) {
      return error instanceof Error ? error.message : '无法打开'
    }
  })
  // 右键菜单「删除」：路径越界 / 不存在由 deleteWorkspaceEntry 返回错误，不抛异常；
  // 删除成功的文件若已登记为 Artifact，同步移除记录并广播刷新 Artifacts 面板。
  handle('workspace:delete', async (_event, path: string) => {
    const result = await deleteWorkspaceEntry(ctx.workspaceRoot, path)
    if (result.ok && ctx.workspaceRoot) {
      if (ctx.removeArtifactsUnderPath(ctx.requireNamespace(), ctx.workspaceRoot, path)) ctx.mainWindow?.webContents.send('artifacts:changed')
    }
    return result
  })
  // 产物是磁盘文件的登记，文件可能被应用外删掉（资源管理器 / rm / 切分支）。
  // 存在性现算不落库：切回分支文件回来了，条目自己就恢复正常，不需要用户手动收拾。
  handle('shell:open-external', async (_event, url: string) => {
    if (!isExternalHttpUrl(url)) return '仅支持打开 http/https 链接'
    try {
      await shell.openExternal(url)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : '打开链接失败'
    }
  })
}
