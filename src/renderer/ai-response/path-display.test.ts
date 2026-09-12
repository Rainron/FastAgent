import { describe, expect, it } from 'vitest'
import { displayPath, displayPathValue, isAbsolutePath, stripWorkspaceRoot } from './path-display'

describe('isAbsolutePath', () => {
  it('盘符 / 根斜杠 / 主目录算绝对，相对路径不算', () => {
    expect(isAbsolutePath('K:/cc-project/fa')).toBe(true)
    expect(isAbsolutePath('K:\\cc-project\\fa')).toBe(true)
    expect(isAbsolutePath('/usr/local')).toBe(true)
    expect(isAbsolutePath('~/dev')).toBe(true)
    expect(isAbsolutePath('//server/share')).toBe(true)
    expect(isAbsolutePath('src/a.ts')).toBe(false)
    expect(isAbsolutePath('')).toBe(false)
    expect(isAbsolutePath('npm run build')).toBe(false)
  })
})

describe('displayPath', () => {
  it('相对路径原样保留，只剥掉开头的 ./', () => {
    expect(displayPath('src/a.ts', 'K:/app')).toBe('src/a.ts')
    expect(displayPath('./src/a.ts', null)).toBe('src/a.ts')
  })

  it('工作区根下的绝对路径折成相对路径', () => {
    expect(displayPath('K:/app/src/a.ts', 'K:/app')).toBe('src/a.ts')
    expect(displayPath('K:\\app\\src\\a.ts', 'K:/app')).toBe('src/a.ts')
  })

  it('路径就是工作区根时返回空串', () => {
    expect(displayPath('K:/app', 'K:/app')).toBe('')
  })

  it('工作区根未知或路径在根外时只留文件名', () => {
    expect(displayPath('K:/app/src/a.ts', null)).toBe('a.ts')
    expect(displayPath('D:/elsewhere/b.txt', 'K:/app')).toBe('b.txt')
  })

  it('不以指定根开头但同前缀的路径不被误判（根边界必须带分隔符）', () => {
    expect(displayPath('K:/appx/src/a.ts', 'K:/app')).toBe('a.ts')
  })
})

describe('stripWorkspaceRoot', () => {
  it('命令里的工作区根折成相对形式，根自身折成 .', () => {
    expect(stripWorkspaceRoot('cd K:/app && pwd && ls -la', 'K:/app')).toBe('cd . && pwd && ls -la')
    expect(stripWorkspaceRoot('cat K:/app/src/a.ts', 'K:/app')).toBe('cat src/a.ts')
    expect(stripWorkspaceRoot('cat K:\\app\\src\\a.ts', 'K:/app')).toBe('cat src\\a.ts')
  })

  it('同前缀的其他目录不被误伤', () => {
    expect(stripWorkspaceRoot('cd K:/appx && pwd', 'K:/app')).toBe('cd K:/appx && pwd')
  })

  it('根未知或与命令无关时原样返回', () => {
    expect(stripWorkspaceRoot('npm run build', null)).toBe('npm run build')
    expect(stripWorkspaceRoot('npm run build', 'K:/app')).toBe('npm run build')
  })
})

describe('displayPathValue', () => {
  it('整串是绝对路径时按 displayPath 收敛', () => {
    expect(displayPathValue('K:/app/src/a.ts', 'K:/app')).toBe('src/a.ts')
  })

  it('非路径字符串只收敛嵌入的工作区根', () => {
    expect(displayPathValue('npm run build', 'K:/app')).toBe('npm run build')
    expect(displayPathValue('cd K:/app && npm i', 'K:/app')).toBe('cd . && npm i')
  })
})