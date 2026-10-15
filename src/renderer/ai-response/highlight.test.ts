import { describe, expect, it } from 'vitest'
import { BUNDLED_LANGUAGE_IDS, languageFromPath, MAX_HIGHLIGHT_CODE_LENGTH, shouldHighlightCode } from './highlight'

describe('shouldHighlightCode', () => {
  it('允许高亮达到长度上限的受支持语言内容', () => {
    expect(shouldHighlightCode('x'.repeat(MAX_HIGHLIGHT_CODE_LENGTH), 'ts')).toBe(true)
  })

  it('拒绝高亮超过长度上限的内容', () => {
    expect(shouldHighlightCode('x'.repeat(MAX_HIGHLIGHT_CODE_LENGTH + 1), 'ts')).toBe(false)
  })

  it('拒绝高亮不受支持的语言', () => {
    expect(shouldHighlightCode('const value = 1', 'not-a-language')).toBe(false)
  })
})

describe('BUNDLED_LANGUAGE_IDS', () => {
  it('每个 id 都是 shiki full 包里真实存在的语言或别名，否则打开文件时会加载失败退回纯文本', async () => {
    const { bundledLanguages } = await import('shiki/bundle/full')
    const missing = [...BUNDLED_LANGUAGE_IDS].filter((id) => !(id in bundledLanguages))
    expect(missing).toEqual([])
  })
})

describe('languageFromPath', () => {
  it('常见前端与配置扩展名', () => {
    expect(languageFromPath('package.json')).toBe('json')
    expect(languageFromPath('src/App.tsx')).toBe('tsx')
    expect(languageFromPath('config.yml')).toBe('yaml')
    expect(languageFromPath('Cargo.toml')).toBe('toml')
    expect(languageFromPath('setup.cfg')).toBe('ini')
  })

  it('后端语言', () => {
    expect(languageFromPath('main.go')).toBe('go')
    expect(languageFromPath('lib.rs')).toBe('rust')
    expect(languageFromPath('App.kt')).toBe('kotlin')
    expect(languageFromPath('Program.cs')).toBe('csharp')
    expect(languageFromPath('build.ps1')).toBe('powershell')
    expect(languageFromPath('run.cmd')).toBe('bat')
  })

  it('靠文件名认的工程文件，大小写不敏感', () => {
    expect(languageFromPath('K:/repo/Dockerfile')).toBe('dockerfile')
    expect(languageFromPath('Dockerfile.dev')).toBe('dockerfile')
    expect(languageFromPath('Makefile')).toBe('makefile')
    expect(languageFromPath('CMakeLists.txt')).toBe('cmake')
    expect(languageFromPath('.env')).toBe('dotenv')
    expect(languageFromPath('.env.local')).toBe('dotenv')
  })

  it('允许注释的 JSON 配置按 jsonc', () => {
    expect(languageFromPath('tsconfig.json')).toBe('jsonc')
    expect(languageFromPath('tsconfig.node.json')).toBe('jsonc')
    expect(languageFromPath('.vscode/settings.json')).toBe('jsonc')
  })

  it('XML 方言按 xml', () => {
    expect(languageFromPath('App.csproj')).toBe('xml')
    expect(languageFromPath('icon.svg')).toBe('xml')
  })

  it('认不出的返回 null，走纯文本', () => {
    expect(languageFromPath('.gitignore')).toBeNull()
    expect(languageFromPath('LICENSE')).toBeNull()
    expect(languageFromPath('data.xyz')).toBeNull()
    expect(languageFromPath(null)).toBeNull()
  })
})
