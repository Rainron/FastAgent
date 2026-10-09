import { useMemo, useState } from 'react'
import { ListPlus } from 'lucide-react'
import type { DiscoveredConnectionModel } from '../../shared/types'
import { CenterDialog } from '../components/CenterDialog'
import { ModelPickList } from './ModelPickList'

/** 「获取模型」的结果单独开一个居中弹层：厂商动辄上百个模型，塞在表单里挑不动。 */
export function DiscoveredModelsDialog({ discovered, existing, onClose, onAdd }: {
  discovered: DiscoveredConnectionModel[]
  /** 已在连接里的模型 id，列表里禁用并标「已添加」。 */
  existing: string[]
  onClose: () => void
  onAdd: (models: DiscoveredConnectionModel[]) => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return keyword ? discovered.filter((item) => item.modelId.toLowerCase().includes(keyword) || item.name?.toLowerCase().includes(keyword)) : discovered
  }, [discovered, query])
  const addable = visible.filter((item) => !existing.includes(item.modelId))

  return <CenterDialog
    title="选择要添加的模型"
    subtitle={`获取到 ${discovered.length} 个模型 · 已选 ${picked.size}`}
    icon={<ListPlus size={16} />}
    busy={false}
    onClose={onClose}
    footer={<>
      <button type="button" className="approval-secondary" onClick={onClose}>取消</button>
      <button type="button" className="approval-primary" disabled={!picked.size} onClick={() => { onAdd(discovered.filter((item) => picked.has(item.modelId))); onClose() }}>添加所选（{picked.size}）</button>
    </>}
  >
    <div className="model-discovered-head">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索 ${discovered.length} 个可用模型`} aria-label="搜索可用模型" spellCheck={false} />
      <button type="button" className="small-control" disabled={!addable.length || addable.every((item) => picked.has(item.modelId))} onClick={() => setPicked(new Set([...picked, ...addable.map((item) => item.modelId)]))}>全选</button>
      <button type="button" className="small-control" disabled={!picked.size} onClick={() => setPicked(new Set())}>清空</button>
    </div>
    <ModelPickList
      items={visible.map((item) => ({ id: item.modelId, label: item.name ?? item.modelId, disabled: existing.includes(item.modelId), note: existing.includes(item.modelId) ? '已添加' : undefined }))}
      selected={picked}
      onChange={setPicked}
    />
    <p className="settings-hint">添加后记得在表单底部保存模型服务，否则不会落库。</p>
  </CenterDialog>
}
