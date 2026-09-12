import { describe, expect, it } from 'vitest'
import { cleanIpcError, parseIpcError } from './ipc-error'

describe('cleanIpcError', () => {
  it('剥掉 Electron 的 IPC 包装和 Error 类名', () => {
    const cause = new Error("Error invoking remote method 'workspace:read-file': Error: 文件或目录不存在：main.py")
    expect(cleanIpcError(cause, '打开失败')).toBe('文件或目录不存在：main.py')
  })

  it('没有包装时原样返回', () => {
    expect(cleanIpcError(new Error('只能打开工作区内的文件'), '打开失败')).toBe('只能打开工作区内的文件')
  })

  it('字符串错误也能处理', () => {
    expect(cleanIpcError('TypeError: 坏了', '打开失败')).toBe('坏了')
  })

  it('拿不到信息时用兜底文案', () => {
    expect(cleanIpcError(null, '打开失败')).toBe('打开失败')
    expect(cleanIpcError(new Error(''), '打开失败')).toBe('打开失败')
  })
})

describe('parseIpcError', () => {
  it('候选列表会被拆出，主消息保留', () => {
    const cause = new Error("Error invoking remote method 'workspace:read-file': Error: 文件或目录不存在：test.txt（当前工作区：K:/p）\n\n你是不是要找：abc/test.txt、abc/note.txt")
    expect(parseIpcError(cause, '打开失败')).toEqual({
      message: '文件或目录不存在：test.txt（当前工作区：K:/p）',
      suggestions: ['abc/test.txt', 'abc/note.txt']
    })
  })

  it('没候选时返回空数组', () => {
    const cause = new Error('Error: 文件或目录不存在：main.py')
    expect(parseIpcError(cause, '打开失败')).toEqual({ message: '文件或目录不存在：main.py', suggestions: [] })
  })

  it('拿不到信息时走兜底', () => {
    expect(parseIpcError(null, '打开失败')).toEqual({ message: '打开失败', suggestions: [] })
  })
})
