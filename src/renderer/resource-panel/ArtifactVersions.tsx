import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, History, LoaderCircle, RotateCcw } from 'lucide-react'
import type { Artifact, FileVersionRecord } from '../../shared/types'
import { artifactOriginLabel, restoreAvailability, versionOperationLabel, versionStatsLabel } from './artifact-versions'

/**
 * 成果版本视图：一条记录 = 一个回合改过这个文件一次。
 * 恢复是真实写盘，先展开 diff 让用户看清要退回什么，再二次确认。
 */
export function ArtifactVersions({ artifact, onClose, onNotice }: { artifact: Artifact; onClose: () => void; onNotice: (notice: string) => void }) {
  const [versions, setVersions] = useState<FileVersionRecord[] | null>(null)
  const [openTurnId, setOpenTurnId] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [confirmingTurnId, setConfirmingTurnId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    window.fastAgent.artifacts.versions(artifact.id)
      .then(setVersions)
      .catch(() => { setVersions([]); onNotice('版本历史加载失败') })
  }, [artifact.id, onNotice])

  useEffect(() => { load() }, [load])

  async function toggleDiff(version: FileVersionRecord) {
    if (openTurnId === version.turnId) { setOpenTurnId(null); setDiff(null); return }
    setOpenTurnId(version.turnId)
    setDiff(null)
    if (!version.hasDiff) return
    try { setDiff(await window.fastAgent.artifacts.versionDiff(artifact.id, version.turnId)) }
    catch { onNotice('差异加载失败') }
  }

  async function restore(version: FileVersionRecord) {
    setBusy(true)
    try {
      const result = await window.fastAgent.artifacts.restore(artifact.id, version.turnId)
      onNotice(result.ok ? '已恢复到这次改动之前的内容' : result.error || '恢复失败')
      if (result.ok) load()
    } finally {
      setBusy(false)
      setConfirmingTurnId(null)
    }
  }

  return <div className="artifact-versions">
    <div className="artifact-versions-head">
      <button className="text-button" onClick={onClose} aria-label="返回产物列表"><ArrowLeft size={14} /></button>
      <History size={14} />
      <strong title={artifact.path}>{artifact.name}</strong>
    </div>
    <p className="settings-hint">{artifactOriginLabel(artifact)}</p>
    {!versions && <div className="resource-empty"><LoaderCircle size={18} className="spin" /><span>正在加载版本…</span></div>}
    {versions && versions.length === 0 && <div className="resource-empty"><History size={20} /><strong>没有改动记录</strong><span>这个文件还没有被 Agent 改过，或改动发生在记录改动历史之前。</span></div>}
    {versions?.map((version) => {
      const availability = restoreAvailability(version)
      const stats = versionStatsLabel(version)
      return <div className="artifact-version" key={version.turnId}>
        <button className="artifact-version-row" onClick={() => void toggleDiff(version)} aria-expanded={openTurnId === version.turnId}>
          <span className="artifact-version-op">{versionOperationLabel(version)}</span>
          <span className="artifact-version-time">{new Date(version.changedAt).toLocaleString('zh-CN')}</span>
          {stats && <span className="artifact-version-stats">{stats}</span>}
        </button>
        {confirmingTurnId === version.turnId
          ? <div className="artifact-version-confirm">
            <span>把文件退回这次改动之前？当前内容会被覆盖（覆盖前的内容仍会记进历史）。</span>
            <button className="small-control" onClick={() => setConfirmingTurnId(null)}>取消</button>
            <button className="small-control danger" disabled={busy} onClick={() => void restore(version)}>{busy ? '恢复中' : '确认恢复'}</button>
          </div>
          : <button
            className="artifact-version-restore"
            disabled={!availability.enabled || busy}
            title={availability.reason}
            onClick={() => setConfirmingTurnId(version.turnId)}
          ><RotateCcw size={12} />恢复到此前</button>}
        {openTurnId === version.turnId && <pre className="artifact-version-diff">{diff ?? (version.hasDiff ? '加载中…' : '这次改动没有可显示的逐行差异（二进制或超大文件）')}</pre>}
      </div>
    })}
  </div>
}
