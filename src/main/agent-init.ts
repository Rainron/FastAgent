// /init 命令的 AGENTS.md 模板生成：纯函数，主进程写入时调用，便于测试。

export const AGENT_INIT_FILE_NAME = 'AGENTS.md'

/** 项目根目录已存在的 agent 记忆文件（存在则不覆盖）。 */
export const AGENT_INIT_ALTERNATIVES = ['AGENTS.md', 'CLAUDE.md'] as const

/** 返回已存在的记忆文件名；没有则返回 null。优先认 AGENTS.md。 */
export function detectExistingAgentInitFile(files: string[]): string | null {
  for (const name of AGENT_INIT_ALTERNATIVES) {
    if (files.includes(name)) return name
  }
  return null
}

/** 生成初始 AGENTS.md：面向 agent 的项目指南，结构对齐常见仓库指南。 */
export function buildAgentInitTemplate(projectName: string): string {
  return `# ${projectName}

## 项目说明
用一两句话描述项目用途与技术栈（由项目所有者补充）。

## 常用命令
- 构建：\`npm run build\`
- 测试：\`npm test\`
- 类型检查：\`npm run typecheck\`

## 编码风格
- 保持现有代码风格，不做无关重构。
- 代码注释用中文，只写原因，不复述代码。

## 修改原则
- 只实现需求描述的行为，不添加多余功能或抽象层。
- 只改必要文件，不顺手格式化或修复邻近代码。

## 测试与验证
- 修改逻辑后运行相关测试与类型检查，确认不引入回归。
- 不通过删断言、跳测试或硬编码制造测试通过。

## 提交规范
- 使用 Conventional Commits，正文用中文描述改动。
`
}