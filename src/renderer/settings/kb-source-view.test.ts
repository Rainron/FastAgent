import { describe, expect, it } from 'vitest'
import type { KbIndexResult, KbSource, KbSourcePreview } from '../../shared/types'
import { describeIndexResult, describePreview, describeSource, describeUnlink, entryOrigin, pickKbProject, recallEmptyReason, sourceStatusLabel, sourceStatusTone } from './kb-source-view'

function source(patch: Partial<KbSource> = {}): KbSource {
  return { id: 's1', projectId: 'p1', kind: 'directory', path: 'K:/repo/docs', title: 'docs', status: 'indexed', error: null, fileCount: 3, entryCount: 12, excludes: [], version: 2, createdAt: 1, updatedAt: 2, ...patch }
}

describe('sourceStatusLabel / Tone', () => {
  it('四种状态各有中文标签', () => {
    expect(['indexing', 'indexed', 'failed', 'stale'].map((status) => sourceStatusLabel({ status } as KbSource))).toEqual(['索引中', '已索引', '索引失败', '来源已失效'])
  })

  it('失败是危险色，失效是警示色，其余正常', () => {
    expect(sourceStatusTone({ status: 'failed' })).toBe('danger')
    expect(sourceStatusTone({ status: 'stale' })).toBe('warn')
    expect(sourceStatusTone({ status: 'indexed' })).toBe('ok')
    expect(sourceStatusTone({ status: 'indexing' })).toBe('ok')
  })
})

describe('describeSource', () => {
  it('正常来源给出文件数、条目数与版本', () => {
    expect(describeSource(source())).toBe('3 个文件 · 12 条 · v2')
  })

  it('还没索引过时不显示版本号', () => {
    expect(describeSource(source({ version: 0 }))).toBe('3 个文件 · 12 条')
  })

  it('失效来源明说条目已停止参与检索', () => {
    expect(describeSource(source({ status: 'stale' }))).toContain('停止参与检索')
  })
})

describe('describePreview', () => {
  function preview(patch: Partial<KbSourcePreview> = {}): KbSourcePreview {
    return { path: 'K:/repo/docs', kind: 'directory', files: [{ path: 'a.md', size: 1, kind: 'markdown' }], skipped: [], truncated: false, ...patch }
  }

  it('只有候选文件时只报索引数', () => {
    expect(describePreview(preview())).toBe('将索引 1 个文件')
  })

  it('跳过与截断都要如实说明', () => {
    const text = describePreview(preview({ skipped: [{ reason: 'unsupported', label: '格式暂不支持', count: 4 }], truncated: true }))
    expect(text).toBe('将索引 1 个文件 · 跳过 4 个 · 已达文件数上限，超出部分未纳入')
  })
})

describe('describeIndexResult', () => {
  function result(patch: Partial<KbIndexResult> = {}): KbIndexResult {
    return { source: source(), indexedFiles: 2, unchangedFiles: 1, removedFiles: 0, entryCount: 12, failures: [], ...patch }
  }

  it('分别报新索引、未变化与总条目数', () => {
    expect(describeIndexResult(result())).toBe('索引 2 个文件，1 个未变化；当前共 12 条')
  })

  it('部分失败不被说成全部成功', () => {
    expect(describeIndexResult(result({ failures: [{ path: 'bad.pdf', error: 'x' }] }))).toContain('1 个失败')
  })

  it('没有可索引文件时如实说明', () => {
    expect(describeIndexResult(result({ indexedFiles: 0, unchangedFiles: 0, entryCount: 0 }))).toBe('没有可索引的文件；当前共 0 条')
  })

  it('来源失效时只说失效', () => {
    expect(describeIndexResult(result({ source: source({ status: 'stale' }) }))).toContain('停止参与检索')
  })
})

describe('entryOrigin', () => {
  it('有文件与定位时拼在一起，手工条目为空串', () => {
    expect(entryOrigin({ sourcePath: 'docs/a.md', locator: 'L3-9' })).toBe('docs/a.md L3-9')
    expect(entryOrigin({ sourcePath: 'docs/a.md', locator: null })).toBe('docs/a.md')
    expect(entryOrigin({})).toBe('')
  })
})

describe('pickKbProject', () => {
  it('已选项目仍在就保留', () => {
    expect(pickKbProject(['p1', 'p2'], 'p2', 'p1')).toBe('p2')
  })
  it('首次打开优先当前项目，其次列表第一个', () => {
    expect(pickKbProject(['p1', 'p2'], '', 'p2')).toBe('p2')
    expect(pickKbProject(['p1', 'p2'], '', 'gone')).toBe('p1')
    expect(pickKbProject(['p1', 'p2'], '', null)).toBe('p1')
    expect(pickKbProject([], '', 'p1')).toBe('')
  })
})

describe('describeUnlink', () => {
  it('说清连带删除的条目数', () => {
    expect(describeUnlink({ title: 'docs', entryCount: 12 })).toContain('12 个条目')
  })
})

describe('recallEmptyReason', () => {
  const on = { memoryEnabled: true, knowledgeEnabled: true }
  it('开关关着时先说开关', () => {
    expect(recallEmptyReason('memory', { ...on, memoryEnabled: false }, 'p1')).toContain('已关闭')
    expect(recallEmptyReason('knowledge', { ...on, knowledgeEnabled: false }, 'p1')).toContain('已关闭')
  })
  it('没选项目时说明知识库只在项目里生效', () => {
    expect(recallEmptyReason('knowledge', on, null)).toContain('请选择项目')
  })
  it('都具备时才是没匹配上', () => {
    expect(recallEmptyReason('memory', on, null)).toBe('没有命中的记忆')
    expect(recallEmptyReason('knowledge', on, 'p1')).toBe('没有命中的知识条目')
  })
})

