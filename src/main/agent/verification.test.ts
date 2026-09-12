import { describe, expect, it } from 'vitest'
import { detectPackageManager, detectVerificationCommands, isVerificationCommand, verificationPrompt } from './verification'

const packageJson = (scripts: Record<string, string>) => JSON.stringify({ name: 'demo', scripts })

describe('detectPackageManager', () => {
  it('按 lockfile 判定，pnpm 优先于 yarn 与 npm', () => {
    expect(detectPackageManager({ hasPnpmLock: true, hasYarnLock: true, hasNpmLock: true })).toBe('pnpm')
    expect(detectPackageManager({ hasYarnLock: true, hasNpmLock: true })).toBe('yarn')
    expect(detectPackageManager({ hasNpmLock: true })).toBe('npm')
  })

  it('没有任何 lockfile 时回落到 npm', () => {
    expect(detectPackageManager({})).toBe('npm')
  })
})

describe('detectVerificationCommands', () => {
  it('只认 package.json 里确实声明过的脚本', () => {
    const commands = detectVerificationCommands({ packageJson: packageJson({ test: 'vitest', build: 'vite build' }) })
    expect(commands.map((command) => command.id)).toEqual(['npm:test', 'npm:build'])
  })

  it('未声明的脚本不会被猜出来', () => {
    const commands = detectVerificationCommands({ packageJson: packageJson({ test: 'vitest' }) })
    expect(commands.some((command) => command.id === 'npm:lint')).toBe(false)
  })

  it('命令带上探测到的包管理器', () => {
    const commands = detectVerificationCommands({ packageJson: packageJson({ test: 'vitest' }) }, 'pnpm')
    expect(commands[0].command).toBe('pnpm run test')
  })

  it('按固定顺序输出：类型检查、lint、测试、构建', () => {
    const commands = detectVerificationCommands({ packageJson: packageJson({ build: 'x', test: 'x', lint: 'x', typecheck: 'x' }) })
    expect(commands.map((command) => command.kind)).toEqual(['typecheck', 'lint', 'test', 'build'])
  })

  it('package.json 损坏时不抛异常，按无脚本处理', () => {
    expect(detectVerificationCommands({ packageJson: '{ not json' })).toEqual([])
  })

  it('Python 项目只建议 pyproject 里提到的工具', () => {
    const commands = detectVerificationCommands({ pyprojectToml: '[tool.ruff]\nline-length = 120\n' })
    expect(commands.map((command) => command.id)).toEqual(['py:ruff'])
  })

  it('Rust 与 Go 的测试命令由工具链固定', () => {
    expect(detectVerificationCommands({ cargoToml: '[package]' })[0].command).toBe('cargo test')
    expect(detectVerificationCommands({ goMod: 'module demo' })[0].command).toBe('go test ./...')
  })

  it('没有任何清单时不给建议', () => {
    expect(detectVerificationCommands({})).toEqual([])
  })

  it('多语言仓库把各自的命令都列出来', () => {
    const commands = detectVerificationCommands({ packageJson: packageJson({ test: 'x' }), cargoToml: '[package]' })
    expect(commands.map((command) => command.id)).toEqual(['npm:test', 'cargo:test'])
  })
})

describe('verificationPrompt', () => {
  it('没有命令时不产出任何文本', () => {
    expect(verificationPrompt([])).toBe('')
  })

  it('列出命令并明确要求实际执行验证', () => {
    const prompt = verificationPrompt(detectVerificationCommands({ packageJson: packageJson({ test: 'vitest' }) }))
    expect(prompt).toContain('`npm run test`')
    expect(prompt).toContain('来自 package.json')
    expect(prompt).toContain('代码写出来不等于任务完成')
    // 明确禁止反复重试，避免验证循环变成死循环
    expect(prompt).toContain('不要反复重试同一条命令')
  })
})

describe('isVerificationCommand', () => {
  const commands = detectVerificationCommands({ packageJson: packageJson({ test: 'vitest' }) })

  it('认出验证命令，前后空白不影响', () => {
    expect(isVerificationCommand('npm run test', commands)).toBe(true)
    expect(isVerificationCommand('  npm run test  ', commands)).toBe(true)
  })

  it('不是验证命令的照常受死循环守卫约束', () => {
    expect(isVerificationCommand('rm -rf build', commands)).toBe(false)
    // 只是前缀相同不算：带了额外参数就不再是那条已知命令
    expect(isVerificationCommand('npm run test -- --watch', commands)).toBe(false)
  })

  it('没有探测到命令时一律不豁免', () => {
    expect(isVerificationCommand('npm run test', [])).toBe(false)
  })
})
