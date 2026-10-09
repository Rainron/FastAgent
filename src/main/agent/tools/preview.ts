import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { existsSync, statSync } from 'node:fs'
import type { PreviewReadyEvent, PreviewTarget, PreviewToolDetails } from '../../../shared/types'
import { resolveToolPath } from '../safety/workspace-guard'
import { normalizeWorkspaceRelative } from '../../workspace-files'
import { consoleCounts, formatPreviewReport, type PreviewCaptureLog } from '../../preview/preview-report'
import { isPreviewablePath } from '../../preview/preview-url'
import { ensureGitExcluded, PREVIEW_SCRATCH_DIR } from '../../preview/git-exclude'

/**
 * 页面预览工具。
 *
 * 模型写好 HTML 样稿或起好 dev server 之后调用：界面在右侧面板打开实时预览，
 * 同时主进程在离屏窗口里加载一次，把控制台错误、失败请求和截图交回给模型自查。
 * Electron 相关能力全部经 PreviewHost 注入，工具本身不认识窗口与协议。
 */

export const PREVIEW_TOOL_NAME = 'preview_show'

export const DEFAULT_PREVIEW_WIDTH = 1280
export const MIN_PREVIEW_WIDTH = 320
export const MAX_PREVIEW_WIDTH = 2560

export interface PreviewCaptureOutcome {
  log: PreviewCaptureLog
  /** PNG 截图；截图失败为 null。 */
  png: Buffer | null
}

/** 主进程提供的预览能力；领域层只依赖这个接口。 */
export interface PreviewHost {
  /** 登记工作区根并返回该文件的 fa-preview 地址。 */
  fileUrl(root: string, relativePath: string): string
  /** dev server 地址校验（只放行本机回环、拒绝应用自身的界面源）。 */
  checkUrl(raw: string): { ok: true; url: string } | { ok: false; error: string }
  capture(url: string, options: { width: number; signal?: AbortSignal }): Promise<PreviewCaptureOutcome>
  /** 截图落盘，返回绝对路径；失败返回 null。 */
  saveScreenshot(conversationId: string, toolCallId: string, png: Buffer): string | null
  notifyReady(event: PreviewReadyEvent): void
}

export interface PreviewToolContext {
  cwd: string
  conversationId: string
  host: PreviewHost | null
}

export interface PreviewToolOptions {
  /** 每次调用现取：cwd 与会话随轮次变化，捕获首轮闭包会把预览开到旧会话上。 */
  resolveContext: () => PreviewToolContext
}

export type PreviewInput = { kind: 'path'; path: string; width: number; title: string } | { kind: 'url'; url: string; width: number; title: string }

/** 入参归一：path / url 二选一，宽度夹在合法范围内。 */
export function normalizePreviewInput(params: { path?: string; url?: string; title?: string; width?: number }): { ok: true; input: PreviewInput } | { ok: false; error: string } {
  const path = params.path?.trim() ?? ''
  const url = params.url?.trim() ?? ''
  if (path && url) return { ok: false, error: 'path 与 url 只能填一个' }
  if (!path && !url) return { ok: false, error: '需要提供 path（工作区内的 HTML 文件）或 url（本机 dev server 地址）' }
  const width = typeof params.width === 'number' && Number.isFinite(params.width)
    ? Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, Math.round(params.width)))
    : DEFAULT_PREVIEW_WIDTH
  const title = params.title?.trim() ?? ''
  return { ok: true, input: path ? { kind: 'path', path, width, title } : { kind: 'url', url, width, title } }
}

/** 没给标题且页面也没有 <title> 时：文件用路径（index.html 取所在目录名），地址用 host:port。 */
export function fallbackPreviewTitle(target: { path: string | null; url: string }): string {
  if (target.path) {
    const segments = target.path.split('/').filter(Boolean)
    const name = segments.pop() ?? target.path
    return /^index\.html?$/i.test(name) && segments.length ? segments.pop() as string : name
  }
  try {
    return new URL(target.url).host
  } catch {
    return target.url
  }
}

type PreviewToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  details: PreviewToolDetails | null
  isError?: boolean
}

function failure(text: string): PreviewToolResult {
  return { content: [{ type: 'text', text }], details: null, isError: true }
}

/** 把入参解析成可载入的目标；工作区外、不存在、不是网页的文件在这里拒绝。 */
function resolveTarget(input: PreviewInput, context: PreviewToolContext, host: PreviewHost): { ok: true; target: PreviewTarget } | { ok: false; error: string } {
  if (input.kind === 'url') {
    const checked = host.checkUrl(input.url)
    if (!checked.ok) return checked
    return { ok: true, target: { url: checked.url, title: input.title, path: null } }
  }
  const resolved = resolveToolPath(input.path, context.cwd)
  if (resolved.external) return { ok: false, error: `只能预览工作区内的文件：${input.path}` }
  let relative = normalizeWorkspaceRelative(resolved.relativePath)
  if (!existsSync(resolved.absolutePath)) return { ok: false, error: `文件不存在：${input.path}。先用 write 写好页面再预览。` }
  if (statSync(resolved.absolutePath).isDirectory()) {
    relative = relative ? `${relative}/index.html` : 'index.html'
    if (!existsSync(`${resolved.absolutePath}/index.html`)) return { ok: false, error: `目录里没有 index.html：${input.path}` }
  }
  if (!isPreviewablePath(relative)) return { ok: false, error: `只能预览 .html / .htm / .svg 文件：${input.path}` }
  // 样稿目录不该出现在用户的 Git 改动里：第一次用到时写进本机私有的 exclude。
  if (relative.startsWith(`${PREVIEW_SCRATCH_DIR}/`)) ensureGitExcluded(context.cwd)
  return { ok: true, target: { url: host.fileUrl(context.cwd, relative), title: input.title, path: relative } }
}

export function createPreviewTool(options: PreviewToolOptions): ToolDefinition {
  return defineTool({
    name: PREVIEW_TOOL_NAME,
    label: 'Preview page',
    description: '在用户的预览面板中打开网页并做一次渲染检查：path 预览工作区内的 HTML/SVG 文件（相对路径的 css/js/图片都能加载），url 预览本机 dev server（仅 localhost）。返回加载状态、控制台错误、失败请求和一张截图。',
    promptSnippet: 'Render an HTML file or local dev server in the user\'s preview panel and get errors plus a screenshot back',
    promptGuidelines: [
      `Throwaway mockups and demos go to ${PREVIEW_SCRATCH_DIR}/<name>/index.html; pages that belong to the project stay in the project.`,
      'For a dev server, start it with shell_background, confirm the port with shell_background_output, then call preview_show with the url.',
      'After editing a previewed page, call preview_show again to verify; fix reported console errors and failed requests before finishing.'
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: '工作区内的 .html/.htm/.svg 文件，或含 index.html 的目录；与 url 二选一' })),
      url: Type.Optional(Type.String({ description: '本机 dev server 地址，如 http://localhost:5173；与 path 二选一' })),
      title: Type.Optional(Type.String({ description: '卡片标题；省略时用页面 <title>' })),
      width: Type.Optional(Type.Number({ description: `截图视口宽度，默认 ${DEFAULT_PREVIEW_WIDTH}，范围 ${MIN_PREVIEW_WIDTH}-${MAX_PREVIEW_WIDTH}` }))
    }),
    async execute(toolCallId, params, signal): Promise<PreviewToolResult> {
      const context = options.resolveContext()
      const host = context.host
      if (!host) return failure('预览功能当前不可用')
      const normalized = normalizePreviewInput(params)
      if (!normalized.ok) return failure(normalized.error)
      const resolved = resolveTarget(normalized.input, context, host)
      if (!resolved.ok) return failure(resolved.error)
      const target = resolved.target

      const { log, png } = await host.capture(target.url, { width: normalized.input.width, signal })
      const screenshotPath = png ? host.saveScreenshot(context.conversationId, toolCallId, png) : null
      const finalTarget: PreviewTarget = { ...target, title: target.title || log.title.trim() || fallbackPreviewTitle(target) }
      const counts = consoleCounts(log)
      const details: PreviewToolDetails = {
        target: finalTarget,
        status: log.status,
        httpStatus: log.httpStatus,
        errorCount: counts.errors,
        warningCount: counts.warnings,
        failedRequestCount: log.failedRequests.length,
        screenshotPath
      }
      // 页面彻底没加载起来就不去抢用户的右栏：打开也只是一张错误页。
      if (log.status !== 'failed') host.notifyReady({ conversationId: context.conversationId, toolCallId, target: finalTarget })
      const label = finalTarget.path ?? finalTarget.url
      const content: PreviewToolResult['content'] = [{ type: 'text', text: formatPreviewReport(log, label, Boolean(png)) }]
      if (png) content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' })
      return { content, details, ...(log.status === 'failed' ? { isError: true } : {}) }
    }
  })
}
