import { execFile } from 'node:child_process'
import type { DoctorCheck, DoctorReport, DoctorStatus } from '../shared/types'

/** 单个探测的超时。工具缺失时 execFile 会立刻 ENOENT，这个超时防的是装了但挂住的情况。 */
const PROBE_TIMEOUT_MS = 4_000

export interface ProbeResult {
  ok: boolean
  stdout: string
  /** 可执行文件不在 PATH 里 —— 与「跑起来但失败」是两回事。 */
  missing: boolean
  error: string
}

/**
 * 版本号从输出里抽第一行。
 * 各工具格式差异很大（`git version 2.43.0`、`Python 3.12.1`、`v20.11.0`、多行的 openjdk），
 * 统一只取第一行并压掉空白：这里的目的是让用户认出装的是哪个版本，不是解析语义化版本。
 */
export function parseToolVersion(stdout: string): string | null {
  const first = stdout.split('\n').map((line) => line.trim()).find(Boolean)
  if (!first) return null
  return first.length > 80 ? `${first.slice(0, 80)}…` : first
}

/** 严重度排序，用于汇总出整体结论。 */
const SEVERITY: DoctorStatus[] = ['ok', 'warn', 'missing', 'error']

/** 汇总计数与整体结论。整体取最严重的一档，不做加权：一个探不动的沙箱不该被一堆 ok 稀释掉。 */
export function summarizeDoctor(checks: readonly DoctorCheck[]): Pick<DoctorReport, 'summary' | 'overall'> {
  const summary: Record<DoctorStatus, number> = { ok: 0, warn: 0, missing: 0, error: 0 }
  for (const check of checks) summary[check.status] += 1
  const overall = SEVERITY.reduce<DoctorStatus>((worst, status) => (summary[status] > 0 ? status : worst), 'ok')
  return { summary, overall }
}

/** 探测结果 → 单项结论。必需工具缺失记 missing，可选工具缺失只记 warn。 */
export function classifyToolProbe(input: { result: ProbeResult; required: boolean }): Pick<DoctorCheck, 'status' | 'detail' | 'version'> {
  const { result, required } = input
  if (result.missing) {
    return {
      status: required ? 'missing' : 'warn',
      detail: required ? '未安装或不在 PATH 中' : '未安装（可选）',
      version: null
    }
  }
  if (!result.ok) return { status: 'error', detail: result.error || '探测失败', version: null }
  return { status: 'ok', detail: parseToolVersion(result.stdout) ?? '已安装', version: parseToolVersion(result.stdout) }
}

/**
 * 跑一次版本探测。任何异常都收敛成结构化结果，绝不抛出：
 * Doctor 的价值就在于「明确报缺」，探测器自己抛错会让整份报告失败。
 */
export function probeExecutable(executable: string, args: string[] = ['--version'], timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(executable, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) { resolve({ ok: true, stdout: String(stdout ?? ''), missing: false, error: '' }); return }
      const errno = (error as NodeJS.ErrnoException | null)?.code
      if (errno === 'ENOENT') { resolve({ ok: false, stdout: '', missing: true, error: '' }); return }
      const timedOut = errno === 'ETIMEDOUT'
      // 有些工具把版本写到 stderr 且以非零码退出，仍算探到了
      const output = String(stdout ?? '') || String(stderr ?? '')
      if (!timedOut && output.trim()) { resolve({ ok: true, stdout: output, missing: false, error: '' }); return }
      resolve({ ok: false, stdout: '', missing: false, error: timedOut ? `探测超时（${timeoutMs}ms）` : String(stderr || error.message) })
    })
  })
}

export interface ToolSpec {
  id: string
  label: string
  executable: string
  args?: string[]
  /** 必需工具缺失会把整体结论拉到 missing；可选工具只提示。 */
  required: boolean
  hint: string
}

/**
 * 探测清单。只做发现与报缺，不内置任何运行时——
 * 把 python/node/pnpm 打进安装包在体积、许可与更新三方面都不划算。
 */
export const TOOL_SPECS: ToolSpec[] = [
  { id: 'git', label: 'Git', executable: 'git', required: true, hint: '随 FastAgent 内置（MinGit）；都取不到时 Agent 读不到分支与改动状态' },
  { id: 'node', label: 'Node.js', executable: 'node', required: false, hint: '前端项目的构建与测试命令需要它' },
  { id: 'npm', label: 'npm', executable: 'npm', required: false, hint: '随 Node.js 一同安装' },
  { id: 'python', label: 'Python', executable: 'python', args: ['--version'], required: false, hint: 'Python 项目的验证命令需要它' },
  { id: 'jq', label: 'jq', executable: 'jq', required: false, hint: '随 FastAgent 内置；缺失时 JSON 处理只能靠脚本' },
  { id: '7zz', label: '7-Zip', executable: '7zz', args: [], required: false, hint: '随 FastAgent 内置；缺失时压缩解压只能靠系统 tar' },
  // rg / fd 随包提供；两处都拿不到时 pi 会尝试联网下载，离线环境下 grep / find 工具会直接失败
  { id: 'rg', label: 'ripgrep', executable: 'rg', required: false, hint: '随 FastAgent 内置；都取不到时 grep 工具需要联网下载才能用' },
  { id: 'fd', label: 'fd', executable: 'fd', required: false, hint: '随 FastAgent 内置；都取不到时 find 工具需要联网下载才能用' },
  { id: 'curl', label: 'curl', executable: 'curl', required: false, hint: '部分网络类命令依赖它' }
]

/**
 * 探测工具链。`bundled` 是随包工具名 → 绝对路径：内置二进制不在 PATH 上，
 * 按名字探测会报「未安装」，而 Agent 其实用得上它们。
 */
export async function probeTools(specs: readonly ToolSpec[] = TOOL_SPECS, bundled: Readonly<Record<string, string>> = {}): Promise<DoctorCheck[]> {
  // 并行探测：逐个串行的话六个工具在慢盘上要等好几秒
  const results = await Promise.all(specs.map(async (spec) => ({
    spec,
    bundledPath: bundled[spec.id],
    result: await probeExecutable(bundled[spec.id] ?? spec.executable, spec.args ?? ['--version'])
  })))
  return results.map(({ spec, bundledPath, result }) => {
    const classified = classifyToolProbe({ result, required: spec.required })
    return {
      id: spec.id,
      label: spec.label,
      category: 'toolchain' as const,
      ...classified,
      ...(bundledPath && classified.status === 'ok' ? { detail: `${classified.detail}（内置）` } : {}),
      ...(classified.status === 'ok' ? {} : { hint: spec.hint })
    }
  })
}

/** 把若干组检查拼成一份报告。分组由调用方提供，便于主进程注入沙箱/工作区等有状态的检查。 */
export function buildDoctorReport(checks: DoctorCheck[], checkedAt = Date.now()): DoctorReport {
  return { checkedAt, checks, ...summarizeDoctor(checks) }
}
