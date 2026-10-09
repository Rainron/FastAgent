import { describe, expect, it } from 'vitest'
import { affectsPreview, isHtmlPath, isSamePreviewPath, normalizePreviewPath, previewSubtitle } from './preview-target'

describe('preview-target', () => {
  it('路径归一：反斜杠、./、空段', () => {
    expect(normalizePreviewPath('.\\a\\\\b/./index.html')).toBe('a/b/index.html')
  })

  it('同一文件不同写法视为相同', () => {
    expect(isSamePreviewPath('./Docs/index.html', 'docs\\index.html')).toBe(true)
    expect(isSamePreviewPath(null, 'a.html')).toBe(false)
  })

  it('同目录下的资源改动触发刷新，别的目录不触发', () => {
    const page = '.fastagent/previews/demo/index.html'
    expect(affectsPreview(page, '.fastagent/previews/demo/style.css')).toBe(true)
    expect(affectsPreview(page, '.fastagent/previews/demo/assets/app.js')).toBe(true)
    expect(affectsPreview(page, '.fastagent/previews/other/index.html')).toBe(false)
    expect(affectsPreview(page, '.fastagent/previews/demo-2/style.css')).toBe(false)
  })

  it('根目录页面只在自身改动时刷新', () => {
    expect(affectsPreview('index.html', 'index.html')).toBe(true)
    expect(affectsPreview('index.html', 'src/main.ts')).toBe(false)
  })

  it('副标题', () => {
    expect(previewSubtitle({ url: 'fa-preview://w-1/a.html', path: 'a.html' })).toBe('a.html')
    expect(previewSubtitle({ url: 'http://localhost:5173/', path: null })).toBe('localhost:5173')
  })

  it('只有 html/htm 走渲染视图', () => {
    expect(isHtmlPath('a/INDEX.HTM')).toBe(true)
    expect(isHtmlPath('a.svg')).toBe(false)
  })
})
