import { describe, expect, it } from 'vitest'
import { isUnknownSource, missingRequiredFields, permissionNotices, pluginStatus, pluginStatusPresentation, primaryAction } from './plugin-view'
import type { Plugin, PluginConfigField } from '../../../shared/types'

function plugin(patch: Partial<Plugin> = {}): Plugin {
  return {
    id: 'p1',
    name: 'demo',
    displayName: 'Demo',
    description: '演示',
    abilityType: 'skill',
    version: '1.0.0',
    categories: [],
    tags: [],
    publishedAt: '2026-01-01T00:00:00.000Z',
    permissions: { runsLocalCode: false, networkAccess: false, fileAccess: false },
    configFields: [],
    installed: false,
    ...patch
  }
}

describe('插件状态机', () => {
  it('由安装态推导状态，进行中优先', () => {
    expect(pluginStatus(plugin())).toBe('not_installed')
    expect(pluginStatus(plugin({ installed: true }))).toBe('installed')
    expect(pluginStatus(plugin({ installed: true, updateAvailable: true }))).toBe('update_available')
    expect(pluginStatus(plugin({ installed: true }), 'installing')).toBe('installing')
    expect(pluginStatus(plugin(), 'uninstalling')).toBe('installing')
  })

  it('状态色调复用能力页的同一套 token', () => {
    expect(pluginStatusPresentation('not_installed').tone).toBe('muted')
    expect(pluginStatusPresentation('installed').tone).toBe('ok')
    expect(pluginStatusPresentation('update_available').tone).toBe('warn')
    expect(pluginStatusPresentation('installing').tone).toBe('accent')
    expect(pluginStatusPresentation('error').tone).toBe('error')
  })
})

describe('主按钮可用性', () => {
  const withConfig: PluginConfigField[] = [{ key: 'TOKEN', label: '令牌', target: 'env', required: true, secret: true }]

  it('未安装时按是否需要配置切换文案', () => {
    expect(primaryAction(plugin(), 'not_installed')).toMatchObject({ label: '安装', kind: 'install', needsConfig: false, disabled: false })
    expect(primaryAction(plugin({ configFields: withConfig }), 'not_installed')).toMatchObject({ label: '配置并安装', needsConfig: true })
  })

  it('安装中禁用按钮', () => {
    expect(primaryAction(plugin(), 'installing')).toMatchObject({ label: '安装中…', disabled: true })
  })

  it('有更新时是更新，已安装时是打开能力', () => {
    expect(primaryAction(plugin({ installed: true, updateAvailable: true }), 'update_available')).toMatchObject({ label: '更新', kind: 'update' })
    expect(primaryAction(plugin({ installed: true, abilityId: 'a1' }), 'installed')).toMatchObject({ label: '打开能力', kind: 'open', disabled: false })
  })

  it('已安装但没有对应能力 id 时禁用「打开能力」', () => {
    expect(primaryAction(plugin({ installed: true }), 'installed').disabled).toBe(true)
  })
})

describe('配置与权限提示', () => {
  const fields: PluginConfigField[] = [
    { key: 'TOKEN', label: '令牌', target: 'env', required: true, secret: true },
    { key: 'cwd', label: '目录', target: 'cwd', required: false, secret: false }
  ]

  it('只统计必填且未填写的项', () => {
    expect(missingRequiredFields(fields, {})).toEqual(['TOKEN'])
    expect(missingRequiredFields(fields, { TOKEN: '  ' })).toEqual(['TOKEN'])
    expect(missingRequiredFields(fields, { TOKEN: 'v' })).toEqual([])
  })

  it('权限提示逐条列出可执行命令与环境变量名', () => {
    const notices = permissionNotices(plugin({
      permissions: { runsLocalCode: true, networkAccess: true, fileAccess: true, envKeys: ['TOKEN'], commands: ['npx demo'] }
    }))
    expect(notices).toEqual([
      '会在本机启动进程并执行命令',
      '会访问外部网络',
      '会读写本地文件',
      '需要环境变量：TOKEN',
      '可能执行：npx demo'
    ])
    expect(permissionNotices(plugin())).toEqual([])
  })

  it('没有仓库与主页时判为未知来源', () => {
    expect(isUnknownSource(plugin())).toBe(true)
    expect(isUnknownSource(plugin({ repository: 'https://github.com/x/y' }))).toBe(false)
    expect(isUnknownSource(plugin({ homepage: 'https://x.dev' }))).toBe(false)
  })
})
