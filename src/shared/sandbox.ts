// Agent 沙箱的设置与策略内核：主进程与渲染进程共用，无 Node/Electron 依赖。

export type SandboxMode = 'standard' | 'strict'
export type SandboxNetworkMode = 'off' | 'restricted' | 'full'
export type SandboxStatus = 'ready' | 'not_initialized' | 'unsupported' | 'broken' | 'outdated'

export interface SandboxSettings {
  enabled: boolean
  mode: SandboxMode
  networkMode: SandboxNetworkMode
  allowedDomains: string[]
  /** 沙箱不可用时是否允许直接以当前用户身份执行；默认关闭，禁止静默降级 */
  allowUnsandboxedFallback: boolean
}

export interface SandboxPolicy {
  enabled: boolean
  mode: SandboxMode
  filesystem: {
    workspacePath: string | null
    workspaceRead: boolean
    workspaceWrite: boolean
    denyRead: string[]
    denyWrite: string[]
    allowRead: string[]
    allowWrite: string[]
  }
  network: {
    mode: SandboxNetworkMode
    allowedDomains: string[]
  }
  process: {
    allowUnsandboxedFallback: boolean
    timeoutMs: number
    maxProcesses: number
  }
}

export const SANDBOX_MODES: readonly SandboxMode[] = ['standard', 'strict']
export const SANDBOX_NETWORK_MODES: readonly SandboxNetworkMode[] = ['off', 'restricted', 'full']
export const SANDBOX_STATUSES: readonly SandboxStatus[] = ['ready', 'not_initialized', 'unsupported', 'broken', 'outdated']

/** 第一阶段没有域名代理，restricted 无法真正生效，默认落在 full。 */
export const defaultSandboxSettings: SandboxSettings = {
  enabled: true,
  mode: 'standard',
  networkMode: 'full',
  allowedDomains: ['github.com', 'api.github.com', 'registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org'],
  allowUnsandboxedFallback: false
}

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_MAX_PROCESSES = 64

/** 敏感目录片段：账户隔离已经挡住大部分，这里作为策略层的第二道声明。 */
export const SENSITIVE_PATH_SEGMENTS: readonly string[] = [
  '.ssh',
  '.aws',
  '.azure',
  '.kube',
  '.gnupg',
  '.fa',
  'AppData/Local/Google/Chrome/User Data',
  'AppData/Local/Microsoft/Edge/User Data',
  'AppData/Roaming/Mozilla',
  'AppData/Roaming/npm/etc',
  'AppData/Local/Microsoft/Credentials',
  'AppData/Roaming/Microsoft/Credentials'
]

/**
 * 进入沙箱的环境变量白名单。
 *
 * 只放 PATH 不够：mvn/gradle 靠 JAVA_HOME 定位 JDK，安装器脚本靠 ProgramFiles 定位安装根，
 * 少一个就整条工具链报「找不到」。凭据由 ENV_DENY_PATTERNS 二次剔除，用户身份类变量
 * （USERPROFILE / APPDATA / TEMP 等）在 runner 里会被换成沙箱账户自己的值。
 */
export const ENV_ALLOW_LIST: readonly string[] = [
  // 系统基础
  'PATH',
  'PATHEXT',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'WINDIR',
  'SYSTEMDRIVE',
  'COMSPEC',
  'PSMODULEPATH',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'OS',
  'LANG',
  'LC_ALL',
  // 用户身份与安装根：沙箱内会被替换成沙箱账户的值，非沙箱路径下按 Host 原值
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'USERNAME',
  'USERDOMAIN',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'PROGRAMDATA',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  // 工具链根目录：PATH 之外还需要这些才能定位 SDK
  'JAVA_HOME',
  'JDK_HOME',
  'JRE_HOME',
  'JAVA_TOOL_OPTIONS',
  'M2_HOME',
  'MAVEN_HOME',
  'MAVEN_OPTS',
  'GRADLE_HOME',
  'GRADLE_USER_HOME',
  'ANT_HOME',
  'NODE_PATH',
  'NODE_OPTIONS',
  'NVM_HOME',
  'NVM_SYMLINK',
  'NPM_CONFIG_PREFIX',
  'PNPM_HOME',
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONIOENCODING',
  'CONDA_PREFIX',
  'GOPATH',
  'GOROOT',
  'GOBIN',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'DOTNET_ROOT',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT'
]

/** 凭据类变量：即使命中白名单也一律剔除，模型 API Key 永远留在 Host。 */
const ENV_DENY_PATTERNS: readonly RegExp[] = [
  /(_API_KEY|_APIKEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/i,
  /^(AWS|AZURE|GOOGLE|GCP|ALIYUN|TENCENT)_/i,
  /^(GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|PYPI_TOKEN|HF_TOKEN)$/i,
  /^(OPENAI|ANTHROPIC|GEMINI|DEEPSEEK|MOONSHOT|QWEN|GROQ|MISTRAL)_/i,
  /^SSH_AUTH_SOCK$/i,
  /^PI_/i
]

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function pickDomains(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const domains = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(domains)]
}

export interface NormalizedSandboxSettings {
  settings: SandboxSettings
  /** networkMode 被降级为可实现的档位；界面据此提示，不做静默改写 */
  downgraded: boolean
}

/** 合并默认值、裁剪非法枚举；restricted 在第一阶段没有实现，显式降级为 full。 */
export function normalizeSandboxSettings(input: unknown): NormalizedSandboxSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<SandboxSettings>
  const requestedNetwork = pickEnum(source.networkMode, SANDBOX_NETWORK_MODES, defaultSandboxSettings.networkMode)
  const downgraded = requestedNetwork === 'restricted'
  return {
    settings: {
      enabled: pickBoolean(source.enabled, defaultSandboxSettings.enabled),
      mode: pickEnum(source.mode, SANDBOX_MODES, defaultSandboxSettings.mode),
      networkMode: downgraded ? 'full' : requestedNetwork,
      allowedDomains: pickDomains(source.allowedDomains, defaultSandboxSettings.allowedDomains),
      allowUnsandboxedFallback: pickBoolean(source.allowUnsandboxedFallback, defaultSandboxSettings.allowUnsandboxedFallback)
    },
    downgraded
  }
}

/** 生成敏感目录的绝对路径列表；home 为空时只返回相对片段供上层匹配。 */
export function sensitivePaths(home: string): string[] {
  const root = home.replace(/[\\/]+$/, '')
  if (!root) return [...SENSITIVE_PATH_SEGMENTS]
  return SENSITIVE_PATH_SEGMENTS.map((segment) => `${root}/${segment}`.replace(/\//g, '\\'))
}

export interface ResolvePolicyInput {
  workspacePath: string | null
  /** 用户主目录，用于展开敏感目录列表 */
  home?: string
}

/** 设置 + 工作区 → 运行期策略。strict 在 standard 基础上关网并禁止降级。 */
export function resolveSandboxPolicy(settings: SandboxSettings, input: ResolvePolicyInput): SandboxPolicy {
  const normalized = normalizeSandboxSettings(settings).settings
  const strict = normalized.mode === 'strict'
  const home = input.home ?? ''
  const denyRead = strict && home ? [home] : sensitivePaths(home)
  return {
    enabled: normalized.enabled,
    mode: normalized.mode,
    filesystem: {
      workspacePath: input.workspacePath,
      workspaceRead: true,
      workspaceWrite: Boolean(input.workspacePath),
      denyRead,
      denyWrite: home ? [home] : [],
      allowRead: [],
      allowWrite: input.workspacePath ? [input.workspacePath] : []
    },
    network: {
      mode: strict ? 'off' : normalized.networkMode,
      allowedDomains: normalized.allowedDomains
    },
    process: {
      allowUnsandboxedFallback: strict ? false : normalized.allowUnsandboxedFallback,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxProcesses: DEFAULT_MAX_PROCESSES
    }
  }
}

/** 网络模式决定沙箱身份：off 用离线账户，其余用在线账户。 */
export function accountModeFor(policy: SandboxPolicy): 'offline' | 'online' {
  return policy.network.mode === 'off' ? 'offline' : 'online'
}

/** 名字必须 ≤20 字符：Windows 本地账户名上限，超出时创建账户会失败。 */
export function sandboxAccountName(mode: 'offline' | 'online'): string {
  return mode === 'offline' ? 'FastAgentSandboxOff' : 'FastAgentSandboxOn'
}

export type EnvironmentSource = Record<string, string | undefined>

/**
 * 环境变量清洗：白名单先筛，再用凭据模式二次剔除。
 * 沙箱开与关都要调用，避免 API Key 通过子进程外传。
 */
export function sanitizeEnvironment(source: EnvironmentSource, extra: EnvironmentSource = {}): Record<string, string> {
  const allowed = new Set(ENV_ALLOW_LIST.map((name) => name.toUpperCase()))
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (!allowed.has(key.toUpperCase())) continue
    if (ENV_DENY_PATTERNS.some((pattern) => pattern.test(key))) continue
    result[key] = value
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue
    if (ENV_DENY_PATTERNS.some((pattern) => pattern.test(key))) continue
    result[key] = value
  }
  return result
}

export function networkModeLabel(mode: SandboxNetworkMode): string {
  return mode === 'off' ? '禁止' : mode === 'restricted' ? '受限' : '完全允许'
}

export function sandboxStatusLabel(status: SandboxStatus): string {
  switch (status) {
    case 'ready': return '正常'
    case 'not_initialized': return '未初始化'
    case 'unsupported': return '当前系统不支持'
    case 'broken': return '异常'
    case 'outdated': return '组件需要更新'
  }
}
