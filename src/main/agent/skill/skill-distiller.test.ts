import { describe, expect, it } from 'vitest'
import { buildDistillPrompt, parseSkillDraft, MAX_DISTILL_TURNS } from './skill-distiller'

describe('buildDistillPrompt', () => {
  it('clips transcript to last N turns', () => {
    const turns = Array.from({ length: MAX_DISTILL_TURNS + 5 }, (_, index) => ({ user: `q${index}`, assistant: `a${index}` }))
    const prompt = buildDistillPrompt({ title: 't', turns })
    expect(prompt).toContain(`q${MAX_DISTILL_TURNS + 4}`)
    expect(prompt).not.toContain('q0\n')
  })
})

describe('parseSkillDraft', () => {
  it('parses frontmatter and instructions', () => {
    const draft = parseSkillDraft('---\nname: release-flow\ndescription: 发布前检查清单\n---\n\n1. 跑测试\n2. 打包')
    expect(draft).toEqual({ name: 'release-flow', description: '发布前检查清单', instructions: '1. 跑测试\n2. 打包' })
  })

  it('rejects invalid name, empty body, missing frontmatter; multiline description keeps first line', () => {
    expect(parseSkillDraft('---\nname: Release Flow\ndescription: x\n---\nbody')).toBeNull()
    expect(parseSkillDraft('---\nname: ok-name\ndescription: x\n---\n')).toBeNull()
    expect(parseSkillDraft('no frontmatter')).toBeNull()
    expect(parseSkillDraft('---\nname: ok-name\ndescription: line1\nline2\n---\nbody')?.description).toBe('line1')
  })

  it('rejects secret-like content', () => {
    expect(parseSkillDraft('---\nname: leak\ndescription: x\n---\napi_key: sk-abcdefghijklmnop1234')).toBeNull()
  })
})
