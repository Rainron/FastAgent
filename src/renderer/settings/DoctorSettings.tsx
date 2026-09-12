import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CircleAlert, CircleCheck, CircleHelp, LoaderCircle, RefreshCw } from 'lucide-react'
import type { DoctorCategory, DoctorCheck, DoctorReport, DoctorStatus } from '../../shared/types'
import { CATEGORY_LABEL, groupChecks, overallLabel, STATUS_LABEL } from './doctor-view'

const STATUS_ICON: Record<DoctorStatus, typeof CircleCheck> = {
  ok: CircleCheck,
  warn: AlertTriangle,
  missing: CircleHelp,
  error: CircleAlert
}

function CheckRow({ check }: { check: DoctorCheck }) {
  const Icon = STATUS_ICON[check.status]
  return <div className={`doctor-row ${check.status}`}>
    <Icon size={14} className="doctor-row-icon" />
    <span className="doctor-row-label">{check.label}</span>
    <span className="doctor-row-detail" title={check.detail}>{check.detail}</span>
    {check.hint && <span className="doctor-row-hint">{check.hint}</span>}
  </div>
}

/**
 * 环境体检：只探测与报缺，不做任何安装。
 * 把 python/node/pnpm 打进安装包在体积、许可与更新三方面都不划算，
 * 因此这里的产出是「缺什么、去哪补」，而不是一键修复。
 */
export function DoctorSettings({ onNotice }: { onNotice: (notice: string) => void }) {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [running, setRunning] = useState(false)

  const run = useCallback(() => {
    setRunning(true)
    window.fastAgent.doctor.run()
      .then(setReport)
      .catch(() => onNotice('环境体检失败'))
      .finally(() => setRunning(false))
  }, [onNotice])

  // 进页面自动跑一次：体检是只读探测，没有需要用户先确认的副作用
  useEffect(() => { run() }, [run])

  const groups = useMemo(() => (report ? groupChecks(report.checks) : []), [report])

  return <section className="settings-panel" aria-labelledby="settings-doctor">
    <div className="settings-section-heading">
      <div>
        <h2 id="settings-doctor">环境体检</h2>
        <p>检查 Agent 依赖的外部工具与运行环境。只探测，不安装、不修改任何配置。</p>
      </div>
      <button className="secondary" onClick={run} disabled={running}>
        {running ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
        {running ? '检查中…' : '重新检查'}
      </button>
    </div>

    {report && <div className={`doctor-overall ${report.overall}`}>{overallLabel(report)}</div>}

    {!report && running && <p>正在检查…</p>}

    {groups.map(([category, checks]) => <div className="doctor-group" key={category}>
      <h4>{CATEGORY_LABEL[category as DoctorCategory]}</h4>
      {checks.map((check) => <CheckRow check={check} key={check.id} />)}
    </div>)}

    {report && report.overall !== 'ok' && <p className="doctor-foot">
      标记为「{STATUS_LABEL.missing}」的项不影响应用启动，但相关的 Agent 命令会失败。
    </p>}
  </section>
}
