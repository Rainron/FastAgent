import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, CircleHelp, FileText, LoaderCircle, RefreshCw, ShieldCheck, Wrench } from 'lucide-react'
import type { RuntimeReport, RuntimeToolInfo, RuntimeToolStatus } from '../../shared/types'
import { RUNTIME_SOURCE_LABEL, RUNTIME_STATUS_LABEL, runtimeNeedsRepair, runtimeOverallLabel, runtimeToolDetail, runtimeToolLabel } from './runtime-view'

const STATUS_ICON: Record<RuntimeToolStatus, typeof CircleCheck> = {
  ready: CircleCheck,
  mismatch: CircleAlert,
  missing: CircleHelp
}

/** 状态样式沿用 doctor 那套：ready 对应 ok，mismatch 对应 error，missing 保持 missing。 */
const STATUS_TONE: Record<RuntimeToolStatus, string> = {
  ready: 'ok',
  mismatch: 'error',
  missing: 'missing'
}

function ToolRow({ tool }: { tool: RuntimeToolInfo }) {
  const Icon = STATUS_ICON[tool.status]
  return <div className={`doctor-row ${STATUS_TONE[tool.status]}`}>
    <Icon size={14} className="doctor-row-icon" />
    <span className="doctor-row-label">{runtimeToolLabel(tool.id)}</span>
    <span className="doctor-row-detail" title={tool.path ?? undefined}>{runtimeToolDetail(tool)}</span>
    <span className="doctor-row-hint">{RUNTIME_SOURCE_LABEL[tool.source]} · {RUNTIME_STATUS_LABEL[tool.status]}</span>
  </div>
}

/**
 * 内置工具链现状。随包安装到数据根（.fa）下，版本固定，运行期不依赖安装目录。
 * 完整性校验要把上百 MB 的二进制全读一遍，因此进页面只列清单，校验由用户主动触发。
 */
export function RuntimeSettings({ onNotice }: { onNotice: (notice: string) => void }) {
  const [report, setReport] = useState<RuntimeReport | null>(null)
  const [busy, setBusy] = useState<'none' | 'detect' | 'verify' | 'repair'>('none')

  const load = useCallback((verify: boolean, kind: 'detect' | 'verify') => {
    setBusy(kind)
    window.fastAgent.runtime.status(verify)
      .then(setReport)
      .catch(() => onNotice('读取内置工具链状态失败'))
      .finally(() => setBusy('none'))
  }, [onNotice])

  const repair = useCallback(() => {
    setBusy('repair')
    window.fastAgent.runtime.repair()
      .then((next) => { setReport(next); onNotice('内置工具链已重装') })
      .catch(() => onNotice('内置工具链修复失败'))
      .finally(() => setBusy('none'))
  }, [onNotice])

  // 进页面自动列一次清单：只读文件是否存在，没有需要先确认的副作用
  useEffect(() => { load(false, 'detect') }, [load])

  const running = busy !== 'none'

  return <section className="settings-panel" aria-labelledby="settings-runtime">
    <div className="settings-section-heading">
      <div>
        <h2 id="settings-runtime">开发环境</h2>
        <p>FastAgent 随包提供的工具链，版本固定，安装在数据目录下。Agent 优先使用这里的工具，取不到时才回退到系统 PATH；系统 PATH 本身不会被修改。</p>
      </div>
      <button className="secondary" onClick={() => load(false, 'detect')} disabled={running}>
        {busy === 'detect' ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
        {busy === 'detect' ? '检测中…' : '重新检测'}
      </button>
    </div>

    {report && <div className={`doctor-overall ${runtimeNeedsRepair(report) ? 'error' : 'ok'}`}>{runtimeOverallLabel(report)}</div>}

    {!report && running && <p>正在检测…</p>}

    {report && report.tools.length > 0 && <div className="doctor-group">
      {report.tools.map((tool) => <ToolRow tool={tool} key={tool.id} />)}
    </div>}

    {report && <div className="settings-row">
      <div>
        <strong>Runtime {report.runtimeVersion ?? '未安装'}</strong>
        <span>{report.installDir}</span>
      </div>
      <div className="model-settings-actions">
        {report.noticesFile && <button className="small-control" onClick={() => void window.fastAgent.shell.openPath(report.noticesFile as string)}>
          <FileText size={13} />第三方声明
        </button>}
        <button className="small-control" onClick={() => load(true, 'verify')} disabled={running || !report.tools.length}>
          {busy === 'verify' ? <LoaderCircle size={13} className="spin" /> : <ShieldCheck size={13} />}
          {busy === 'verify' ? '校验中…' : '完整性校验'}
        </button>
        <button className={runtimeNeedsRepair(report) ? 'quick-primary' : 'small-control'} onClick={repair} disabled={running}>
          {busy === 'repair' ? <LoaderCircle size={13} className="spin" /> : <Wrench size={13} />}
          {busy === 'repair' ? '修复中…' : '修复'}
        </button>
      </div>
    </div>}

    {report && !report.tools.length && <p className="doctor-foot">
      这份安装包里没有随包工具链，或首次安装尚未完成。点「修复」会从安装目录重新复制一份。
    </p>}
  </section>
}
