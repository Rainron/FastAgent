import { describe, expect, it } from 'vitest'
import { blocksToPlainText, normalizeAssistantMessage, toolCallBlocks, toolSource } from './message-normalizer'
import type { AgentEvent, ConversationTurn, ToolCallRecord } from '../../shared/types'
import type { TerminalBlock, ToolResultBlock } from './blocks'

function turn(patch: Partial<ConversationTurn>): ConversationTurn {
  return {
    id: 'turn-1',
    conversationId: 'conv-1',
    userMessage: { text: '你好', createdAt: '2026-01-01T00:00:00.000Z' },
    attachments: [],
    activity: null,
    assistantMessage: null,
    citations: [],
    artifacts: [],
    runtimeConfig: { modelId: 1, thinkingLevel: 'auto', mode: 'chat', permission: null, project: null },
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch
  }
}

function event(patch: Partial<AgentEvent>): AgentEvent {
  return { runId: 'run-1', type: 'tool_started', ...patch }
}

describe('normalizeAssistantMessage', () => {
  it('旧的纯字符串消息转成 markdown block', () => {
    const message = normalizeAssistantMessage(turn({ assistantMessage: { text: '普通回答', createdAt: '2026-01-01T00:00:01.000Z' } }))
    expect(message?.blocks).toHaveLength(1)
    expect(message?.blocks[0]).toMatchObject({ type: 'markdown', text: '普通回答' })
    expect(message?.status).toBe('completed')
  })

  it('没有助手消息也没有失败时返回 null', () => {
    expect(normalizeAssistantMessage(turn({}))).toBeNull()
  })

  it('working 回合把最后一个块标为 streaming', () => {
    const message = normalizeAssistantMessage(turn({ status: 'working', assistantMessage: { text: '第一段\n\n第二段', createdAt: '2026-01-01T00:00:01.000Z' } }))
    expect(message?.status).toBe('streaming')
    expect(message?.blocks.at(-1)?.status).toBe('streaming')
  })

  it('失败回合追加 ErrorBlock', () => {
    const message = normalizeAssistantMessage(turn({
      status: 'failed',
      activity: { status: 'failed', startedAt: null, finishedAt: null, events: [event({ type: 'failed', detail: '模型超时' })] }
    }))
    expect(message?.blocks).toEqual([{ id: 'turn-1-error', type: 'error', title: '执行失败', detail: '模型超时', status: 'error' }])
  })

  it('取消回合单独标记', () => {
    const message = normalizeAssistantMessage(turn({ status: 'cancelled' }))
    expect(message?.blocks.at(-1)).toMatchObject({ type: 'error', title: '已取消' })
  })
})

describe('blocksToPlainText', () => {
  it('代码与终端块转成可复制的纯文本', () => {
    const text = blocksToPlainText([
      { id: 'a', type: 'markdown', text: '说明' },
      { id: 'b', type: 'code', language: 'ts', filename: null, code: 'const a = 1' },
      { id: 'c', type: 'terminal', command: 'npm test', output: 'ok', exitCode: 0, cwd: null, durationMs: null }
    ])
    expect(text).toBe('说明\n\nconst a = 1\n\n$ npm test\nok')
  })
})

describe('toolSource', () => {
  it('内置工具与 MCP 工具区分开', () => {
    expect(toolSource('bash')).toBe('command')
    expect(toolSource('agent')).toBe('agent')
    expect(toolSource('github__create_issue')).toBe('mcp')
  })
})

describe('toolCallBlocks', () => {
  const group = { toolCallId: 'call-1', toolName: 'bash', events: [event({ toolCallId: 'call-1', tool: 'bash', input: 'npm run build' })] }

  it('只有开始事件时标记为 streaming，且不产出结果块', () => {
    const blocks = toolCallBlocks(group, null, '运行命令')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'toolCall', source: 'command', status: 'streaming', input: 'npm run build' })
  })

  it('shell 工具产出 TerminalBlock，带 exitCode 与耗时；绝对 cwd 折成相对路径', () => {
    const record = { id: 'call-1', arguments: { command: 'npm run build', cwd: 'K:/app' }, result: { stdout: 'built', exitCode: 0 }, status: 'success', durationMs: 1320 } as unknown as ToolCallRecord
    const blocks = toolCallBlocks({ ...group, events: [...group.events, event({ type: 'tool_result', toolCallId: 'call-1', tool: 'bash', durationMs: 1320 })] }, record, '运行命令', 'K:/')
    const terminal = blocks[1] as TerminalBlock
    expect(terminal.type).toBe('terminal')
    expect(terminal).toMatchObject({ command: 'npm run build', output: 'built', exitCode: 0, cwd: 'app', durationMs: 1320 })
  })

  it('非 shell 工具产出 ToolResultBlock，带增删统计', () => {
    const record = { id: 'call-2', arguments: {}, result: { summary: '已写入', additions: 3, deletions: 1 }, status: 'success', durationMs: 12 } as unknown as ToolCallRecord
    const blocks = toolCallBlocks({ toolCallId: 'call-2', toolName: 'edit', events: [event({ type: 'tool_result', toolCallId: 'call-2', tool: 'edit' })] }, record, '修改文件')
    const result = blocks[1] as ToolResultBlock
    expect(result).toMatchObject({ type: 'toolResult', summary: '已写入', additions: 3, deletions: 1 })
  })

  it('等待审批时状态为 pending', () => {
    const blocks = toolCallBlocks({ ...group, events: [...group.events, event({ type: 'approval_required', toolCallId: 'call-1' })] }, null, '运行命令')
    expect(blocks[0].status).toBe('pending')
  })

  it('失败时追加 ErrorBlock', () => {
    const record = { id: 'call-1', arguments: {}, result: null, status: 'failed', error: '命令退出码 1', durationMs: 5 } as unknown as ToolCallRecord
    const blocks = toolCallBlocks({ ...group, events: [...group.events, event({ type: 'tool_result', toolCallId: 'call-1', tool: 'bash', status: 'failed' })] }, record, '运行命令')
    expect(blocks.at(-1)).toMatchObject({ type: 'error', title: '工具执行失败', detail: '命令退出码 1' })
    expect(blocks[0].status).toBe('error')
  })

  it('绝对路径入参收敛成工作区相对路径，摘要不泄露磁盘布局', () => {
    const files = { toolCallId: 'call-abs', toolName: 'read', events: [event({ toolCallId: 'call-abs', tool: 'read', input: 'K:/cc-project/fa/src/a.ts' })] }
    expect(toolCallBlocks(files, null, '读取文件', 'K:/cc-project/fa')[0]).toMatchObject({ type: 'toolCall', input: 'src/a.ts' })
  })

  it('工作区外的绝对路径只留文件名', () => {
    const outside = { toolCallId: 'call-out', toolName: 'read', events: [event({ toolCallId: 'call-out', tool: 'read', input: 'D:/elsewhere/b.ts' })] }
    expect(toolCallBlocks(outside, null, '读取文件', 'K:/cc-project/fa')[0]).toMatchObject({ type: 'toolCall', input: 'b.ts' })
  })

  it('bash 的 cwd 等于工作区根时不再展示', () => {
    const record = { id: 'c', arguments: { command: 'npm test', cwd: 'K:/app' }, result: { stdout: '', exitCode: 0 }, status: 'success' } as unknown as ToolCallRecord
    const bashGroup = { toolCallId: 'c', toolName: 'bash', events: [event({ type: 'tool_result', toolCallId: 'c', tool: 'bash' })] }
    const terminal = toolCallBlocks(bashGroup, record, '运行命令', 'K:/app')[1] as TerminalBlock
    expect(terminal.type).toBe('terminal')
    expect(terminal.cwd).toBe('')
  })
})

describe('toolCallBlocks 的结果排版', () => {
  function done(toolName: string, args: unknown, result: unknown) {
    const record = { id: 'c', arguments: args, result, status: 'success', durationMs: 8 } as unknown as ToolCallRecord
    const group = { toolCallId: 'c', toolName, events: [event({ type: 'tool_result', toolCallId: 'c', tool: toolName })] }
    return toolCallBlocks(group, record, toolName)[1]
  }

  it('edit 用落库的逐行 diff 渲染 DiffBlock', () => {
    const block = done('edit', { path: 'src/a.ts' }, { summary: 'ok', diff: '+ 1 new', additions: 1, deletions: 0 })
    expect(block).toMatchObject({ type: 'diff', filename: 'src/a.ts', patch: '+ 1 new', additions: 1, deletions: 0 })
  })

  it('patch 用入参里的 unified diff 渲染 DiffBlock', () => {
    const patch = '--- a/x\n+++ b/x\n+a\n-b'
    expect(done('patch', { patch }, { summary: 'ok', additions: 1, deletions: 1 })).toMatchObject({ type: 'diff', patch })
  })

  it('write 渲染写入的内容并按扩展名取语言', () => {
    expect(done('write', { path: 'src/a.ts', content: 'export const a = 1' }, { summary: '已写入 18 字节' }))
      .toMatchObject({ type: 'code', filename: 'src/a.ts', language: 'ts', code: 'export const a = 1' })
  })

  it('read 把文件正文渲染成代码块', () => {
    expect(done('read', { path: 'a.json' }, { summary: '{}' })).toMatchObject({ type: 'code', filename: 'a.json', language: 'json', code: '{}' })
  })

  it('ls 拆成带基准目录的条目列表，目录后缀 / 被剥掉', () => {
    expect(done('ls', { path: 'src' }, { summary: 'main/\nApp.tsx\n\n[500 entries limit reached]' })).toMatchObject({
      type: 'fileList',
      base: 'src',
      note: '500 entries limit reached',
      entries: [
        { name: 'main', path: 'src/main', kind: 'dir' },
        { name: 'App.tsx', path: 'src/App.tsx', kind: 'file' }
      ]
    })
  })

  it('find 的条目本身就是工作区相对路径', () => {
    expect(done('find', { path: '.' }, { summary: 'src/App.tsx\nsrc/main/index.ts' })).toMatchObject({
      type: 'fileList',
      base: '',
      entries: [{ name: 'src/App.tsx', path: 'src/App.tsx', kind: 'file' }, { name: 'src/main/index.ts', path: 'src/main/index.ts', kind: 'file' }]
    })
  })

  it('空目录与失败结果退回纯文本 ToolResultBlock', () => {
    expect(done('ls', { path: 'src' }, { summary: '(empty directory)' })).toMatchObject({ type: 'toolResult' })
    expect(done('grep', { pattern: 'x' }, { summary: 'a.ts:1:x' })).toMatchObject({ type: 'toolResult', summary: 'a.ts:1:x' })
  })

  it('ls 返回的条目已包含基准目录时不重复拼接', () => {
    expect(done('ls', { path: 'src' }, { summary: 'src/main.ts\nsrc/App.tsx' })).toMatchObject({
      type: 'fileList',
      base: 'src',
      entries: [
        { name: 'main.ts', path: 'src/main.ts', kind: 'file' },
        { name: 'App.tsx', path: 'src/App.tsx', kind: 'file' }
      ]
    })
  })

  it('find 带子目录输入路径时仍以「结果是否已含 base」决定是否拼接', () => {
    expect(done('find', { path: 'src' }, { summary: 'main/index.ts\ndeep/main.ts' })).toMatchObject({
      type: 'fileList',
      base: 'src',
      entries: [
        { name: 'src/main/index.ts', path: 'src/main/index.ts', kind: 'file' },
        { name: 'src/deep/main.ts', path: 'src/deep/main.ts', kind: 'file' }
      ]
    })
  })

  it('ls 输入反斜杠路径与路径上的 `.` 段都被规范化', () => {
    expect(done('ls', { path: '.\\src\\deep' }, { summary: 'main.ts' })).toMatchObject({
      type: 'fileList',
      base: 'src/deep',
      entries: [{ name: 'main.ts', path: 'src/deep/main.ts', kind: 'file' }]
    })
  })

  it('算不出增删的工具不带统计，界面据此不显示 +0 -0', () => {
    expect(done('grep', { pattern: 'x' }, { summary: 'hit' })).toMatchObject({ additions: null, deletions: null })
  })

  it('read 的绝对文件路径折成工作区相对路径后再展示', () => {
    const record = { id: 'c', arguments: { path: 'K:/cc-project/fa/src/a.ts' }, result: { summary: '{}' }, status: 'success' } as unknown as ToolCallRecord
    const group = { toolCallId: 'c', toolName: 'read', events: [event({ type: 'tool_result', toolCallId: 'c', tool: 'read' })] }
    const block = toolCallBlocks(group, record, '读取文件', 'K:/cc-project/fa')[1]
    expect(block).toMatchObject({ type: 'code', filename: 'src/a.ts', code: '{}' })
  })

  it('工作区外的绝对路径在结果排版里也只留文件名', () => {
    const record = { id: 'c', arguments: { path: 'D:/elsewhere/x.txt' }, result: { summary: '{}' }, status: 'success' } as unknown as ToolCallRecord
    const group = { toolCallId: 'c', toolName: 'read', events: [event({ type: 'tool_result', toolCallId: 'c', tool: 'read' })] }
    const block = toolCallBlocks(group, record, '读取文件', null)[1]
    expect(block).toMatchObject({ type: 'code', filename: 'x.txt' })
  })
})
