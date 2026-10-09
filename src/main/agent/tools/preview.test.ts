import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PreviewReadyEvent } from '../../../shared/types'
import { emptyCaptureLog } from '../../preview/preview-report'
import { checkLocalPreviewUrl } from '../../preview/preview-url'
import { createPreviewTool, DEFAULT_PREVIEW_WIDTH, fallbackPreviewTitle, MAX_PREVIEW_WIDTH, MIN_PREVIEW_WIDTH, normalizePreviewInput, type PreviewHost } from './preview'

describe('normalizePreviewInput', () => {
  it('path 与 url 必须二选一', () => {
    expect(normalizePreviewInput({}).ok).toBe(false)
    expect(normalizePreviewInput({ path: 'a.html', url: 'http://localhost:3000' }).ok).toBe(false)
    expect(normalizePreviewInput({ path: '  ', url: '' }).ok).toBe(false)
  })

  it('宽度缺省取默认，越界夹住', () => {
    expect(normalizePreviewInput({ path: 'a.html' })).toEqual({ ok: true, input: { kind: 'path', path: 'a.html', width: DEFAULT_PREVIEW_WIDTH, title: '' } })
    expect(normalizePreviewInput({ url: 'http://localhost:1', width: 99999 })).toMatchObject({ ok: true, input: { width: MAX_PREVIEW_WIDTH } })
    expect(normalizePreviewInput({ url: 'http://localhost:1', width: 10 })).toMatchObject({ ok: true, input: { width: MIN_PREVIEW_WIDTH } })
  })
})

describe('fallbackPreviewTitle', () => {
  it('index.html 取所在目录名，其余取文件名', () => {
    expect(fallbackPreviewTitle({ path: '.fastagent/previews/landing/index.html', url: '' })).toBe('landing')
    expect(fallbackPreviewTitle({ path: 'index.html', url: '' })).toBe('index.html')
    expect(fallbackPreviewTitle({ path: 'docs/about.html', url: '' })).toBe('about.html')
  })

  it('地址取 host:port', () => {
    expect(fallbackPreviewTitle({ path: null, url: 'http://localhost:5173/app' })).toBe('localhost:5173')
  })
})

describe('preview_show 执行', () => {
  let root: string
  let ready: PreviewReadyEvent[]
  let captured: string[]

  function host(overrides: Partial<PreviewHost> = {}): PreviewHost {
    return {
      fileUrl: (_root, relative) => `fa-preview://w-0123456789abcdef/${relative}`,
      checkUrl: (raw) => checkLocalPreviewUrl(raw),
      capture: async (url) => {
        captured.push(url)
        return { log: { ...emptyCaptureLog(), httpStatus: 200, title: 'Landing' }, png: Buffer.from('png') }
      },
      saveScreenshot: () => 'C:/shots/call-1.png',
      notifyReady: (event) => { ready.push(event) },
      ...overrides
    }
  }

  // defineTool 的返回类型不带 isError，但 pi 会读它；测试按工具实际返回的形状断言。
  type RunResult = { content: Array<Record<string, unknown>>; details: unknown; isError?: boolean }
  async function run(params: Record<string, unknown>, previewHost: PreviewHost | null = host()): Promise<RunResult> {
    const tool = createPreviewTool({ resolveContext: () => ({ cwd: root, conversationId: 'conv-1', host: previewHost }) })
    return await tool.execute('call-1', params as never, undefined, undefined, undefined as never) as unknown as RunResult
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fa-preview-tool-'))
    mkdirSync(join(root, 'site'), { recursive: true })
    writeFileSync(join(root, 'site', 'index.html'), '<title>x</title>')
    writeFileSync(join(root, 'main.ts'), '')
    ready = []
    captured = []
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('预览工作区文件：返回报告、截图与结构化摘要，并通知界面打开', async () => {
    const result = await run({ path: 'site/index.html' })
    expect(result.isError).toBeFalsy()
    expect(captured).toEqual(['fa-preview://w-0123456789abcdef/site/index.html'])
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(result.content[1]).toEqual({ type: 'image', data: Buffer.from('png').toString('base64'), mimeType: 'image/png' })
    expect(result.details).toMatchObject({ status: 'ok', httpStatus: 200, screenshotPath: 'C:/shots/call-1.png', target: { title: 'Landing', path: 'site/index.html' } })
    expect(ready).toEqual([{ conversationId: 'conv-1', toolCallId: 'call-1', target: { url: captured[0], title: 'Landing', path: 'site/index.html' } }])
  })

  it('目录自动取 index.html', async () => {
    const result = await run({ path: 'site' })
    expect(result.details).toMatchObject({ target: { path: 'site/index.html' } })
  })

  it('不存在、非网页、越界的文件直接报错，不做离屏加载', async () => {
    expect((await run({ path: 'nope.html' })).isError).toBe(true)
    expect((await run({ path: 'main.ts' })).isError).toBe(true)
    expect((await run({ path: '../outside.html' })).isError).toBe(true)
    expect(captured).toEqual([])
    expect(ready).toEqual([])
  })

  it('非本机地址被拒', async () => {
    const result = await run({ url: 'https://example.com' })
    expect(result.isError).toBe(true)
    expect(captured).toEqual([])
  })

  it('页面没加载起来：标记失败、不抢右栏', async () => {
    const result = await run({ url: 'http://localhost:3999' }, host({ capture: async () => ({ log: { ...emptyCaptureLog(), status: 'failed', loadError: 'ERR_CONNECTION_REFUSED (-102)' }, png: null }) }))
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ status: 'failed', screenshotPath: null, target: { title: 'localhost:3999' } })
    expect(result.content).toHaveLength(1)
    expect(ready).toEqual([])
  })

  it('宿主不可用时返回错误', async () => {
    expect((await run({ path: 'site/index.html' }, null)).isError).toBe(true)
  })
})
