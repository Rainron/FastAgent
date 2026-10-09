import { describe, expect, it } from 'vitest'
import type { PreviewToolDetails } from '../../shared/types'
import { previewBadges, readPreviewDetails } from './preview-card'

function details(patch: Partial<PreviewToolDetails> = {}): PreviewToolDetails {
  return {
    target: { url: 'fa-preview://w-0123456789abcdef/a/index.html', title: 'Demo', path: 'a/index.html' },
    status: 'ok',
    httpStatus: 200,
    errorCount: 0,
    warningCount: 0,
    failedRequestCount: 0,
    screenshotPath: 'C:/data/shot.png',
    ...patch
  }
}

describe('readPreviewDetails', () => {
  it('取出完整摘要', () => {
    expect(readPreviewDetails({ summary: 'x', preview: details() })).toEqual(details())
  })

  it('缺结果、缺预览、缺地址都当没有', () => {
    expect(readPreviewDetails(null)).toBeNull()
    expect(readPreviewDetails({ summary: 'x' })).toBeNull()
    expect(readPreviewDetails({ preview: { target: { title: 'x' } } })).toBeNull()
  })

  it('脏字段归一：未知状态按正常、负数计数归零', () => {
    const parsed = readPreviewDetails({ preview: { target: { url: 'http://localhost:3000/' }, status: 'weird', errorCount: -2, warningCount: 'many' } })
    expect(parsed).toMatchObject({ status: 'ok', errorCount: 0, warningCount: 0, screenshotPath: null, target: { title: '', path: null } })
  })
})

describe('previewBadges', () => {
  it('没问题只给一个正常角标', () => {
    expect(previewBadges(details())).toEqual([{ tone: 'ok', label: '渲染正常' }])
  })

  it('逐类列出问题，失败带 HTTP 状态', () => {
    const badges = previewBadges(details({ status: 'failed', httpStatus: 404, errorCount: 2, failedRequestCount: 1, warningCount: 3 }))
    expect(badges.map((badge) => badge.label)).toEqual(['加载失败 · HTTP 404', '2 个错误', '1 个请求失败', '3 个警告'])
  })

  it('超时单独标注', () => {
    expect(previewBadges(details({ status: 'timeout' }))[0]).toEqual({ tone: 'warn', label: '加载超时' })
  })
})
