import { describe, expect, it } from 'vitest'
import { analyzeCodeStyle, detectExistingAgentFile, detectTechStack, extractMakefileTargets, extractProjectCommands, isProjectConfigFile, pickStyleSampleFiles, walkProjectTree, type SurveyDirEntry } from './project-survey'

function fakeTree(tree: Record<string, SurveyDirEntry[]>) {
  return (path: string): SurveyDirEntry[] => {
    const key = path.replace(/\\/g, '/')
    if (!(key in tree)) throw new Error(`no such directory: ${key}`)
    return tree[key]
  }
}

describe('walkProjectTree', () => {
  it('跳过依赖与产物目录，保留根目录下的配置类点文件', () => {
    const readDir = fakeTree({
      '/p': [
        { name: 'node_modules', directory: true },
        { name: 'dist', directory: true },
        { name: '.git', directory: true },
        { name: '.gitignore', directory: false },
        { name: '.env', directory: false },
        { name: 'src', directory: true },
        { name: 'package.json', directory: false }
      ],
      '/p/src': [{ name: 'index.ts', directory: false }]
    })
    const { entries, truncated } = walkProjectTree('/p', readDir)
    expect(truncated).toBe(false)
    expect(entries).toEqual(['.gitignore', 'package.json', 'src/', 'src/index.ts'])
    // .env 是凭据文件，扫描结果会整段进提示词，不能带进去
    expect(entries).not.toContain('.env')
  })

  it('读目录失败不中断整棵树', () => {
    const readDir = fakeTree({
      '/p': [{ name: 'a', directory: true }, { name: 'b', directory: true }],
      '/p/b': [{ name: 'ok.ts', directory: false }]
    })
    expect(walkProjectTree('/p', readDir).entries).toEqual(['a/', 'b/', 'b/ok.ts'])
  })

  it('超过条目上限时截断并置标志', () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ name: `f${index}.ts`, directory: false }))
    const { entries, truncated } = walkProjectTree('/p', fakeTree({ '/p': many }))
    expect(truncated).toBe(true)
    expect(entries).toHaveLength(160)
  })
})

describe('isProjectConfigFile', () => {
  it('认得常见配置文件，不误收普通源码', () => {
    for (const name of ['package.json', 'tsconfig.json', 'tsconfig.node.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Makefile', 'Dockerfile', '.gitignore', 'vitest.config.ts', 'electron.vite.config.ts', 'README.md']) {
      expect(isProjectConfigFile(name)).toBe(true)
    }
    for (const name of ['index.ts', 'notes.md', 'package-lock.json', '.env']) {
      expect(isProjectConfigFile(name)).toBe(false)
    }
  })
})

describe('detectTechStack', () => {
  it('从依赖与配置文件推断技术栈', () => {
    const stack = detectTechStack({
      configFiles: ['package.json', 'Dockerfile'],
      packageJson: JSON.stringify({ type: 'module', dependencies: { react: '^19.0.0' }, devDependencies: { typescript: '^5', vitest: '^3' } })
    })
    expect(stack).toEqual(expect.arrayContaining(['Node.js / npm 包', 'ESM 模块', 'React', 'TypeScript', 'Vitest', 'Docker']))
  })

  it('package.json 解析失败时不炸，退回文件级推断', () => {
    expect(detectTechStack({ configFiles: ['Cargo.toml'], packageJson: '{ not json' })).toEqual(['Rust / Cargo'])
  })

  it('pyproject 里的工具段落算进技术栈', () => {
    expect(detectTechStack({ configFiles: ['pyproject.toml'], pyproject: '[tool.ruff]\n[tool.pytest.ini_options]' }))
      .toEqual(expect.arrayContaining(['Python（pyproject）', 'Ruff', 'pytest']))
  })
})

describe('extractProjectCommands', () => {
  it('npm scripts 带上原始定义，便于模型判断命令真伪', () => {
    const commands = extractProjectCommands({ configFiles: ['package.json'], packageJson: JSON.stringify({ scripts: { build: 'electron-vite build', test: 'vitest run', broken: 3 } }) })
    expect(commands).toEqual([
      { label: 'build', command: 'npm run build', source: 'package.json scripts.build → electron-vite build' },
      { label: 'test', command: 'npm run test', source: 'package.json scripts.test → vitest run' }
    ])
  })

  it('Makefile、Cargo、go 与 pyproject 各自补命令', () => {
    const commands = extractProjectCommands({
      configFiles: ['Cargo.toml', 'go.mod'],
      makefile: 'build:\n\tgo build\nCC := gcc\n.PHONY: build\n',
      pyproject: '[tool.pytest.ini_options]'
    })
    expect(commands.map((item) => item.command)).toEqual(['make build', 'cargo build', 'cargo test', 'go build ./...', 'go test ./...', 'pytest'])
  })
})

describe('extractMakefileTargets', () => {
  it('忽略变量赋值与特殊目标', () => {
    expect(extractMakefileTargets('CC := gcc\n.PHONY: all\nall:\n\techo hi\ntest: all\n')).toEqual(['all', 'test'])
  })
})

describe('analyzeCodeStyle', () => {
  it('给出多数派结论并附占比', () => {
    const content = ["import { a } from './a'", 'function run() {', "  const value = 'x'", '  return value', '}', ''].join('\n')
    const notes = analyzeCodeStyle([{ path: 'src/run-task.ts', content }, { path: 'src/load-data.ts', content }])
    expect(notes.join('\n')).toContain('缩进主要是 2 空格')
    expect(notes.join('\n')).toContain('单引号')
    expect(notes.join('\n')).toContain('kebab-case')
  })

  it('没有样本时不硬凑结论', () => {
    expect(analyzeCodeStyle([])).toEqual([])
  })
})

describe('pickStyleSampleFiles', () => {
  it('只挑源码文件，跳过测试、声明文件与目录', () => {
    const picked = pickStyleSampleFiles(['src/', 'src/a.ts', 'src/a.test.ts', 'src/types.d.ts', 'README.md', 'src/b.py'], 10)
    expect(picked).toEqual(['src/a.ts', 'src/b.py'])
  })
})

describe('detectExistingAgentFile', () => {
  it('只认根目录下的指令文件，AGENTS.md 优先', () => {
    expect(detectExistingAgentFile(['AGENTS.md', 'CLAUDE.md'])).toBe('AGENTS.md')
    expect(detectExistingAgentFile(['CLAUDE.md'])).toBe('CLAUDE.md')
    expect(detectExistingAgentFile(['docs/AGENTS.md'])).toBeNull()
    expect(detectExistingAgentFile([])).toBeNull()
  })
})
