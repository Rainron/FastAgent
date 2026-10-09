import { BrowserWindow, protocol, session, shell, type Session } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PreviewProbeResult, PreviewReadyEvent } from '../../shared/types'
import type { PreviewCaptureOutcome, PreviewHost } from '../agent/tools/preview'
import { resolvePreviewFile, type PreviewRootRegistry } from './preview-files'
import { mimeTypeFor, stripFrameBlockingHeaders } from './preview-http'
import { emptyCaptureLog, pushLimited, type PreviewCaptureLog } from './preview-report'
import { buildPreviewFileUrl, checkLocalPreviewUrl, isLoopbackHttpUrl, parsePreviewFileUrl, PREVIEW_SCHEME } from './preview-url'

/** 离屏检查用的独立会话：cookie、缓存、权限都与主界面隔开。 */
export const PREVIEW_PARTITION = 'fa-preview'

/** 截图视口高度：只截首屏，整页长图既费 token 又难看清。 */
const CAPTURE_HEIGHT = 800
/** 加载总时限；超时仍按当时的样子截图，报告里标注超时。 */
const CAPTURE_TIMEOUT_MS = 15_000
/** 加载完成后再等一会儿，给异步渲染（框架挂载、字体、动画首帧）落地。 */
const SETTLE_MS = 800
/** 同时最多几个离屏窗口；每个都是一个渲染进程，并发多了会把机器拖慢。 */
const MAX_CONCURRENT_CAPTURES = 2

/** 预览页可以拿到的权限：只放行剪贴板写入与全屏，摄像头、定位、通知一律拒绝。 */
const ALLOWED_PREVIEW_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])

/**
 * 必须在 app ready 之前调用。standard 让相对路径按 URL 规则解析（样稿里的 ./style.css 才能加载），
 * secure 让页面拿到安全上下文（crypto.subtle、剪贴板等 API 依赖它）。
 */
export function registerPreviewScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: PREVIEW_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }])
}

export interface PreviewServiceOptions {
  roots: PreviewRootRegistry
  /** 截图目录按会话放在附件目录下：/clear 清会话附件时一并清掉。 */
  screenshotDir: (conversationId: string) => string
  /** 应用自身界面的源（开发态的 Vite 地址）；这些地址不许被预览。 */
  blockedOrigins: () => string[]
  send: (channel: string, payload: unknown) => void
}

interface ActiveCapture {
  log: PreviewCaptureLog
}

/** 预览的 Electron 侧实现：协议、响应头与权限策略、离屏检查、系统浏览器打开。 */
export class PreviewService implements PreviewHost {
  private readonly captures = new Map<number, ActiveCapture>()
  private running = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly options: PreviewServiceOptions) {}

  /** app ready 之后调用一次。 */
  install() {
    const previewSession = session.fromPartition(PREVIEW_PARTITION)
    for (const target of [session.defaultSession, previewSession]) {
      target.protocol.handle(PREVIEW_SCHEME, (request) => this.serve(request.url))
    }
    this.installFrameHeaderPolicy(session.defaultSession)
    this.installPermissionPolicy(session.defaultSession, false)
    this.installPermissionPolicy(previewSession, true)
    this.installRequestTracking(previewSession)
    // 预览页触发的下载一律取消：样稿里的下载链接没有必要真的写到用户磁盘上。
    previewSession.on('will-download', (event) => event.preventDefault())
  }

  fileUrl(root: string, relativePath: string): string {
    return buildPreviewFileUrl(this.options.roots.register(root), relativePath)
  }

  checkUrl(raw: string) {
    return checkLocalPreviewUrl(raw, this.options.blockedOrigins())
  }

  /** fa-preview 地址 → 磁盘上的绝对路径；地址无效、根目录未知或越界时返回 null。 */
  async resolveFileUrl(url: string): Promise<string | null> {
    const parsed = parsePreviewFileUrl(url)
    if (!parsed) return null
    const root = this.options.roots.resolve(parsed.token)
    if (!root) return null
    const file = await resolvePreviewFile(root, parsed.relativePath)
    return file.ok ? file.absolutePath : null
  }

  private async serve(url: string): Promise<Response> {
    const parsed = parsePreviewFileUrl(url)
    const root = parsed ? this.options.roots.resolve(parsed.token) : null
    if (!parsed || !root) return new Response('Not found', { status: 404 })
    const file = await resolvePreviewFile(root, parsed.relativePath)
    if (!file.ok) return new Response(file.status === 403 ? 'Forbidden' : 'Not found', { status: file.status })
    try {
      const body = await readFile(file.absolutePath)
      // no-store：模型改完文件后刷新必须拿到新内容，不能命中缓存。
      return new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': mimeTypeFor(file.absolutePath), 'cache-control': 'no-store' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  }

  /**
   * 不少 dev server 默认带 X-Frame-Options 或 CSP frame-ancestors，iframe 里会直接白屏。
   * 只改本机回环地址、且只改子帧文档的响应；主界面自身与外网页面的响应头一概不动。
   */
  private installFrameHeaderPolicy(target: Session) {
    const urls = ['http://localhost/*', 'https://localhost/*', 'http://127.0.0.1/*', 'https://127.0.0.1/*', 'http://[::1]/*', 'https://[::1]/*']
    target.webRequest.onHeadersReceived({ urls }, (details, callback) => {
      if (details.resourceType !== 'subFrame' || !details.responseHeaders || !isLoopbackHttpUrl(details.url)) {
        callback({})
        return
      }
      callback({ responseHeaders: stripFrameBlockingHeaders(details.responseHeaders) })
    })
  }

  /**
   * 默认会话是主界面自己的：只对来自预览子帧的请求收紧，主界面照旧放行（Electron 默认行为）。
   * 预览会话整个都是预览页，全部按白名单判。
   */
  private installPermissionPolicy(target: Session, previewOnly: boolean) {
    const isPreviewRequest = (url: string, isMainFrame: boolean) => previewOnly || (!isMainFrame && (url.startsWith(`${PREVIEW_SCHEME}:`) || isLoopbackHttpUrl(url)))
    target.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      const requestingUrl = 'requestingUrl' in details ? details.requestingUrl : ''
      const isMainFrame = 'isMainFrame' in details ? details.isMainFrame : true
      callback(isPreviewRequest(requestingUrl ?? '', isMainFrame) ? ALLOWED_PREVIEW_PERMISSIONS.has(permission) : true)
    })
    target.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
      const isMainFrame = details?.isMainFrame ?? true
      return isPreviewRequest(requestingOrigin, isMainFrame) ? ALLOWED_PREVIEW_PERMISSIONS.has(permission) : true
    })
  }

  /** 失败请求按 webContents 分派到对应的检查任务；会话是共享的，监听只挂一次。 */
  private installRequestTracking(target: Session) {
    target.webRequest.onCompleted((details) => {
      if (details.statusCode < 400 || details.webContentsId === undefined) return
      const capture = this.captures.get(details.webContentsId)
      if (capture) pushLimited(capture.log.failedRequests, { url: details.url, status: details.statusCode }, (item) => item.url)
    })
    target.webRequest.onErrorOccurred((details) => {
      // 页面自己中止的请求（导航切换、AbortController）不算失败。
      if (details.error === 'net::ERR_ABORTED' || details.webContentsId === undefined) return
      const capture = this.captures.get(details.webContentsId)
      if (capture) pushLimited(capture.log.failedRequests, { url: details.url, status: null, error: details.error }, (item) => item.url)
    })
  }

  private async acquireSlot(): Promise<void> {
    if (this.running < MAX_CONCURRENT_CAPTURES) {
      this.running += 1
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.running += 1
  }

  private releaseSlot() {
    this.running -= 1
    this.waiting.shift()?.()
  }

  async capture(url: string, options: { width: number; signal?: AbortSignal }): Promise<PreviewCaptureOutcome> {
    await this.acquireSlot()
    try {
      return await this.captureOnce(url, options)
    } finally {
      this.releaseSlot()
    }
  }

  private async captureOnce(url: string, options: { width: number; signal?: AbortSignal }): Promise<PreviewCaptureOutcome> {
    const log = emptyCaptureLog()
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    // offscreen：隐藏窗口在部分系统上 capturePage 会拿到空图，离屏渲染则总有画面。
    const win = new BrowserWindow({
      show: false,
      width: options.width,
      height: CAPTURE_HEIGHT,
      useContentSize: true,
      webPreferences: { partition: PREVIEW_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false }
    })
    const contents = win.webContents
    const id = contents.id
    this.captures.set(id, { log })
    const onAbort = () => { if (!win.isDestroyed()) win.destroy() }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      contents.on('console-message', (details) => {
        if (details.level !== 'error' && details.level !== 'warning') return
        // Electron 自己往页面控制台打的开发期安全提示（source 是 node:electron/…）不是页面的问题，别让模型去「修」它。
        if (details.sourceId?.startsWith('node:electron/')) return
        pushLimited(log.console, { level: details.level, message: details.message, source: details.sourceId || undefined, line: details.lineNumber || undefined }, (item) => `${item.level}:${item.message}`)
      })
      contents.on('did-navigate', (_event, _url, httpResponseCode) => {
        log.httpStatus = httpResponseCode >= 0 ? httpResponseCode : null
      })
      contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
        // -3 是 ERR_ABORTED：页面自己跳转造成的中止，不是加载失败。
        if (!isMainFrame || errorCode === -3) return
        log.status = 'failed'
        log.loadError = `${errorDescription || '加载失败'} (${errorCode})`
      })
      contents.on('render-process-gone', (_event, details) => {
        log.status = 'failed'
        log.loadError = `页面渲染进程退出：${details.reason}`
      })

      let timer: ReturnType<typeof setTimeout> | undefined
      const timedOut = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), CAPTURE_TIMEOUT_MS) })
      const loaded = contents.loadURL(url).then(() => 'loaded' as const, () => 'failed' as const)
      const outcome = await Promise.race([loaded, timedOut])
      clearTimeout(timer)
      if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
      if (outcome === 'timeout' && log.status !== 'failed') log.status = 'timeout'
      if (outcome === 'failed' && log.status !== 'failed') {
        log.status = 'failed'
        log.loadError = log.loadError ?? '页面加载失败'
      }
      // HTTP 层面的错误页（404/500）也算没加载起来：画面上只有一张错误页。
      if (log.httpStatus !== null && log.httpStatus >= 400) log.status = 'failed'
      if (log.status === 'failed' && log.httpStatus === null) return { log, png: null }

      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
      if (win.isDestroyed()) throw new DOMException('已取消', 'AbortError')
      log.title = contents.getTitle()
      // getTitle 在没有 <title> 时返回地址本身，不是真标题。
      if (log.title === url || log.title === contents.getURL()) log.title = ''
      let png: Buffer | null = null
      try {
        const image = await contents.capturePage()
        if (!image.isEmpty()) {
          // 高 DPI 屏上截图是逻辑尺寸的倍数，统一缩回请求宽度，模型看到的尺寸与入参一致。
          const size = image.getSize()
          png = (size.width > options.width ? image.resize({ width: options.width, quality: 'good' }) : image).toPNG()
        }
      } catch (error) {
        console.warn('[preview] 截图失败:', error)
      }
      return { log, png }
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
      this.captures.delete(id)
      if (!win.isDestroyed()) win.destroy()
    }
  }

  saveScreenshot(conversationId: string, toolCallId: string, png: Buffer): string | null {
    // id 来自模型运行时，落盘前只留安全字符，防止拼出目录穿越。
    const safeConversation = conversationId.replace(/[^\w-]/g, '_')
    const safeCall = toolCallId.replace(/[^\w-]/g, '_')
    if (!safeConversation || !safeCall) return null
    try {
      const dir = this.options.screenshotDir(safeConversation)
      mkdirSync(dir, { recursive: true })
      const target = join(dir, `${safeCall}.png`)
      writeFileSync(target, png)
      return target
    } catch (error) {
      console.warn('[preview] 截图落盘失败:', error)
      return null
    }
  }

  /** 对话卡片的缩略图；只读本会话截图目录下的文件。 */
  async readScreenshot(conversationId: string, toolCallId: string): Promise<string | null> {
    const safeConversation = conversationId.replace(/[^\w-]/g, '_')
    const safeCall = toolCallId.replace(/[^\w-]/g, '_')
    if (!safeConversation || !safeCall) return null
    try {
      const buffer = await readFile(join(this.options.screenshotDir(safeConversation), `${safeCall}.png`))
      return `data:image/png;base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  }

  notifyReady(event: PreviewReadyEvent) {
    this.options.send('preview:ready', event)
  }

  /**
   * 交给系统浏览器：file:// 地址只在这里由校验过的绝对路径生成，
   * 渲染进程传来的任何 file:/javascript: 字符串都不会直达 openExternal。
   */
  async openExternal(url: string): Promise<string> {
    try {
      if (url.startsWith(`${PREVIEW_SCHEME}:`)) {
        const absolute = await this.resolveFileUrl(url)
        if (!absolute) return '预览文件不存在或不在工作区内'
        await shell.openExternal(pathToFileURL(absolute).href)
        return ''
      }
      const checked = this.checkUrl(url)
      if (!checked.ok) return checked.error
      await shell.openExternal(checked.url)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : '无法在浏览器中打开'
    }
  }

  /** 右栏载入前先探一次：连不上时给明确提示，而不是让 iframe 白屏。 */
  async probe(url: string): Promise<PreviewProbeResult> {
    if (url.startsWith(`${PREVIEW_SCHEME}:`)) return (await this.resolveFileUrl(url)) ? { ok: true } : { ok: false, error: '预览文件不存在或已被删除' }
    const checked = this.checkUrl(url)
    if (!checked.ok) return { ok: false, error: checked.error }
    try {
      // 走 Chromium 网络栈而不是 Node fetch：主进程给 Node 装了出网代理，本机地址经代理会被转丢；
      // Chromium 默认对回环地址直连，和 iframe 实际加载时的路径一致。
      const response = await session.fromPartition(PREVIEW_PARTITION).fetch(checked.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(3000) })
      await response.body?.cancel().catch(() => undefined)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/CONNECTION_REFUSED|ECONNREFUSED/i.test(message)) return { ok: false, error: '服务未启动或端口不对（连接被拒绝）' }
      if ((error as Error)?.name === 'TimeoutError' || /timed? ?out/i.test(message)) return { ok: false, error: '服务无响应（3 秒超时）' }
      return { ok: false, error: message || '无法连接预览地址' }
    }
  }
}
