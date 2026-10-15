import { describe, expect, it } from 'vitest'
import { activeMentionQuery, applyMention, enterMentionDirectory, filterSlashCommands, filterSkills, SLASH_COMMANDS } from './file-mention'

describe('activeMentionQuery', () => {
  it('行首与空白后的 @ 触发补全', () => {
    expect(activeMentionQuery('@app', 4)).toEqual({ trigger: '@', start: 0, query: 'app' })
    expect(activeMentionQuery('看下 @src/A', 9)).toEqual({ trigger: '@', start: 3, query: 'src/A' })
  })

  it('刚敲下 @ 时查询为空串，也要给候选', () => {
    expect(activeMentionQuery('看下 @', 4)).toEqual({ trigger: '@', start: 3, query: '' })
  })

  it('邮箱与紧贴单词的 @ 不触发', () => {
    expect(activeMentionQuery('a@b.com', 7)).toBeNull()
    expect(activeMentionQuery('user@host', 9)).toBeNull()
  })

  it('@ 后出现空格即结束，光标在后面不再算提及', () => {
    expect(activeMentionQuery('@src/App.tsx 然后', 15)).toBeNull()
  })

  it('只看光标之前的内容', () => {
    expect(activeMentionQuery('@app tail', 4)).toEqual({ trigger: '@', start: 0, query: 'app' })
  })

  it('行首与空白后的 / 触发 skill 补全', () => {
    expect(activeMentionQuery('/pass', 5)).toEqual({ trigger: '/', start: 0, query: 'pass' })
    expect(activeMentionQuery('用 /git 提交', 6)).toEqual({ trigger: '/', start: 2, query: 'git' })
  })

  it('URL 与路径里的斜杠不触发', () => {
    expect(activeMentionQuery('https://example.com', 19)).toBeNull()
    expect(activeMentionQuery('/usr/bin', 8)).toBeNull()
    expect(activeMentionQuery('24/7', 4)).toBeNull()
  })

  it('刚敲下 / 时查询为空串，也要给候选', () => {
    expect(activeMentionQuery('/', 1)).toEqual({ trigger: '/', start: 0, query: '' })
  })
})

describe('applyMention', () => {
  it('替换 @query 片段、去掉 @ 前缀并把光标停在补出的空格后', () => {
    const result = applyMention('看下 @app 的实现', { trigger: '@', start: 3, query: 'app' }, 'src/App.tsx')
    expect(result.text).toBe('看下 src/App.tsx  的实现')
    expect(result.caret).toBe(3 + 'src/App.tsx '.length)
  })

  it('空查询也能插入', () => {
    expect(applyMention('@', { trigger: '@', start: 0, query: '' }, 'a.ts').text).toBe('a.ts ')
  })

  it('/ 选中 skill 后只插入名称，不带斜杠', () => {
    expect(applyMention('/', { trigger: '/', start: 0, query: '' }, 'git-commit-standard').text).toBe('git-commit-standard ')
  })
})

describe('enterMentionDirectory', () => {
  it('保留 @ 并把查询换成目录段，菜单可以接着列下一层', () => {
    const mention = activeMentionQuery('看看 @sr', 6)!
    const result = enterMentionDirectory('看看 @sr', mention, 'src')
    expect(result.text).toBe('看看 @src/')
    expect(result.caret).toBe(8)
    expect(result.mention).toEqual({ trigger: '@', start: 3, query: 'src/' })
  })

  it('再进一层时以当前查询为基准替换，不会叠加出重复路径', () => {
    const mention = activeMentionQuery('@src/', 5)!
    const result = enterMentionDirectory('@src/', mention, 'src/renderer')
    expect(result.text).toBe('@src/renderer/')
    expect(result.mention.query).toBe('src/renderer/')
  })

  it('结果仍能被 activeMentionQuery 重新识别', () => {
    const result = enterMentionDirectory('@sr', activeMentionQuery('@sr', 3)!, 'src')
    expect(activeMentionQuery(result.text, result.caret)).toEqual(result.mention)
  })
})

describe('filterSkills', () => {
  const records = [
    { name: 'git-commit-standard', description: '生成规范提交', enabled: true },
    { name: 'disabled-skill', description: 'git 相关', enabled: false },
    { name: 'planner', description: '制定计划', enabled: true }
  ]

  it('只保留已启用且名称或描述命中的', () => {
    expect(filterSkills(records, 'git').map((record) => record.name)).toEqual(['git-commit-standard'])
    expect(filterSkills(records, '提交').map((record) => record.name)).toEqual(['git-commit-standard'])
  })

  it('空查询返回全部已启用', () => {
    expect(filterSkills(records, '')).toHaveLength(2)
  })

  it('不区分大小写', () => {
    expect(filterSkills(records, 'GIT').map((record) => record.name)).toEqual(['git-commit-standard'])
    expect(filterSkills([{ name: 'visualize', description: '可视化', enabled: true }], 'Visualize').map((record) => record.name)).toEqual(['visualize'])
  })

  it('名称命中排在描述命中之前，截断不会把它挤掉', () => {
    const many = [
      { name: 'aaa', description: 'v i s u a l 描述里凑得出子序列', enabled: true },
      { name: 'bbb', description: 'v-i-s 同样凑得出', enabled: true },
      { name: 'visualize', description: '界面方案可视化', enabled: true }
    ]
    expect(filterSkills(many, 'vis', 2).map((record) => record.name)).toEqual(['visualize', 'aaa'])
  })

  it('名称前缀优先于名称子序列', () => {
    const many = [
      { name: 'data-visualization-helper', description: '', enabled: true },
      { name: 'visualize', description: '', enabled: true }
    ]
    expect(filterSkills(many, 'visu').map((record) => record.name)).toEqual(['visualize', 'data-visualization-helper'])
  })
})

describe('filterSlashCommands', () => {
  it('按名称前缀匹配，空查询返回全部', () => {
    expect(filterSlashCommands(SLASH_COMMANDS, 'p')).toEqual([{ name: 'pass', description: '切换/退出完全访问权限，执行不再询问' }])
    expect(filterSlashCommands(SLASH_COMMANDS, '')).toEqual(SLASH_COMMANDS)
    expect(filterSlashCommands(SLASH_COMMANDS, 'c')).toEqual([
      { name: 'clear', description: '清空当前会话的全部消息与上下文' },
      { name: 'compact', description: '压缩当前会话的较早上下文' }
    ])
    expect(filterSlashCommands(SLASH_COMMANDS, 'xyz')).toEqual([])
  })
})
