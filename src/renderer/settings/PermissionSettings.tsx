import { useEffect, useState } from 'react'
import { FolderOpen, Plus, RotateCcw, Shield, ShieldAlert, ShieldCheck, TerminalSquare, Trash2, X } from 'lucide-react'
import type { AppSettings, StoredPermissionRule } from '../../shared/types'
import type { LogicalToolKey, PermissionAction, PermissionRuleSet } from '../../shared/permission-rules'
import {
  BUILTIN_PRESET_IDS,
  BUILTIN_PROFILE_META,
  effectiveRuleSet,
  removeProfileRule,
  resetProfileToolKey,
  slugifyProfileId,
  upsertProfileRule,
  validateProfileDraft,
  type BuiltinPermissionPreset,
  type PermissionProfile
} from '../../shared/permission-profiles'
import { SubAgentSettings } from './SubAgentSettings'

const TOOL_KEY_LABELS: Record<LogicalToolKey, string> = {
  read: 'read（读取文件）',
  search: 'search（grep / find / ls）',
  edit: 'edit（edit / write / patch）',
  shell: 'shell（bash / powershell）',
  question: 'question（提问）',
  todowrite: 'todowrite（待办）',
  mcp_read: 'mcp_read（MCP 只读工具）',
  mcp_write: 'mcp_write（MCP 写入工具）',
  external_directory: 'external_directory（工作区外）',
  secret_file: 'secret_file（密钥文件）'
}

const ACTION_LABELS: Record<PermissionAction, string> = { allow: '允许', ask: '询问', deny: '拒绝' }
const ACTIONS: PermissionAction[] = ['allow', 'ask', 'deny']
const TOOL_KEYS = Object.keys(TOOL_KEY_LABELS) as LogicalToolKey[]

function presetIcon(base: BuiltinPermissionPreset) {
  return base === 'full' ? <ShieldAlert size={13} /> : base === 'workspace' ? <ShieldCheck size={13} /> : <Shield size={13} />
}

function ActionSelect({ value, onChange, label }: { value: PermissionAction; onChange: (action: PermissionAction) => void; label: string }) {
  return <select className={`permission-action-select action-${value}`} value={value} onChange={(event) => onChange(event.target.value as PermissionAction)} aria-label={label}>
    {ACTIONS.map((action) => <option key={action} value={action}>{ACTION_LABELS[action]}</option>)}
  </select>
}

/** 模式输入框失焦或回车才提交，打字过程中不落库。 */
function PatternInput({ value, onCommit, label }: { value: string; onCommit: (pattern: string) => void; label: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return <input
    className="permission-pattern-input"
    value={draft}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { const next = draft.trim(); if (next && next !== value) onCommit(next); else setDraft(value) }}
    onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
    aria-label={label}
    spellCheck={false}
  />
}

function ProfileRules({ profile, onOverridesChange }: { profile: PermissionProfile; onOverridesChange: (overrides: PermissionRuleSet) => void }) {
  const [adding, setAdding] = useState<string | null>(null)
  const [draftPattern, setDraftPattern] = useState('')
  const effective = effectiveRuleSet(profile)
  const toolKeys = [...new Set([...TOOL_KEYS.filter((key) => effective[key]), ...Object.keys(effective)])]

  function commitNewRule(toolKey: string) {
    const pattern = draftPattern.trim()
    if (pattern) onOverridesChange(upsertProfileRule(profile, toolKey, { pattern, action: 'ask' }))
    setAdding(null)
    setDraftPattern('')
  }

  return <div className="permission-preset-rules">
    {toolKeys.map((toolKey) => {
      const rules = effective[toolKey] ?? []
      const overridden = toolKey in profile.overrides
      return <div className="permission-toolkey" key={toolKey}>
        <div className="permission-toolkey-head">
          <span className="permission-rule-key">{TOOL_KEY_LABELS[toolKey as LogicalToolKey] ?? toolKey}</span>
          <span className="permission-toolkey-actions">
            {overridden && <button className="permission-toolkey-reset" onClick={() => onOverridesChange(resetProfileToolKey(profile, toolKey))} title="恢复该工具的出厂规则"><RotateCcw size={11} />恢复默认</button>}
            <button className="permission-toolkey-add" onClick={() => { setAdding(toolKey); setDraftPattern('') }} title="添加规则"><Plus size={12} />添加规则</button>
          </span>
        </div>
        <div className="permission-rule-list">
          {rules.map((rule, index) => (
            <div className="permission-rule-edit" key={`${toolKey}-${index}-${rule.pattern}`}>
              <PatternInput
                value={rule.pattern}
                label={`${toolKey} 第 ${index + 1} 条规则的匹配模式`}
                onCommit={(pattern) => onOverridesChange(upsertProfileRule(profile, toolKey, { pattern, action: rule.action }, index))}
              />
              <ActionSelect
                value={rule.action}
                label={`${toolKey} ${rule.pattern} 的动作`}
                onChange={(action) => onOverridesChange(upsertProfileRule(profile, toolKey, { pattern: rule.pattern, action }, index))}
              />
              <button className="permission-user-remove" onClick={() => onOverridesChange(removeProfileRule(profile, toolKey, index))} aria-label={`删除规则 ${rule.pattern}`} title="删除规则"><Trash2 size={12} /></button>
            </div>
          ))}
          {adding === toolKey && <div className="permission-rule-edit">
            <input
              className="permission-pattern-input"
              autoFocus
              value={draftPattern}
              onChange={(event) => setDraftPattern(event.target.value)}
              onBlur={() => commitNewRule(toolKey)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                if (event.key === 'Escape') { setAdding(null); setDraftPattern('') }
              }}
              placeholder="匹配模式，支持 * 与 ?"
              aria-label={`${toolKey} 新规则的匹配模式`}
              spellCheck={false}
            />
          </div>}
        </div>
      </div>
    })}
    <p className="settings-hint">规则按顺序匹配，最后一条命中的生效；`*` 是该工具的默认动作。`rm -rf *`、`git push --force*`、`shutdown*`、`format *` 是全局禁止项，删掉也会被自动补回。</p>
  </div>
}

function NewProfileForm({ existing, onCreate, onCancel }: { existing: PermissionProfile[]; onCreate: (draft: { id: string; label: string; hint: string; base: BuiltinPermissionPreset }) => void; onCancel: () => void }) {
  const [label, setLabel] = useState('')
  const [hint, setHint] = useState('')
  const [base, setBase] = useState<BuiltinPermissionPreset>('workspace')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const draft = { id: slugifyProfileId(label), label: label.trim(), hint: hint.trim(), base }
    const message = validateProfileDraft(draft, existing)
    if (message) { setError(message); return }
    onCreate(draft)
  }

  return <div className="permission-profile-form">
    <div className="permission-profile-form-row">
      <input value={label} autoFocus onChange={(event) => { setLabel(event.target.value); setError(null) }} placeholder="档位名称，如「只读审计」" aria-label="档位名称" />
      <select value={base} onChange={(event) => setBase(event.target.value as BuiltinPermissionPreset)} aria-label="继承的基础档位">
        {BUILTIN_PRESET_IDS.map((id) => <option key={id} value={id}>继承自 {id}</option>)}
      </select>
    </div>
    <input value={hint} onChange={(event) => setHint(event.target.value)} placeholder="一行说明，显示在输入区的档位菜单里" aria-label="档位说明" />
    {error && <p className="settings-hint permission-form-error">{error}</p>}
    <div className="ability-empty-actions">
      <button className="quick-secondary" onClick={submit}>创建档位</button>
      <button className="quick-secondary" onClick={onCancel}>取消</button>
    </div>
  </div>
}

function UserRuleForm({ onAdd, onCancel }: { onAdd: (rule: { toolKey: string; pattern: string; action: PermissionAction }) => void; onCancel: () => void }) {
  const [toolKey, setToolKey] = useState<string>('shell')
  const [pattern, setPattern] = useState('')
  const [action, setAction] = useState<PermissionAction>('allow')
  return <div className="permission-profile-form">
    <div className="permission-profile-form-row">
      <select value={toolKey} onChange={(event) => setToolKey(event.target.value)} aria-label="规则适用的工具">
        {TOOL_KEYS.map((key) => <option key={key} value={key}>{TOOL_KEY_LABELS[key]}</option>)}
      </select>
      <ActionSelect value={action} onChange={setAction} label="规则动作" />
    </div>
    <input value={pattern} autoFocus onChange={(event) => setPattern(event.target.value)} placeholder="匹配模式，如 npm *" aria-label="匹配模式" spellCheck={false} />
    <div className="ability-empty-actions">
      <button className="quick-secondary" onClick={() => { if (pattern.trim()) onAdd({ toolKey, pattern: pattern.trim(), action }) }}>添加规则</button>
      <button className="quick-secondary" onClick={onCancel}>取消</button>
    </div>
  </div>
}

export function PermissionSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  const [profiles, setProfiles] = useState<PermissionProfile[] | null>(null)
  const [userRules, setUserRules] = useState<StoredPermissionRule[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [addingUserRule, setAddingUserRule] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // bash 路径输入框的草稿：打字过程中不写库，失焦或回车才提交。
  const [bashPathDraft, setBashPathDraft] = useState(settings.bashPath)

  useEffect(() => { setBashPathDraft(settings.bashPath) }, [settings.bashPath])
  useEffect(() => {
    void window.fastAgent.conversations.listPermissionRules().then(setUserRules).catch(() => setUserRules([]))
    void window.fastAgent.conversations.listPermissionProfiles().then(setProfiles).catch(() => setProfiles([]))
  }, [])

  function commitBashPath() {
    const trimmed = bashPathDraft.trim()
    if (trimmed !== settings.bashPath) onChange({ bashPath: trimmed })
    setBashPathDraft(trimmed)
  }

  function pickBashExecutable() {
    void window.fastAgent.settings.pickBashExecutable().then((picked) => {
      if (picked) {
        setBashPathDraft(picked)
        onChange({ bashPath: picked })
      }
    })
  }

  function saveProfile(profile: PermissionProfile, patch: Partial<Pick<PermissionProfile, 'label' | 'hint' | 'overrides'>>) {
    setError(null)
    void window.fastAgent.conversations.savePermissionProfile({
      id: profile.id,
      label: patch.label ?? profile.label,
      hint: patch.hint ?? profile.hint,
      base: profile.base,
      builtin: profile.builtin,
      overrides: patch.overrides ?? profile.overrides,
      position: profile.position
    }).then(setProfiles).catch((cause) => setError(cause instanceof Error ? cause.message : '保存失败'))
  }

  function createProfile(draft: { id: string; label: string; hint: string; base: BuiltinPermissionPreset }) {
    setError(null)
    void window.fastAgent.conversations.savePermissionProfile({ ...draft, builtin: false, overrides: {}, position: (profiles?.length ?? 0) })
      .then((next) => { setProfiles(next); setCreating(false) })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '创建失败'))
  }

  function removeProfile(profile: PermissionProfile) {
    setError(null)
    void window.fastAgent.conversations.removePermissionProfile(profile.id).then(setProfiles).catch(() => undefined)
  }

  function addUserRule(rule: { toolKey: string; pattern: string; action: PermissionAction }) {
    void window.fastAgent.conversations.upsertPermissionRule(rule)
      .then((next) => { setUserRules(next); setAddingUserRule(false) })
      .catch(() => setAddingUserRule(false))
  }

  function removeRule(toolKey: string, pattern: string) {
    void window.fastAgent.conversations.removePermissionRule(toolKey, pattern)
      .then(() => setUserRules((current) => (current ?? []).filter((rule) => !(rule.toolKey === toolKey && rule.pattern === pattern))))
      .catch(() => undefined)
  }

  return <section className="settings-panel" aria-labelledby="settings-permissions">
    <div className="settings-section-heading">
      <div><h2 id="settings-permissions">Agent 执行权限</h2><p>档位决定各工具的默认动作。内置三档可以改规则并随时恢复出厂，也可以新建自己的档位，输入区的档位菜单会跟着列出。</p></div>
      <button className="quick-secondary" onClick={() => setCreating((current) => !current)}><Plus size={13} />新建档位</button>
    </div>
    {error && <p className="settings-hint permission-form-error">{error}</p>}
    {creating && profiles && <NewProfileForm existing={profiles} onCreate={createProfile} onCancel={() => setCreating(false)} />}

    {profiles === null ? <div className="permission-user-empty">加载中…</div> : <div className="permission-presets">
      {profiles.map((profile) => (
        <details className="permission-preset" key={profile.id}>
          <summary>
            <span className={`permission-preset-icon ${profile.base}`}>{presetIcon(profile.base)}</span>
            <strong>{profile.label}</strong>
            <small>{profile.description}</small>
          </summary>
          <div className="permission-profile-meta">
            <PatternInput value={profile.label} label={`${profile.label} 的名称`} onCommit={(label) => saveProfile(profile, { label })} />
            {profile.builtin
              // 改名也算改动：只看 overrides 的话，重命名过的内置档就没法恢复了。
              ? (Object.keys(profile.overrides).length > 0 || profile.label !== BUILTIN_PROFILE_META[profile.base].label) &&
                <button className="permission-toolkey-reset" onClick={() => removeProfile(profile)} title="丢弃全部改动，恢复出厂名称与规则"><RotateCcw size={11} />恢复出厂</button>
              : <button className="permission-user-remove" onClick={() => removeProfile(profile)} aria-label={`删除档位 ${profile.label}`} title="删除档位"><Trash2 size={12} /></button>}
          </div>
          <ProfileRules profile={profile} onOverridesChange={(overrides) => saveProfile(profile, { overrides })} />
        </details>
      ))}
    </div>}

    <div className="settings-section-heading" style={{ marginTop: 18 }}>
      <div><h2>你的自定义规则</h2><p>选择「始终允许」时写入，对所有档位生效且优先级高于档位规则。</p></div>
      <button className="quick-secondary" onClick={() => setAddingUserRule((current) => !current)}><Plus size={13} />添加规则</button>
    </div>
    {addingUserRule && <UserRuleForm onAdd={addUserRule} onCancel={() => setAddingUserRule(false)} />}
    {userRules === null ? <div className="permission-user-empty">加载中…</div> : userRules.length === 0 ? <div className="permission-user-empty">还没有自定义规则。</div> : (
      <div className="permission-user-rules">
        {userRules.map((rule) => (
          <div className="permission-user-rule" key={`${rule.toolKey}\t${rule.pattern}`}>
            <span className="permission-user-key">{TOOL_KEY_LABELS[rule.toolKey as LogicalToolKey] ?? rule.toolKey}</span>
            <code className="permission-user-pattern">{rule.pattern}</code>
            <ActionSelect value={rule.action} label={`${rule.pattern} 的动作`} onChange={(action) => addUserRule({ toolKey: rule.toolKey, pattern: rule.pattern, action })} />
            <button className="permission-user-remove" onClick={() => removeRule(rule.toolKey, rule.pattern)} aria-label={`删除规则 ${rule.pattern}`} title="删除规则"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
    )}

    <div className="settings-section-heading" style={{ marginTop: 18 }}><div><h2>Sub-agent</h2><p>只读 Sub-agent 仅用于独立调查和验证；关闭后主 Agent 无法调用该能力。</p></div></div>
    <label className="switch-row" style={{ marginTop: 8 }}><input type="checkbox" checked={settings.subAgentEnabled} onChange={(event) => onChange({ subAgentEnabled: event.target.checked })} /><span className="switch-visual" /><span><strong>启用只读 Sub-agent</strong><small>允许主 Agent 委派 read、grep、find、ls 调查任务</small></span></label>
    {settings.subAgentEnabled && <SubAgentSettings settings={settings} onChange={onChange} />}

    <div className="settings-section-heading" style={{ marginTop: 18 }}><div><h2>Shell 偏好</h2><p>agent 模式下使用的命令工具；Windows 默认 Git Bash，探测不到可用 bash 时自动改用 PowerShell。</p></div></div>
    <div className="settings-segmented settings-shell-segmented" role="group" aria-label="Shell 偏好">
      {(['bash', 'powershell'] as const).map((shell) => (
        <button key={shell} className={settings.shellPreference === shell ? 'active' : ''} onClick={() => onChange({ shellPreference: shell })} aria-pressed={settings.shellPreference === shell}>
          <TerminalSquare size={13} />{shell}
        </button>
      ))}
    </div>
    <div className="settings-bash-path">
      <input
        value={bashPathDraft}
        onChange={(event) => setBashPathDraft(event.target.value)}
        onBlur={commitBashPath}
        onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
        placeholder="bash 路径（留空自动探测 Git Bash / PATH）"
        aria-label="bash 可执行文件路径"
        spellCheck={false}
      />
      <button type="button" className="settings-bash-pick" onClick={pickBashExecutable} title="选择 bash.exe"><FolderOpen size={13} />浏览</button>
      {settings.bashPath && <button type="button" className="icon-button" onClick={() => { setBashPathDraft(''); onChange({ bashPath: '' }) }} aria-label="清除 bash 路径" title="清除，恢复自动探测"><X size={13} /></button>}
    </div>
    <p className="settings-hint">Windows 上若 bash 指向未安装的 WSL，命令会全部失败；可在这里手动指定 bash.exe（如 Git Bash 或 MSYS2）。切换后下一轮对话生效。Skill 与 MCP Server 本身在「能力」页安装、配置与启停；这里只决定它们提供的工具是否放行。</p>
  </section>
}
