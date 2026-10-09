import { describe, expect, it } from 'vitest'
import type { DshPluginRecord, DshSearchHit } from '../../../shared/types'
import { activationBadge, activationTools, countActiveTools, filterPlugins, hitState, installNotice, pluginStats, presentActivation, presentCompat, sortHits } from './plugin-view'

function plugin(overrides: Partial<DshPluginRecord> = {}): DshPluginRecord {
  return {
    name: 'demo-plugin',
    version: '1.0.0',
    displayName: 'demo-plugin',
    description: '演示插件',
    installPath: '/plugins/demo-plugin',
    mainEntry: 'lib/index.js',
    enabled: true,
    inject: ['tools'],
    config: {},
    installedAt: '2026-09-11T00:00:00.000Z',
    activation: null,
    ...overrides
  }
}

const activeActivation = {
  status: 'active' as const,
  tools: [
    { name: 'demo_greet', description: '', parameters: {} },
    { name: 'demo_bye', description: '', parameters: {} }
  ]
}

describe('presentActivation', () => {
  it('有工具因重名未接入时提示是哪几个，并计入需要处理', () => {
    const conflicted = plugin({ activation: { ...activeActivation, conflicts: ['bash'] } })
    expect(presentActivation(conflicted)).toEqual({ tone: 'warn', label: '已激活 · 2 个工具', detail: 'bash 与内置工具或其他插件重名，未接入对话' })
    expect(pluginStats([conflicted]).attention).toBe(1)
  })
  it('停用的插件不看挂载结果', () => {
    expect(presentActivation(plugin({ enabled: false, activation: activeActivation }))).toEqual({ tone: 'idle', label: '已停用' })
  })

  it('启用但还没挂过是待挂载', () => {
    expect(presentActivation(plugin({ activation: null }))).toEqual({ tone: 'idle', label: '待挂载' })
  })

  it('激活成功时报出工具数', () => {
    expect(presentActivation(plugin({ activation: activeActivation }))).toEqual({ tone: 'ok', label: '已激活 · 2 个工具' })
  })

  it('缺 seam 的未激活说明缺的是哪几个，且不判成错误', () => {
    const result = presentActivation(plugin({ activation: { status: 'inactive', missingServices: ['llm', 'sessions'] } }))
    expect(result.tone).toBe('warn')
    expect(result.label).toBe('未激活')
    expect(result.detail).toContain('llm、sessions')
  })

  it('加载失败带上原始信息', () => {
    const result = presentActivation(plugin({ activation: { status: 'failed', message: 'boom' } }))
    expect(result.tone).toBe('error')
    expect(result.detail).toBe('boom')
  })
})

describe('activationBadge', () => {
  it('idle 折成能力页的 muted，其余色调原样透传', () => {
    expect(activationBadge(plugin({ enabled: false }))).toEqual({ tone: 'muted', label: '已停用' })
    expect(activationBadge(plugin({ activation: activeActivation }))).toEqual({ tone: 'ok', label: '已激活 · 2 个工具' })
    expect(activationBadge(plugin({ activation: { status: 'failed', message: 'x' } })).tone).toBe('error')
  })

  it('只带徽章要用的两个字段，detail 不进徽章', () => {
    expect(Object.keys(activationBadge(plugin({ activation: { status: 'inactive', missingServices: ['llm'] } })))).toEqual(['tone', 'label'])
  })
})

describe('pluginStats', () => {
  it('统计口径与 chips 一致：需要处理只算未激活与失败', () => {
    const plugins = [
      plugin({ name: 'a', activation: activeActivation }),
      plugin({ name: 'b', enabled: false, activation: activeActivation }),
      plugin({ name: 'c', activation: { status: 'inactive', missingServices: ['llm'] } }),
      plugin({ name: 'd', activation: { status: 'failed', message: 'x' } })
    ]
    expect(pluginStats(plugins)).toEqual({ total: 4, enabled: 3, tools: 2, attention: 2 })
  })

  it('空列表全为 0', () => {
    expect(pluginStats([])).toEqual({ total: 0, enabled: 0, tools: 0, attention: 0 })
  })
})

describe('activationTools', () => {
  it('只有激活状态才有工具', () => {
    expect(activationTools(activeActivation)).toEqual(['demo_greet', 'demo_bye'])
    expect(activationTools({ status: 'inactive', missingServices: ['llm'] })).toEqual([])
    expect(activationTools(null)).toEqual([])
  })
})

describe('countActiveTools', () => {
  it('停用插件的工具不计入', () => {
    const plugins = [
      plugin({ name: 'a', activation: activeActivation }),
      plugin({ name: 'b', enabled: false, activation: activeActivation }),
      plugin({ name: 'c', activation: { status: 'failed', message: 'x' } })
    ]
    expect(countActiveTools(plugins)).toBe(2)
  })
})

describe('filterPlugins', () => {
  const plugins = [
    plugin({ name: 'alpha', description: '搜索工具', activation: activeActivation }),
    plugin({ name: 'beta', enabled: false }),
    plugin({ name: 'gamma', activation: { status: 'inactive', missingServices: ['llm'] } }),
    plugin({ name: 'delta', activation: { status: 'failed', message: 'x' } })
  ]

  it('默认返回全部', () => {
    expect(filterPlugins(plugins, 'all', '').map((item) => item.name)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })

  it('只看启用的', () => {
    expect(filterPlugins(plugins, 'enabled', '').map((item) => item.name)).toEqual(['alpha', 'gamma', 'delta'])
  })

  it('只看有问题的：未激活与失败都算，停用不算', () => {
    expect(filterPlugins(plugins, 'problem', '').map((item) => item.name)).toEqual(['gamma', 'delta'])
  })

  it('关键字匹配名称与描述，忽略大小写与首尾空格', () => {
    expect(filterPlugins(plugins, 'all', '  ALPHA ').map((item) => item.name)).toEqual(['alpha'])
    expect(filterPlugins(plugins, 'all', '搜索').map((item) => item.name)).toEqual(['alpha'])
  })

  it('筛选与关键字同时生效', () => {
    expect(filterPlugins(plugins, 'problem', 'gamma').map((item) => item.name)).toEqual(['gamma'])
  })
})

describe('hitState', () => {
  const hit = (overrides: Partial<DshSearchHit>): DshSearchHit => ({ name: 'x', version: '2.0.0', description: '', ...overrides })

  it('没装过是可安装', () => {
    expect(hitState(hit({}))).toBe('installable')
  })

  it('版本一致是已安装', () => {
    expect(hitState(hit({ installedVersion: '2.0.0' }))).toBe('installed')
  })

  it('版本不同是可更新', () => {
    expect(hitState(hit({ installedVersion: '1.0.0' }))).toBe('upgradable')
  })
})

describe('搜索结果兼容性', () => {
  const hit = (name: string, compat?: DshSearchHit['compat']): DshSearchHit => ({ name, version: '1.0.0', description: '', compat })

  it('ok 与未知不打标记，warn / block 分别说明', () => {
    expect(presentCompat(hit('a', { level: 'ok', reasons: [] }))).toBeNull()
    expect(presentCompat(hit('a'))).toBeNull()
    expect(presentCompat(hit('a', { level: 'warn', reasons: ['x', 'y'] }))).toEqual({ tone: 'warn', label: '可能无法激活', detail: 'x；y' })
    expect(presentCompat(hit('a', { level: 'block', reasons: ['不是 ESM'] }))).toEqual({ tone: 'error', label: '无法安装', detail: '不是 ESM' })
  })

  it('按 ok、未知、warn、block 排序，同档保持原顺序', () => {
    const sorted = sortHits([hit('b1', { level: 'block', reasons: [] }), hit('w1', { level: 'warn', reasons: [] }), hit('o1', { level: 'ok', reasons: [] }), hit('u1'), hit('o2', { level: 'ok', reasons: [] })])
    expect(sorted.map((item) => item.name)).toEqual(['o1', 'o2', 'u1', 'w1', 'b1'])
  })

  it('安装提示带上兼容提醒', () => {
    expect(installNotice({ name: 'p', version: '1.0.0', warnings: [] })).toBe('已安装 p@1.0.0，需手动启用')
    expect(installNotice({ name: 'p', version: '1.0.0', warnings: ['需要 dsh-tools ^0.2.0'] })).toBe('已安装 p@1.0.0，需手动启用；注意：需要 dsh-tools ^0.2.0')
  })
})

