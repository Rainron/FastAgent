import { describe, expect, it } from 'vitest'
import { DshInstaller } from './installer'
import { assessDshCompat } from './npm-registry'

const HOST = { '@deepseek-ai/cordis': '4.0.2', '@deepseek-ai/dsh-tools': '0.1.5-rc.2' }
const dsh = (peers: Record<string, string> = {}) => ({ name: 'demo', version: '1.0.0', type: 'module', peerDependencies: { '@deepseek-ai/cordis': '^4.0.1', ...peers } })

describe('assessDshCompat', () => {
  it('兼容的插件判 ok', () => {
    expect(assessDshCompat(dsh({ '@deepseek-ai/dsh-tools': '^0.1.5-alpha.1' }), '4.0.2', HOST)).toEqual({ level: 'ok', reasons: [] })
  })
  it('非 dsh 插件、带安装脚本判 block', () => {
    expect(assessDshCompat({ name: 'left-pad', version: '1.3.0' }, '4.0.2', HOST).level).toBe('block')
    expect(assessDshCompat({ ...dsh(), scripts: { postinstall: 'node x.js' } }, '4.0.2', HOST)).toMatchObject({ level: 'block', reasons: [expect.stringContaining('postinstall')] })
  })
  it('dsh peer 不符判 warn', () => {
    expect(assessDshCompat(dsh({ '@deepseek-ai/dsh-tools': '^0.2.0-rc.1' }), '4.0.2', HOST).level).toBe('warn')
  })
})

describe('DshInstaller.search', () => {
  function fakeFetch(latest: Record<string, unknown | number>): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({ objects: Object.keys(latest).map((name) => ({ package: { name, version: '1.0.0', description: name } })) }), { status: 200 })
      }
      const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', '').replace(/\/latest$/, ''))
      const body = latest[name]
      if (typeof body === 'number') return new Response('fail', { status: body })
      return new Response(JSON.stringify(body), { status: 200 })
    }) as typeof fetch
  }

  it('逐个预判兼容性，拉不到元数据的不下结论，顺序与 registry 一致', async () => {
    const installer = new DshInstaller({
      root: 'unused',
      hostCordisVersion: '4.0.2',
      hostPackages: HOST,
      fetchImpl: fakeFetch({ good: dsh(), cjs: { name: 'cjs', version: '1.0.0' }, broken: 500 })
    })
    const hits = await installer.search('x', new AbortController().signal)
    expect(hits.map((hit) => [hit.name, hit.compat?.level])).toEqual([['good', 'ok'], ['cjs', 'block'], ['broken', undefined]])
  })
})
