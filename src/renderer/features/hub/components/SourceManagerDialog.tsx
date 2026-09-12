import { useState } from 'react'
import { LoaderCircle, Plus, Trash2 } from 'lucide-react'
import type { HubSource, HubSourceKind } from '../../../../shared/types'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { AbilityStatusBadge } from '../../abilities/components/AbilityStatusBadge'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { draftFromSource, emptySourceDraft, isSourceSupported, normalizeSourceId, SOURCE_KIND_LABELS, SOURCE_URL_PLACEHOLDERS, sourceStatusPresentation, validateSourceDraft, type SourceDraft } from '../hub-view'
import { hubService } from '../services/hub-service'

const KIND_OPTIONS: HubSourceKind[] = ['git', 'skillsmp', 'mcp-registry']

/** 分支/Tag 只对 Git 归档有意义，聚合站没有这个概念。 */
const SUPPORTS_REF: HubSourceKind[] = ['git']

/** 源管理：增删、启停、连通性测试。内置目录只能停用不能删。 */
export function SourceManagerDialog({ sources, onClose, onChanged }: {
  sources: HubSource[]
  onClose: () => void
  onChanged: () => void
}) {
  const [draft, setDraft] = useState<SourceDraft | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const actions = useAsyncActions()

  const editingExisting = Boolean(draft && sources.some((source) => source.id === draft.id))

  function startCreate() {
    setValidation(null)
    setDraft(emptySourceDraft())
  }

  function startEdit(source: HubSource) {
    setValidation(null)
    setDraft(draftFromSource(source))
  }

  async function save() {
    if (!draft) return
    const id = normalizeSourceId(draft.id || draft.name)
    // 改已有源时不该把自己算成冲突。
    const conflicts = sources.map((source) => source.id).filter((existing) => existing !== draft.id)
    const problem = validateSourceDraft(draft, conflicts)
    if (problem) {
      setValidation(problem)
      return
    }
    const saved = await actions.run('save', () => hubService.saveSource({
      id,
      kind: draft.kind,
      name: draft.name.trim(),
      url: draft.url.trim() || undefined,
      ref: draft.ref.trim() || undefined,
      enabled: true,
      apiKey: draft.apiKey.trim() || undefined
    }))
    if (!saved) return
    setDraft(null)
    onChanged()
  }

  async function toggle(source: HubSource) {
    await actions.run(`toggle-${source.id}`, () => hubService.saveSource({
      id: source.id, kind: source.kind, name: source.name, url: source.url, ref: source.ref,
      enabled: !source.enabled, sortOrder: source.sortOrder
    }))
    onChanged()
  }

  async function test(source: HubSource) {
    await actions.run(`test-${source.id}`, () => hubService.testSource(source.id))
    onChanged()
  }

  async function remove(source: HubSource) {
    await actions.run(`remove-${source.id}`, () => hubService.removeSource(source.id))
    onChanged()
  }

  return <CapabilityDrawer
    title="管理来源"
    subtitle="Hub 按源顺序搜索；同名条目以靠前的源为准"
    onClose={onClose}
    footer={draft
      ? <>
          <button className="primary-button" onClick={() => void save()} disabled={actions.isPending('save')}>
            {actions.isPending('save') && <LoaderCircle size={14} className="spin" />}保存
          </button>
          <button className="quick-secondary" onClick={() => setDraft(null)}>取消</button>
        </>
      : <>
          <button className="primary-button" onClick={startCreate}><Plus size={14} />添加源</button>
          <button className="quick-secondary" onClick={onClose}>关闭</button>
        </>}
  >
    <div className="ability-detail-body">
      {draft ? <div className="ability-detail-section">
        <label className="settings-inline-field"><span>源类型</span>
          <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as HubSourceKind })} disabled={editingExisting}>
            {KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{SOURCE_KIND_LABELS[kind]}{isSourceSupported(kind) ? '' : '（尚未支持）'}</option>)}
          </select>
        </label>
        <label className="settings-inline-field"><span>名称</span>
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="团队技能库" />
        </label>
        <label className="settings-inline-field"><span>标识</span>
          <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="留空则按名称生成" disabled={editingExisting} />
        </label>
        <label className="settings-inline-field"><span>{draft.kind === 'git' ? '仓库地址' : '服务地址'}</span>
          <input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder={SOURCE_URL_PLACEHOLDERS[draft.kind]} />
        </label>
        {SUPPORTS_REF.includes(draft.kind) && <label className="settings-inline-field"><span>分支或 Tag</span>
          <input value={draft.ref} onChange={(event) => setDraft({ ...draft, ref: event.target.value })} placeholder="留空用默认分支" />
        </label>}
        {draft.kind !== 'git' && <label className="settings-inline-field"><span>API Key</span>
          <input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="留空则沿用已保存的值" />
        </label>}
        {!isSourceSupported(draft.kind) && <p className="settings-hint">该源类型尚未落地，保存后搜索会明确报错而不是静默跳过。</p>}
        {validation && <AbilityErrorBlock title="无法保存" message={validation} />}
        {actions.errorOf('save') && <AbilityErrorBlock title="保存失败" message={actions.errorOf('save') as string} />}
      </div> : <ul className="hub-source-list">
        {sources.map((source) => <li key={source.id} className={source.enabled ? '' : 'disabled'}>
          <div className="hub-source-main">
            <div className="hub-source-title">
              <strong>{source.name}</strong>
              <AbilityStatusBadge status={sourceStatusPresentation(source.status)} />
            </div>
            <small className="mono">{source.url ?? SOURCE_KIND_LABELS[source.kind]}{source.ref ? ` @ ${source.ref}` : ''}</small>
            {source.statusMessage && <small className="hub-source-error">{source.statusMessage}</small>}
          </div>
          <div className="hub-source-actions">
            <button className="small-control" onClick={() => void test(source)} disabled={actions.isPending(`test-${source.id}`)}>
              {actions.isPending(`test-${source.id}`) ? '测试中…' : '测试'}
            </button>
            <button className="small-control" onClick={() => void toggle(source)}>{source.enabled ? '停用' : '启用'}</button>
            {!source.builtin && <>
              <button className="small-control" onClick={() => startEdit(source)}>编辑</button>
              <button className="small-control danger" onClick={() => void remove(source)} aria-label={`删除 ${source.name}`}><Trash2 size={13} /></button>
            </>}
          </div>
        </li>)}
      </ul>}
    </div>
  </CapabilityDrawer>
}
