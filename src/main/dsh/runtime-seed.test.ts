import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { collectBareSpecifiers, collectSeedPackages, ensureDshRuntime, packageNameOf, readPackageVersion } from './runtime-seed'

const roots: string[] = []

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-seed-'))
  roots.push(dir)
  return dir
}

function writePackage(nodeModules: string, name: string, files: Record<string, string>, version = '1.0.0') {
  for (const [path, content] of Object.entries({ 'package.json': JSON.stringify({ name, version }), ...files })) {
    const target = join(nodeModules, name, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('collectBareSpecifiers', () => {
  it('收 import / dynamic import / require 三种写法', () => {
    const source = `
      import { a } from '@scope/one'
      const b = await import('two/sub')
      const c = require('three')
    `
    expect(collectBareSpecifiers(source).sort()).toEqual(['@scope/one', 'three', 'two'])
  })

  it('跳过相对路径与 node 内置', () => {
    const source = `import './local'\nimport 'node:fs'\nimport '/abs'`
    expect(collectBareSpecifiers(source)).toEqual([])
  })
})

describe('packageNameOf', () => {
  it('作用域包取前两段，普通包取第一段', () => {
    expect(packageNameOf('@scope/pkg/deep/path')).toBe('@scope/pkg')
    expect(packageNameOf('pkg/deep')).toBe('pkg')
  })
})

describe('collectSeedPackages', () => {
  it('顺着真实 import 求闭包', () => {
    const nodeModules = join(scratch(), 'node_modules')
    writePackage(nodeModules, 'root', { 'index.js': `import 'mid'` })
    writePackage(nodeModules, 'mid', { 'index.js': `import 'leaf'` })
    writePackage(nodeModules, 'leaf', { 'index.js': `export const x = 1` })
    writePackage(nodeModules, 'unrelated', { 'index.js': '' })
    expect(collectSeedPackages(nodeModules, ['root'])).toEqual(['leaf', 'mid', 'root'])
  })

  it('只出现在 .d.ts 里的依赖不进闭包', () => {
    const nodeModules = join(scratch(), 'node_modules')
    writePackage(nodeModules, 'root', { 'index.js': `export const x = 1`, 'index.d.ts': `import 'types-only'` })
    writePackage(nodeModules, 'types-only', { 'index.js': '' })
    expect(collectSeedPackages(nodeModules, ['root'])).toEqual(['root'])
  })

  it('未安装的依赖被跳过而不是抛错', () => {
    const nodeModules = join(scratch(), 'node_modules')
    writePackage(nodeModules, 'root', { 'index.js': `import 'ghost'` })
    expect(collectSeedPackages(nodeModules, ['root'])).toEqual(['root'])
  })

  it('循环依赖不会死循环', () => {
    const nodeModules = join(scratch(), 'node_modules')
    writePackage(nodeModules, 'a', { 'index.js': `import 'b'` })
    writePackage(nodeModules, 'b', { 'index.js': `import 'a'` })
    expect(collectSeedPackages(nodeModules, ['a'])).toEqual(['a', 'b'])
  })
})

describe('ensureDshRuntime', () => {
  function fixture() {
    const base = scratch()
    const appNodeModules = join(base, 'app', 'node_modules')
    const target = join(base, 'data', 'node_modules')
    writePackage(appNodeModules, 'root', {
      'index.js': `import 'dep'`,
      'index.d.ts': 'declare const x: number',
      'index.js.map': '{}',
      'README.md': 'docs'
    })
    writePackage(appNodeModules, 'dep', { 'index.js': 'export const d = 1' })
    return { appNodeModules, target }
  }

  it('复制运行时文件并跳过 .d.ts / map / 文档', () => {
    const { appNodeModules, target } = fixture()
    const result = ensureDshRuntime(appNodeModules, target, '1.0.0', ['root'])
    expect(result.seeded).toBe(true)
    expect(result.packages).toEqual(['dep', 'root'])
    expect(existsSync(join(target, 'root', 'index.js'))).toBe(true)
    expect(existsSync(join(target, 'root', 'package.json'))).toBe(true)
    expect(existsSync(join(target, 'root', 'index.d.ts'))).toBe(false)
    expect(existsSync(join(target, 'root', 'index.js.map'))).toBe(false)
    expect(existsSync(join(target, 'root', 'README.md'))).toBe(false)
  })

  it('版本戳一致时跳过复制', () => {
    const { appNodeModules, target } = fixture()
    ensureDshRuntime(appNodeModules, target, '1.0.0', ['root'])
    rmSync(join(target, 'root', 'index.js'))
    const again = ensureDshRuntime(appNodeModules, target, '1.0.0', ['root'])
    expect(again.seeded).toBe(false)
    // 跳过就是跳过：不该偷偷补回被删的文件，否则「跳过」这件事无法验证
    expect(existsSync(join(target, 'root', 'index.js'))).toBe(false)
  })

  it('版本变了就整个重铺', () => {
    const { appNodeModules, target } = fixture()
    ensureDshRuntime(appNodeModules, target, '1.0.0', ['root'])
    writeFileSync(join(target, 'root', 'stale.js'), 'old', 'utf8')
    const again = ensureDshRuntime(appNodeModules, target, '2.0.0', ['root'])
    expect(again.seeded).toBe(true)
    expect(existsSync(join(target, 'root', 'stale.js'))).toBe(false)
    expect(JSON.parse(readFileSync(join(target, '.fastagent-dsh-runtime.json'), 'utf8')).runtimeVersion).toBe('2.0.0')
  })

  it('戳文件损坏时当作没装过', () => {
    const { appNodeModules, target } = fixture()
    ensureDshRuntime(appNodeModules, target, '1.0.0', ['root'])
    writeFileSync(join(target, '.fastagent-dsh-runtime.json'), 'not json', 'utf8')
    expect(ensureDshRuntime(appNodeModules, target, '1.0.0', ['root']).seeded).toBe(true)
  })

  it('应用自身依赖缺失时报错而不是静默播种空目录', () => {
    const base = scratch()
    expect(() => ensureDshRuntime(join(base, 'missing'), join(base, 'target'), '1.0.0', ['root'])).toThrow(/安装可能不完整/)
  })
})

describe('readPackageVersion', () => {
  it('读出已安装包的版本', () => {
    const nodeModules = join(scratch(), 'node_modules')
    writePackage(nodeModules, 'demo', { 'index.js': '' }, '4.0.2')
    expect(readPackageVersion(nodeModules, 'demo')).toBe('4.0.2')
  })

  it('包不存在时报错', () => {
    expect(() => readPackageVersion(join(scratch(), 'node_modules'), 'ghost')).toThrow(/缺少依赖 ghost/)
  })
})
