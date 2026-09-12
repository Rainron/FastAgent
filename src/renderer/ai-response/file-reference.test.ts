import { describe, expect, it } from 'vitest'
import { formatFileReference, isWorkspaceRelativePath, parseFileReference } from './file-reference'

describe('isWorkspaceRelativePath', () => {
  it('接受工作区内的相对路径', () => {
    expect(isWorkspaceRelativePath('src/main.ts')).toBe(true)
    expect(isWorkspaceRelativePath('src\\main.ts')).toBe(true)
  })

  it('拒绝 .. 穿越', () => {
    expect(isWorkspaceRelativePath('../../etc/passwd')).toBe(false)
    expect(isWorkspaceRelativePath('src/../../secret')).toBe(false)
  })

  it('拒绝绝对路径、盘符与 UNC', () => {
    expect(isWorkspaceRelativePath('/etc/passwd')).toBe(false)
    expect(isWorkspaceRelativePath('C:\\Windows\\system32')).toBe(false)
    expect(isWorkspaceRelativePath('\\\\server\\share')).toBe(false)
  })

  it('拒绝带协议的字符串', () => {
    expect(isWorkspaceRelativePath('file:///etc/passwd')).toBe(false)
    expect(isWorkspaceRelativePath('https://example.com/a.ts')).toBe(false)
  })
})

describe('parseFileReference', () => {
  it('解析裸路径', () => {
    expect(parseFileReference('src/main.ts')).toEqual({ path: 'src/main.ts', line: null, endLine: null })
  })

  it('解析单行号', () => {
    expect(parseFileReference('src/main.ts:42')).toEqual({ path: 'src/main.ts', line: 42, endLine: null })
  })

  it('解析行号区间', () => {
    expect(parseFileReference('src/main.ts:42-68')).toEqual({ path: 'src/main.ts', line: 42, endLine: 68 })
  })

  it('没有目录也没有扩展名的不当作文件引用', () => {
    expect(parseFileReference('useState')).toBeNull()
    expect(parseFileReference('npm run build')).toBeNull()
  })

  it('越界路径不解析', () => {
    expect(parseFileReference('../secret.ts:1')).toBeNull()
  })

  it('区间终点小于起点时拒绝', () => {
    expect(parseFileReference('src/main.ts:80-2')).toBeNull()
  })

  it('格式化回原始写法', () => {
    expect(formatFileReference({ path: 'a/b.ts', line: 3, endLine: 9 })).toBe('a/b.ts:3-9')
    expect(formatFileReference({ path: 'a/b.ts', line: 3, endLine: null })).toBe('a/b.ts:3')
    expect(formatFileReference({ path: 'a/b.ts', line: null, endLine: null })).toBe('a/b.ts')
  })
})
