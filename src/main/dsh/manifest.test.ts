import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  CORDIS_PACKAGE, checkDshPackage, isValidPackageName, missingServices,
  dshPeerWarnings, packageDirName, parseInjectList, resolvePluginEntry, satisfiesCordisRange
} from './manifest'

const HOST_CORDIS = '4.0.2'

function pkg(overrides: Record<string, unknown> = {}) {
  return {
    name: 'dsh-plugin-demo',
    version: '1.0.0',
    type: 'module',
    main: 'lib/index.js',
    peerDependencies: { [CORDIS_PACKAGE]: '^4.0.1-rc.1' },
    ...overrides
  }
}

describe('parseInjectList', () => {
  it('接受数组写法', () => {
    expect(parseInjectList(['tools', 'llm'])).toEqual(['tools', 'llm'])
  })

  it('对象写法只取 required：optional 缺失不挡激活', () => {
    expect(parseInjectList({ required: ['tools'], optional: ['llm'] })).toEqual(['tools'])
  })

  it('非法值退化成空列表', () => {
    expect(parseInjectList(undefined)).toEqual([])
    expect(parseInjectList('tools')).toEqual([])
    expect(parseInjectList([1, 'tools', null])).toEqual(['tools'])
  })
})

describe('satisfiesCordisRange', () => {
  it('同主版本且宿主不低于下限时通过', () => {
    expect(satisfiesCordisRange('^4.0.1-rc.1', HOST_CORDIS)).toBe(true)
    expect(satisfiesCordisRange('4.0.2', HOST_CORDIS)).toBe(true)
    expect(satisfiesCordisRange('~4.0.0', HOST_CORDIS)).toBe(true)
  })

  it('跨主版本一律不兼容', () => {
    expect(satisfiesCordisRange('^5.0.0', HOST_CORDIS)).toBe(false)
    expect(satisfiesCordisRange('^3.9.9', HOST_CORDIS)).toBe(false)
  })

  it('宿主低于插件要求的下限时不兼容', () => {
    expect(satisfiesCordisRange('^4.1.0', HOST_CORDIS)).toBe(false)
  })
})

describe('checkDshPackage', () => {
  it('依赖旧的 cordis 包直接拒绝，说清原因', () => {
    const result = checkDshPackage(pkg({ peerDependencies: { cordis: '^4.0.0' } }), HOST_CORDIS)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.reason).toContain('旧的 cordis')
  })

  it('钉死同一大版本的旧补丁版只提醒，不拦截；跨大版本或要求更高版本仍拒绝', () => {
    const pinned = checkDshPackage(pkg({ peerDependencies: { [CORDIS_PACKAGE]: '4.0.1' } }), HOST_CORDIS)
    expect(pinned).toMatchObject({ ok: true, warnings: [expect.stringContaining('同一大版本')] })
    expect(checkDshPackage(pkg({ peerDependencies: { [CORDIS_PACKAGE]: '>=4.0.4' } }), HOST_CORDIS).ok).toBe(false)
    expect(checkDshPackage(pkg({ peerDependencies: { [CORDIS_PACKAGE]: '3.9.0' } }), HOST_CORDIS).ok).toBe(false)
  })

  it('cordis 区间支持 || 写法', () => {
    expect(checkDshPackage(pkg({ peerDependencies: { [CORDIS_PACKAGE]: '^3.0.0 || ^4.0.1' } }), HOST_CORDIS).ok).toBe(true)
  })

  it('dsh peer 版本不符或宿主没有时给出提醒但不拦截', () => {
    const host = { [CORDIS_PACKAGE]: HOST_CORDIS, '@deepseek-ai/dsh-tools': '0.1.5-rc.2' }
    const result = checkDshPackage(pkg({ peerDependencies: { [CORDIS_PACKAGE]: '^4.0.1', '@deepseek-ai/dsh-tools': '^0.1.7-rc.1 || ^0.2.0-rc.1', '@deepseek-ai/dsh-settings': '^0.1.7', react: '^18.2.0' } }), HOST_CORDIS, host)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([
      '需要 dsh-tools ^0.1.7-rc.1 || ^0.2.0-rc.1，当前宿主是 0.1.5-rc.2，接口可能不兼容',
      '依赖宿主未提供的 dsh-settings，可能无法激活'
    ])
  })

  it('合法插件解析出 manifest', () => {
    const result = checkDshPackage(pkg(), HOST_CORDIS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.name).toBe('dsh-plugin-demo')
    expect(result.manifest.main).toBe('lib/index.js')
    expect(result.manifest.cordisRange).toBe('^4.0.1-rc.1')
  })

  it('非 ESM 包被拒', () => {
    const result = checkDshPackage(pkg({ type: 'commonjs' }), HOST_CORDIS)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('ESM')
  })

  it('peerDependencies 没有 cordis 的不是 dsh 插件', () => {
    const result = checkDshPackage(pkg({ peerDependencies: {} }), HOST_CORDIS)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain(CORDIS_PACKAGE)
  })

  it('cordis 大版本对不上时拒绝安装并说明版本', () => {
    const result = checkDshPackage(pkg({ peerDependencies: { [CORDIS_PACKAGE]: '^5.0.0' } }), HOST_CORDIS)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('4.0.2')
  })

  it('main 缺省时按 Node 惯例回落 index.js', () => {
    const result = checkDshPackage(pkg({ main: undefined }), HOST_CORDIS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.main).toBe('index.js')
  })

  it('author 支持字符串与对象两种写法', () => {
    const asText = checkDshPackage(pkg({ author: 'someone' }), HOST_CORDIS)
    const asObject = checkDshPackage(pkg({ author: { name: 'someone' } }), HOST_CORDIS)
    expect(asText.ok && asText.manifest.author).toBe('someone')
    expect(asObject.ok && asObject.manifest.author).toBe('someone')
  })

  it('只收普通 dependencies，peerDependencies 不进安装清单', () => {
    const result = checkDshPackage(pkg({ dependencies: { lodash: '^4.0.0' } }), HOST_CORDIS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.dependencies).toEqual({ lodash: '^4.0.0' })
  })
})

describe('missingServices', () => {
  it('列出宿主没提供的服务', () => {
    expect(missingServices(['tools', 'llm', 'sessions'], ['tools', 'systemPrompt'])).toEqual(['llm', 'sessions'])
  })

  it('全部满足时为空', () => {
    expect(missingServices(['tools'], ['tools', 'systemPrompt'])).toEqual([])
  })
})

describe('resolvePluginEntry', () => {
  const dir = resolve('/plugins/demo')

  it('解析出包内绝对路径', () => {
    expect(resolvePluginEntry(dir, 'lib/index.js')).toBe(resolve(dir, 'lib/index.js'))
  })

  it('挡掉穿出包目录的 main', () => {
    expect(resolvePluginEntry(dir, '../../etc/passwd')).toBeNull()
  })

  it('挡掉绝对路径 main', () => {
    expect(resolvePluginEntry(dir, resolve('/etc/passwd'))).toBeNull()
  })
})

describe('包名与目录名', () => {
  it('作用域包的斜杠换成加号', () => {
    expect(packageDirName('@scope/pkg')).toBe('@scope+pkg')
    expect(packageDirName('plain')).toBe('plain')
  })

  it('挡掉能穿出安装目录的包名', () => {
    expect(isValidPackageName('@scope/pkg')).toBe(true)
    expect(isValidPackageName('dsh-plugin-demo')).toBe(true)
    expect(isValidPackageName('../evil')).toBe(false)
    expect(isValidPackageName('UPPER')).toBe(false)
    expect(isValidPackageName('')).toBe(false)
  })
})

describe('dshPeerWarnings', () => {
  it('版本满足、非 dsh 包、未给宿主清单时都不提醒', () => {
    expect(dshPeerWarnings({ '@deepseek-ai/dsh-tools': '^0.1.5-alpha.1', react: '^18' }, { '@deepseek-ai/dsh-tools': '0.1.5-rc.2' })).toEqual([])
    expect(dshPeerWarnings({ '@deepseek-ai/dsh-settings': '^0.1.0' }, {})).toEqual([])
  })
})

