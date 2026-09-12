import { useEffect, useState } from 'react'
import { FolderOpen, HardDrive, Move } from 'lucide-react'
import type { DataStorageInfo } from '../../shared/types'

export function DataStorageSettings({ onNotice }: { onNotice: (notice: string) => void }) {
  const [info, setInfo] = useState<DataStorageInfo | null>(null)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    void window.fastAgent.storage.info().then(setInfo).catch(() => onNotice('数据目录信息加载失败'))
  }, [onNotice])

  async function moveDirectory() {
    setMoving(true)
    try {
      const result = await window.fastAgent.storage.moveDataDirectory()
      if (!result.moved && !result.cancelled) onNotice('数据目录没有变化')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '数据目录迁移失败')
    } finally {
      setMoving(false)
    }
  }

  return <section className="settings-panel" aria-labelledby="settings-storage">
    <div className="settings-section-heading">
      <div><h2 id="settings-storage">数据与存储</h2><p>持久数据可迁移和备份；缓存与日志继续使用系统标准目录。</p></div>
    </div>
    {!info ? <div className="section-list-empty">数据目录信息加载中</div> : <>
      <div className="settings-row settings-row-stack">
        <div><strong>持久数据目录</strong><span className="storage-path">{info.dataRoot}</span><small>{info.isDefault ? '当前使用默认目录' : `默认目录：${info.defaultRoot}`}</small></div>
        <div className="model-settings-actions">
          <button className="small-control" onClick={() => void window.fastAgent.storage.openDataDirectory().then((message) => { if (message) onNotice(message) })}><FolderOpen size={13} />打开目录</button>
          <button className="small-control" disabled={moving} onClick={() => void moveDirectory()}><Move size={13} />{moving ? '正在迁移' : '移动目录'}</button>
        </div>
      </div>
      <div className="settings-row">
        <div><strong>本地数据库</strong><span className="storage-path">{info.databasePath}</span></div>
        <HardDrive size={16} className="settings-muted-icon" />
      </div>
      <div className="settings-row settings-row-stack">
        <div><strong>平台缓存与日志</strong><span className="storage-path">缓存：{info.cacheDir}</span><span className="storage-path">日志：{info.logsDir}</span><small>崩溃报告与错误日志都在日志目录下</small></div>
        <div className="model-settings-actions">
          <button className="small-control" onClick={() => void window.fastAgent.shell.openPath(info.logsDir).then((message) => { if (message) onNotice(message) })}><FolderOpen size={13} />打开日志目录</button>
        </div>
      </div>
      <p className="settings-hint">迁移会先复制并校验数据库，成功后重启应用；原目录不会自动删除。</p>
    </>}
  </section>
}
