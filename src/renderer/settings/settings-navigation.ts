export type SettingsCategory = 'general' | 'connection' | 'appearance' | 'models' | 'usage' | 'context' | 'permissions' | 'memory' | 'knowledge' | 'sandbox' | 'prompts' | 'storage' | 'keybindings' | 'runtime' | 'doctor'
export type SettingsGroup = 'workspace' | 'security'

export const settingsCategories: Array<{ key: SettingsCategory; label: string; desc: string; eyebrow: string; group?: SettingsGroup }> = [
  { key: 'permissions', label: 'Agent 与权限', desc: '为 Agent 设定清晰的行动边界，在效率与安全之间找到适合你的工作方式。', eyebrow: 'AGENT CONTROL' },
  { key: 'models', label: '模型服务', desc: '连接你信任的模型服务，选择默认模型，并为不同任务调整参数。', eyebrow: 'MODEL WORKSPACE' },
  { key: 'memory', label: '记忆', desc: '让 FastAgent 记住你的偏好、项目事实和已确认的决策；你始终可以查看、编辑或清除。', eyebrow: 'LONG-TERM CONTEXT' },
  { key: 'knowledge', label: '项目知识库', desc: '把架构约定、发布流程和领域背景集中在这里，让 Agent 在相关任务中自动获得正确上下文。', eyebrow: 'PROJECT SOURCE OF TRUTH' },
  { key: 'prompts', label: '提示词', desc: '为不同工作模式补充你的工作方式。固定系统提示词始终保留，这里的内容会追加在其后。', eyebrow: 'BEHAVIOR LAYER' },
  { key: 'general', label: '常规', desc: '启动、后台与基础行为偏好。', eyebrow: 'WORKSPACE PREFERENCES', group: 'workspace' },
  { key: 'appearance', label: '外观', desc: '主题、强调色与界面密度。', eyebrow: 'WORKSPACE PREFERENCES', group: 'workspace' },
  { key: 'keybindings', label: '快捷键', desc: '应用内与全局快捷键绑定。', eyebrow: 'WORKSPACE PREFERENCES', group: 'workspace' },
  { key: 'connection', label: 'FastAgent 服务器', desc: '登录状态与服务连接。', eyebrow: 'WORKSPACE PREFERENCES', group: 'workspace' },
  { key: 'usage', label: '用量统计', desc: '模型调用量与 token 消耗。', eyebrow: 'WORKSPACE PREFERENCES', group: 'workspace' },
  { key: 'context', label: '对话与上下文', desc: '压缩策略与上下文窗口占用。', eyebrow: 'WORKSPACE PREFERENCES', group: 'workspace' },
  { key: 'storage', label: '数据与存储', desc: '数据目录与存储占用。', eyebrow: 'WORKSPACE PREFERENCES', group: 'workspace' },
  { key: 'sandbox', label: '安全与沙箱', desc: '沙箱与命令执行防护。', eyebrow: 'SECURITY & DIAGNOSTICS', group: 'security' },
  { key: 'runtime', label: '开发环境', desc: '本地命令与运行时路径。', eyebrow: 'SECURITY & DIAGNOSTICS', group: 'security' },
  { key: 'doctor', label: '环境体检', desc: '环境自检与修复。', eyebrow: 'SECURITY & DIAGNOSTICS', group: 'security' }
]

export function settingsNavigation(category: SettingsCategory) {
  const active = settingsCategories.find((item) => item.key === category) ?? settingsCategories[0]
  return {
    active,
    primary: settingsCategories.filter((item) => !item.group),
    tabs: active.group ? settingsCategories.filter((item) => item.group === active.group) : []
  }
}
