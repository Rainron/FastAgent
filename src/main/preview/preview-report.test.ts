import { describe, expect, it } from 'vitest'
import { consoleCounts, emptyCaptureLog, formatPreviewReport, MAX_REPORT_ENTRIES, MAX_REPORT_MESSAGE, pushLimited } from './preview-report'

describe('pushLimited', () => {
  it('去重并限量', () => {
    const list: string[] = []
    expect(pushLimited(list, 'a', (item) => item)).toBe(true)
    expect(pushLimited(list, 'a', (item) => item)).toBe(false)
    for (let index = 0; index < MAX_REPORT_ENTRIES * 2; index += 1) pushLimited(list, `x${index}`, (item) => item)
    expect(list).toHaveLength(MAX_REPORT_ENTRIES)
  })
})

describe('formatPreviewReport', () => {
  it('没有问题时给出明确结论', () => {
    const log = { ...emptyCaptureLog(), httpStatus: 200, title: 'Demo' }
    const text = formatPreviewReport(log, 'a/index.html', true)
    expect(text).toContain('状态：加载完成 · HTTP 200')
    expect(text).toContain('页面标题：Demo')
    expect(text).toContain('0 个错误，0 个警告；失败请求 0 个')
    expect(text).toContain('截图已附上')
    expect(text).toContain('没有发现错误')
  })

  it('列出错误与失败请求，并提示修复后复查', () => {
    const log = emptyCaptureLog()
    log.console.push({ level: 'error', message: 'Uncaught ReferenceError: foo is not defined', source: 'fa-preview://w-1/app.js', line: 3 })
    log.console.push({ level: 'warning', message: 'deprecated' })
    log.failedRequests.push({ url: 'fa-preview://w-1/missing.css', status: 404 })
    log.failedRequests.push({ url: 'https://cdn.test/x.js', status: null, error: 'net::ERR_NAME_NOT_RESOLVED' })
    const text = formatPreviewReport(log, 'a/index.html', false)
    expect(text).toContain('- [error] Uncaught ReferenceError: foo is not defined (fa-preview://w-1/app.js:3)')
    expect(text).toContain('- 404 fa-preview://w-1/missing.css')
    expect(text).toContain('- 网络错误 https://cdn.test/x.js（net::ERR_NAME_NOT_RESOLVED）')
    expect(text).toContain('未能生成截图')
    expect(text).toContain('修复后再调用 preview_show')
    expect(consoleCounts(log)).toEqual({ errors: 1, warnings: 1 })
  })

  it('超长消息截断、换行压平', () => {
    const log = emptyCaptureLog()
    log.console.push({ level: 'error', message: `line1\n${'x'.repeat(MAX_REPORT_MESSAGE * 2)}` })
    const line = formatPreviewReport(log, 'p', false).split('\n').find((item) => item.startsWith('- [error]')) as string
    expect(line).not.toContain('\n')
    expect(line.endsWith('…')).toBe(true)
    expect(line.length).toBeLessThan(MAX_REPORT_MESSAGE + 20)
  })

  it('失败与超时的状态文案', () => {
    expect(formatPreviewReport({ ...emptyCaptureLog(), status: 'failed', loadError: 'ERR_CONNECTION_REFUSED (-102)' }, 'http://localhost:3000/', false)).toContain('状态：加载失败')
    expect(formatPreviewReport({ ...emptyCaptureLog(), status: 'timeout' }, 'p', true)).toContain('加载超时')
  })
})
