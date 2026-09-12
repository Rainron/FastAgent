/** 内置工具链（Runtime）：随包分发、装在数据根下、版本固定，用于摆脱对用户本机环境的依赖。 */

/** 工具当前从哪来。bundled = FastAgent 随包安装；system = 只在系统 PATH 上找到；missing = 两处都没有。 */
export type RuntimeToolSource = 'bundled' | 'system' | 'missing'

/**
 * ready 可用；mismatch 文件在但内容与清单对不上（被替换或损坏）；missing 文件不在。
 * mismatch 与 missing 分开：前者要提示用户修复，后者可能只是这台机器还没装过。
 */
export type RuntimeToolStatus = 'ready' | 'mismatch' | 'missing'

export interface RuntimeToolInfo {
  id: string
  /** 清单里记录的版本；取不到时为 null */
  version: string | null
  source: RuntimeToolSource
  status: RuntimeToolStatus
  /** 内置工具的绝对路径；非内置为 null */
  path: string | null
  /** 校验时的补充说明，如「文件缺失」「内容与清单不一致」 */
  detail?: string
}

export interface RuntimeReport {
  /** 随包 runtime 的整体版本号，取自 manifest.json */
  runtimeVersion: string | null
  /** 安装位置，始终在数据根（.fa）之下 */
  installDir: string
  checkedAt: number
  /** 是否做过 sha256 完整性校验；只列清单时为 false */
  verified: boolean
  /** 第三方组件声明文件的绝对路径；未安装内置工具链时为 null */
  noticesFile: string | null
  tools: RuntimeToolInfo[]
}
