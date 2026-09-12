import { describe, expect, it } from 'vitest'
import { buildModeRuntimePrompt, builtInModeSystemPrompts, defaultModePrompts, modePromptFor, normalizeSavedModePrompt, PLAN_MODE_PROMPT, withPlanModePrompt } from './mode-prompts'

describe('mode prompts', () => {
  it('provides a prompt for each conversation mode', () => {
    expect(defaultModePrompts).toEqual({ chat: '', agent: '' })
    expect(builtInModeSystemPrompts.chat).toContain('通用对话助手')
    expect(builtInModeSystemPrompts.agent).toContain('任务执行型智能体')
  })

  it('keeps an empty saved value separate from the system prompt', () => {
    expect(modePromptFor({ ...defaultModePrompts, agent: '  ' }, 'agent')).toBe('')
  })

  it('clears the previous built-in default during migration', () => {
    expect(normalizeSavedModePrompt('你是通用对话助手。直接回答用户问题，保持准确、清晰、简洁。当前任务不允许访问或修改本地文件，也不能执行命令。', 'chat')).toBe('')
    expect(normalizeSavedModePrompt('keep this custom instruction', 'chat')).toBe('keep this custom instruction')
  })

  it('places the selected mode prompt before the user task and attachments', () => {
    expect(buildModeRuntimePrompt('Use short answers.', 'Fix this bug.', '\n\n--- notes.md ---\ncontext')).toBe(
      '【用户补充提示词】\nUse short answers.\n\n【用户任务】\nFix this bug.\n\n--- notes.md ---\ncontext'
    )
  })

  it('inserts the compacted summary between the mode prompt and the user task', () => {
    expect(buildModeRuntimePrompt('Use short answers.', 'Fix this bug.', '', 'Current goal\n- ship tray')).toBe(
      '【用户补充提示词】\nUse short answers.\n\n【已压缩上下文摘要】\nCurrent goal\n- ship tray\n\n【用户任务】\nFix this bug.'
    )
  })

  it('keeps the raw prompt when there is neither a mode prompt nor a summary', () => {
    expect(buildModeRuntimePrompt('  ', 'Fix this bug.')).toBe('Fix this bug.')
  })
})

describe('withPlanModePrompt', () => {
  it('计划模式把只读约束拼在用户提示词之前', () => {
    expect(withPlanModePrompt('自定义要求', true)).toBe(`${PLAN_MODE_PROMPT}

自定义要求`)
  })

  it('用户提示词为空时不留下多余空行', () => {
    expect(withPlanModePrompt('', true)).toBe(PLAN_MODE_PROMPT)
  })

  it('关闭计划模式时原样返回', () => {
    expect(withPlanModePrompt('自定义要求', false)).toBe('自定义要求')
  })
})
