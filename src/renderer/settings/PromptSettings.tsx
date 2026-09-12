import { MessageSquare, Zap } from 'lucide-react'
import type { ConversationMode } from '../../shared/types'
import type { ModePrompts } from '../mode-prompts'

const modes: Array<{ mode: ConversationMode; label: string; description: string; icon: React.ReactNode }> = [
  { mode: 'chat', label: '对话', description: '适合问答、翻译和总结，仅进行交流，不调用本地工具。', icon: <MessageSquare size={17} /> },
  { mode: 'agent', label: 'Agent', description: '适合调查、规划、项目读写与调试测试，按当前权限调用工具。', icon: <Zap size={17} /> }
]

export function PromptSettings({ prompts, onChange }: { prompts: ModePrompts; onChange: (mode: ConversationMode, value: string) => void }) {
  return <section className="settings-panel" aria-labelledby="settings-prompts"><div className="settings-section-heading"><div><h2 id="settings-prompts">模式与提示词</h2><p>这里的内容作为用户补充提示词，追加在固定模式系统提示词之后。</p></div></div>{modes.map((item) => <div className="mode-prompt-row" key={item.mode}><div className={`mode-prompt-summary ${item.mode}`}><span className="mode-prompt-icon">{item.icon}</span><div><h3>{item.label}</h3><p>{item.description}</p></div></div><label><span>{item.label}模式提示词</span><textarea rows={5} value={prompts[item.mode]} onChange={(event) => onChange(item.mode, event.target.value)} aria-label={`${item.label}模式提示词`} /></label></div>)}</section>
}
