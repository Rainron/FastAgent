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

  it('IP 与端口不当作文件加行号', () => {
    expect(parseFileReference('10.101.3.87:1000')).toBeNull()
    expect(parseFileReference('127.0.0.1:8080')).toBeNull()
    expect(parseFileReference('192.168.1.1')).toBeNull()
  })

  it('带端口的域名不当作文件', () => {
    expect(parseFileReference('example.com:8080')).toBeNull()
    expect(parseFileReference('registry.npmjs.org:443')).toBeNull()
  })

  it('纯数字后缀不算扩展名（版本号不是文件）', () => {
    expect(parseFileReference('1.0.0')).toBeNull()
    expect(parseFileReference('v2.3.4')).toBeNull()
  })

  it('域名形状的真实文件路径仍然解析', () => {
    // 带目录分隔符就不走主机判断，公司内网域名做目录名的仓库也不会被误伤。
    expect(parseFileReference('config/example.com:8080')).toMatchObject({ path: 'config/example.com', line: 8080 })
    expect(parseFileReference('example.com.ts:12')).toMatchObject({ path: 'example.com.ts', line: 12 })
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
