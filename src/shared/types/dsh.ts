/**
 * DeepSeek Harness（dsh）插件的进程间类型。
 *
 * dsh 插件是 Cordis 插件：一个 npm 包，导出 `name` / `inject` / `apply(ctx)`，
 * 在 `apply` 里往 `ctx.tools` 注册工具。FastAgent 自己起一棵最小 Cordis 树承载它们，
 * 不依赖 dsh CLI 与 $DSH_HOME。
 */

/** 宿主实现了的 Cordis 服务。插件 inject 了这之外的名字就无法激活。 */
export const DSH_PROVIDED_SERVICES = ['tools', 'systemPrompt'] as const

export interface DshToolSummary {
  name: string
  description: string
  /** ToolRuntime.schemas() 直接产出的标准 JSON Schema，无需再转换 */
  parameters: Record<string, unknown>
}

/**
 * 插件在宿主里的激活结果。
 * inject 了宿主没实现的 seam 时 Cordis 会把 fiber 挂起而不是报错，
 * 这里必须把它跟「真失败」分开，否则界面上会表现成静默失灵。
 */
export type DshPluginActivation =
  | {
    status: 'active'
    /** 实际接入对话的工具 */
    tools: DshToolSummary[]
    /** 与内置工具或先挂载插件重名、因而没有接入的工具名；没有冲突时缺省 */
    conflicts?: string[]
  }
  | { status: 'inactive'; missingServices: string[] }
  | { status: 'failed'; message: string }

export interface DshPluginRecord {
  /** npm 包名，同时是主键 */
  name: string
  version: string
  displayName: string
  description: string
  author?: string
  homepage?: string
  /** 安装目录，位于 appPaths.dshPluginsDir 下 */
  installPath: string
  /** package.json 的 main，相对 installPath */
  mainEntry: string
  enabled: boolean
  /** 包声明的 Cordis 服务依赖 */
  inject: string[]
  /** 用户填的插件配置，原样传给 ctx.plugin 的第二个参数 */
  config: Record<string, unknown>
  installedAt: string
  /** 最近一次挂载结果；从未挂过为 null */
  activation: DshPluginActivation | null
}

/**
 * 安装前按最新版 package.json 预判的兼容性：block 装了也挂不上（非 ESM、不是 dsh 插件、cordis 大版本不符、
 * 带安装脚本等），warn 能装但可能激活失败或接口不兼容。
 */
export interface DshCompat {
  level: 'ok' | 'warn' | 'block'
  reasons: string[]
}

/** npm registry 搜索结果，安装前只有 metadata。 */
export interface DshSearchHit {
  name: string
  version: string
  description: string
  author?: string
  publishedAt?: string
  homepage?: string
  /** 已装同名插件时带上本地版本，用于显示「可更新」 */
  installedVersion?: string
  /** 预判结果；拉取元数据失败时缺省，界面不下结论 */
  compat?: DshCompat
}

export interface DshHostState {
  running: boolean
  /** 宿主锁定的 dsh 运行时版本，界面用它说明兼容区间 */
  runtimeVersion: string
  /** 宿主崩溃或启动失败时的原因 */
  error?: string
}

export interface DshInstallResult {
  name: string
  version: string
  /** 安装即停用，不会立刻挂载；只有重装一个原本已启用的插件才带激活结果。 */
  activation: DshPluginActivation | null
  /** 能装但可能挂不上的原因（peer 版本不符、依赖宿主没有的组件）；没有时为空数组 */
  warnings: string[]
}
