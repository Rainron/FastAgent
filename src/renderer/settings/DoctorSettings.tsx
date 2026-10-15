import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CircleAlert, CircleCheck, CircleHelp, Download, LoaderCircle, RefreshCw } from 'lucide-react'
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
    <div className="doctor-row-copy">
      <span className="doctor-row-label">{check.label}</span>
      <span className="doctor-row-detail" title={check.detail}>{check.detail}</span>
      {/* hint 是「去哪补」，缺项时它才是用户唯一要读的那句，不能被省略号吃掉 */}
      {check.hint && <span className="doctor-row-hint">{check.hint}</span>}
    </div>
    <span className="doctor-row-status">{STATUS_LABEL[check.status]}</span>
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
  const [exporting, setExporting] = useState(false)

  async function exportReport() {
    setExporting(true)
    try {
      const path = await window.fastAgent.doctor.export()
      onNotice(path ? `诊断信息已导出到 ${path}` : '已取消导出')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '导出失败')
    } finally { setExporting(false) }
  }

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
      <div className="model-settings-actions">
        <button className="small-control" onClick={() => void exportReport()} disabled={exporting}>
          <Download size={13} />{exporting ? '导出中…' : '导出诊断信息'}
        </button>
        <button className="small-control" onClick={run} disabled={running}>
          {running ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}
          {running ? '检查中…' : '重新检查'}
        </button>
      </div>
    </div>

    {report && <div className={`doctor-overall ${report.overall}`}>
      <span className="doctor-overall-dot" />
      <strong>{overallLabel(report)}</strong>
      <small>共 {report.checks.length} 项 · {new Date(report.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 检查</small>
    </div>}

    {!report && running && <div className="doctor-loading"><LoaderCircle size={14} className="spin" />正在检查…</div>}

    {groups.map(([category, checks]) => <div className="doctor-group" key={category}>
      <h4>{CATEGORY_LABEL[category as DoctorCategory]}</h4>
      <div className="doctor-list">{checks.map((check) => <CheckRow check={check} key={check.id} />)}</div>
    </div>)}

    <p className="settings-hint">导出内容只含版本、体检结论与运行上限；后端地址、本机路径与凭据不会写进文件。</p>

    {report && report.overall !== 'ok' && <p className="doctor-foot">
      标记为「{STATUS_LABEL.missing}」的项不影响应用启动，但相关的 Agent 命令会失败。
    </p>}
  </section>
}
