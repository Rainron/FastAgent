import { useEffect, useRef, useState } from 'react'
import type { AppSettings, StoredPermissionRule } from '../../../shared/types'
import type { PermissionAction } from '../../../shared/permission-rules'
import type { PermissionProfile, BuiltinPermissionPreset } from '../../../shared/permission-profiles'

export function usePermissionSettings(settings: AppSettings, onChange: (patch: Partial<AppSettings>) => void) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [profiles, setProfiles] = useState<PermissionProfile[] | null>(null)
  const [userRules, setUserRules] = useState<StoredPermissionRule[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [addingUserRule, setAddingUserRule] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState('workspace')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [browsingUserRules, setBrowsingUserRules] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // bash 路径输入框的草稿：打字过程中不写库，失焦或回车才提交。
  const [bashPathDraft, setBashPathDraft] = useState(settings.bashPath)

  useEffect(() => { setBashPathDraft(settings.bashPath) }, [settings.bashPath])
  function reload() {
    setError(null)
    void window.fastAgent.conversations.listPermissionRules().then(setUserRules).catch(() => setError('自定义规则加载失败'))
    void window.fastAgent.conversations.listPermissionProfiles().then(setProfiles).catch(() => setError('权限档位加载失败'))
  }
  useEffect(reload, [])

  async function mutate(operation: () => Promise<unknown>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try { await operation() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试') }
    finally { busyRef.current = false; setBusy(false) }
  }

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
    void mutate(() => window.fastAgent.conversations.savePermissionProfile({
      id: profile.id,
      label: patch.label ?? profile.label,
      hint: patch.hint ?? profile.hint,
      base: profile.base,
      builtin: profile.builtin,
      overrides: patch.overrides ?? profile.overrides,
      position: profile.position
    }).then(setProfiles))
  }

  function createProfile(draft: { id: string; label: string; hint: string; base: BuiltinPermissionPreset }) {
    setError(null)
    void mutate(() => window.fastAgent.conversations.savePermissionProfile({ ...draft, builtin: false, overrides: {}, position: (profiles?.length ?? 0) })
      .then((next) => { setProfiles(next); setCreating(false) })
    )
  }

  function removeProfile(profile: PermissionProfile) {
    setError(null)
    void mutate(() => window.fastAgent.conversations.removePermissionProfile(profile.id).then(setProfiles))
  }

  function addUserRule(rule: { toolKey: string; pattern: string; action: PermissionAction }) {
    void mutate(() => window.fastAgent.conversations.upsertPermissionRule(rule)
      .then((next) => { setUserRules(next); setAddingUserRule(false) })
    )
  }

  function removeRule(toolKey: string, pattern: string) {
    void mutate(() => window.fastAgent.conversations.removePermissionRule(toolKey, pattern)
      .then(() => setUserRules((current) => (current ?? []).filter((rule) => !(rule.toolKey === toolKey && rule.pattern === pattern))))
    )
  }

  // 保存档位后 profiles 会整份替换，弹层按 id 重新取，避免拿着旧对象继续改。
  const editingProfile = profiles?.find((profile) => profile.id === editingProfileId) ?? null

  const selectedProfile = profiles?.find((profile) => profile.id === selectedProfileId) ?? profiles?.[0] ?? null
  return { busy, reload, profiles, userRules, creating, setCreating, addingUserRule, setAddingUserRule, editingProfileId, setEditingProfileId, browsingUserRules, setBrowsingUserRules, error, bashPathDraft, setBashPathDraft, commitBashPath, pickBashExecutable, saveProfile, createProfile, removeProfile, addUserRule, removeRule, editingProfile, selectedProfile, setSelectedProfileId }
}
