import type { PluginCatalogEntry } from './catalog'

function skillFile(name: string, description: string, version: string, author: string, body: string) {
  return `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\nauthor: ${author}\n---\n\n${body}\n`
}

/**
 * 内置插件目录。条目内嵌安装载荷，安装流程不依赖网络，
 * 后续换远端 registry 时替换 PluginCatalogProvider 实现即可。
 */
export const builtinCatalog: PluginCatalogEntry[] = [
  {
    id: 'skill.frontend-design',
    name: 'frontend-design',
    displayName: '前端设计规范',
    description: '为界面改动提供视觉方向、排版与组件层级的判断依据，避免默认模板感。',
    abilityType: 'skill',
    author: 'FastAgent',
    version: '1.0.0',
    categories: ['开发', '设计'],
    tags: ['ui', 'design', 'frontend'],
    icon: 'Palette',
    publishedAt: '2026-06-01T00:00:00.000Z',
    downloadCount: 4820,
    featured: true,
    trending: 92,
    permissions: { runsLocalCode: false, networkAccess: false, fileAccess: false },
    configFields: [],
    readme: '# 前端设计规范\n\n在新建界面或重塑既有界面时提供设计判断：排版层级、间距节奏、色彩用法与组件粒度。\n\n安装后需在能力页显式启用，Agent 才会加载。',
    payload: {
      kind: 'skill',
      files: {
        'SKILL.md': skillFile(
          'frontend-design',
          '在新建或重塑界面时提供视觉方向、排版层级与组件粒度的判断依据',
          '1.0.0',
          'FastAgent',
          [
            '## 使用时机',
            '',
            '需要新建界面、重做布局或统一视觉风格时使用。',
            '',
            '## 判断顺序',
            '',
            '1. 先定信息层级：页面上最重要的一件事是什么，其余都为它让位。',
            '2. 再定排版节奏：正文字号、行高与标题层级先固定，再排间距。',
            '3. 最后才选颜色：主色只用于唯一的主操作，状态色与主色不共用。',
            '',
            '## 红线',
            '',
            '- 不用超大卡片堆信息密度低的内容。',
            '- 不在同一页面出现两种圆角体系或两套阴影层级。',
            '- 同一语义状态在全应用只允许一种颜色。'
          ].join('\n')
        )
      }
    }
  },
  {
    id: 'skill.code-review',
    name: 'code-review',
    displayName: '代码评审清单',
    description: '按正确性、边界条件、错误处理与可维护性四层给出评审要点，只报高置信度问题。',
    abilityType: 'skill',
    author: 'FastAgent',
    version: '1.1.0',
    categories: ['开发', '质量'],
    tags: ['review', 'quality'],
    icon: 'ClipboardCheck',
    publishedAt: '2026-07-12T00:00:00.000Z',
    downloadCount: 3610,
    featured: true,
    trending: 78,
    permissions: { runsLocalCode: false, networkAccess: false, fileAccess: false },
    configFields: [],
    readme: '# 代码评审清单\n\n把评审拆成正确性、边界、错误处理、可维护性四层，逐层出结论，避免只挑格式问题。',
    payload: {
      kind: 'skill',
      files: {
        'SKILL.md': skillFile(
          'code-review',
          '按正确性、边界条件、错误处理与可维护性四层评审代码，只报高置信度问题',
          '1.1.0',
          'FastAgent',
          [
            '## 使用时机',
            '',
            '评审 diff、PR 或刚写完的一段实现时使用。',
            '',
            '## 四层顺序',
            '',
            '1. 正确性：逻辑是否达成声明的行为，有没有走错分支。',
            '2. 边界：空值、零长度、并发、超时、取消路径。',
            '3. 错误处理：异常是否被吞掉，失败是否有可诊断的信息。',
            '4. 可维护性：命名、重复、抽象层级是否与周边一致。',
            '',
            '## 输出要求',
            '',
            '每条结论给出文件与行号、失败场景、修复方向。没有把握的不报。'
          ].join('\n')
        )
      }
    }
  },
  {
    id: 'skill.api-docs',
    name: 'api-docs',
    displayName: 'API 文档撰写',
    description: '从实现代码反推接口契约，生成含参数、错误码与示例的接口文档。',
    abilityType: 'skill',
    author: 'FastAgent',
    version: '0.9.0',
    categories: ['文档', '开发'],
    tags: ['docs', 'api'],
    icon: 'FileText',
    publishedAt: '2026-05-20T00:00:00.000Z',
    downloadCount: 1290,
    trending: 41,
    permissions: { runsLocalCode: false, networkAccess: false, fileAccess: false },
    configFields: [],
    readme: '# API 文档撰写\n\n以实现代码为唯一事实来源反推契约，不臆造字段。',
    payload: {
      kind: 'skill',
      files: {
        'SKILL.md': skillFile(
          'api-docs',
          '从实现代码反推接口契约，生成含参数、错误码与示例的接口文档',
          '0.9.0',
          'FastAgent',
          [
            '## 使用时机',
            '',
            '需要为既有接口补文档，或接口改动后同步文档时使用。',
            '',
            '## 步骤',
            '',
            '1. 先读路由与处理函数，确认真实的入参与出参。',
            '2. 再读校验与异常分支，整理错误码表。',
            '3. 示例请求与响应必须来自代码里能实际产生的形状。',
            '',
            '## 红线',
            '',
            '不臆造字段；代码里没有的参数不写进文档。'
          ].join('\n')
        )
      }
    }
  },
  {
    id: 'mcp.filesystem',
    name: 'filesystem',
    displayName: 'Filesystem MCP',
    description: '让 Agent 以受限方式读写指定目录下的文件，适合把资料目录接入对话。',
    abilityType: 'mcp',
    author: 'Model Context Protocol',
    version: '1.0.0',
    categories: ['文件', '开发'],
    tags: ['filesystem', 'stdio'],
    icon: 'FolderOpen',
    homepage: 'https://modelcontextprotocol.io',
    repository: 'https://github.com/modelcontextprotocol/servers',
    publishedAt: '2026-04-08T00:00:00.000Z',
    downloadCount: 8730,
    featured: true,
    trending: 96,
    permissions: {
      runsLocalCode: true,
      networkAccess: true,
      fileAccess: true,
      commands: ['npx -y @modelcontextprotocol/server-filesystem']
    },
    configFields: [
      {
        key: 'cwd',
        label: '工作目录',
        target: 'cwd',
        required: true,
        secret: false,
        placeholder: 'D:\\workspace\\docs',
        description: '服务进程的工作目录，也是可访问文件的根。'
      }
    ],
    readme: '# Filesystem MCP\n\n以 stdio 方式启动官方 filesystem server，通过 npx 下载并运行本地进程。\n\n安装前请确认已安装 Node.js，且指定目录中不含敏感文件。',
    payload: {
      kind: 'mcp',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      timeoutMs: 30_000
    }
  },
  {
    id: 'mcp.github',
    name: 'github',
    displayName: 'GitHub MCP',
    description: '检索仓库、Issue 与 Pull Request，需要提供个人访问令牌。',
    abilityType: 'mcp',
    author: 'Model Context Protocol',
    version: '1.2.0',
    categories: ['开发', '协作'],
    tags: ['github', 'stdio', 'vcs'],
    icon: 'Github',
    homepage: 'https://modelcontextprotocol.io',
    repository: 'https://github.com/modelcontextprotocol/servers',
    publishedAt: '2026-07-30T00:00:00.000Z',
    downloadCount: 6410,
    trending: 88,
    permissions: {
      runsLocalCode: true,
      networkAccess: true,
      fileAccess: false,
      commands: ['npx -y @modelcontextprotocol/server-github'],
      envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN']
    },
    configFields: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub 访问令牌',
        target: 'env',
        required: true,
        secret: true,
        placeholder: 'ghp_...',
        description: '写入系统加密存储，不会回传给界面，也不进日志。'
      }
    ],
    readme: '# GitHub MCP\n\n以 stdio 方式运行官方 github server。令牌通过环境变量传给子进程，落盘时经系统加密。\n\n建议使用只读权限的令牌。',
    payload: {
      kind: 'mcp',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      timeoutMs: 30_000
    }
  },
  {
    id: 'mcp.context7',
    name: 'context7',
    displayName: 'Context7 文档服务',
    description: '通过 Streamable HTTP 获取主流框架的最新文档，需要 API Key 作为请求头。',
    abilityType: 'mcp',
    author: 'Upstash',
    version: '1.0.0',
    categories: ['文档', '检索'],
    tags: ['docs', 'http', 'remote'],
    icon: 'BookOpen',
    homepage: 'https://context7.com',
    publishedAt: '2026-08-05T00:00:00.000Z',
    downloadCount: 2150,
    trending: 74,
    permissions: {
      runsLocalCode: false,
      networkAccess: true,
      fileAccess: false
    },
    configFields: [
      {
        key: 'Authorization',
        label: 'Authorization 请求头',
        target: 'header',
        required: true,
        secret: true,
        placeholder: 'Bearer ctx7-...',
        description: '每次请求都会带上的鉴权头，写入系统加密存储。'
      },
      {
        key: 'url',
        label: '服务地址',
        target: 'url',
        required: false,
        secret: false,
        placeholder: 'https://mcp.context7.com/mcp',
        description: '留空则使用官方地址。'
      }
    ],
    readme: '# Context7 文档服务\n\n远端 Streamable HTTP MCP，不在本机启动进程，但每次调用都会把查询内容发送到外部服务。',
    payload: {
      kind: 'mcp',
      transport: 'streamable_http',
      url: 'https://mcp.context7.com/mcp',
      timeoutMs: 30_000
    }
  }
]
