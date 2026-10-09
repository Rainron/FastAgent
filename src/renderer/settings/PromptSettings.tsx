import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ConversationMode } from '../../shared/types'
import type { ModePrompts } from '../mode-prompts'
import { MarkdownRenderer } from '../resource-panel/MarkdownRenderer'

export function PromptSettings({ prompts, onChange, onReset }: {
  prompts: ModePrompts
  onChange: (mode: ConversationMode, value: string) => void
  onReset?: () => void
}) {
  const [mode, setMode] = useState<ConversationMode>('agent')
  return <section className="settings-panel" aria-labelledby="settings-prompts">
    <div className="settings-section-heading"><div><h2 id="settings-prompts">模式提示词</h2><p>用少量稳定的规则塑造 Agent 的输出风格，不要把一次性任务写在这里。</p></div><span className="settings-badge">自动保存</span></div>
    <div className="prompt-layout">
      <div className="prompt-mode-tabs" role="tablist" aria-label="提示词模式">
        <button role="tab" id="prompt-tab-agent" aria-controls="prompt-panel" aria-selected={mode === 'agent'} className={mode === 'agent' ? 'active' : ''} onClick={() => setMode('agent')}><strong>Agent</strong><small>调查、规划、读写项目与运行测试</small></button>
        <button role="tab" id="prompt-tab-chat" aria-controls="prompt-panel" aria-selected={mode === 'chat'} className={mode === 'chat' ? 'active' : ''} onClick={() => setMode('chat')}><strong>对话</strong><small>问答、翻译、总结，不调用本地工具</small></button>
      </div>
      <div className="prompt-workbench" role="tabpanel" id="prompt-panel" aria-labelledby={`prompt-tab-${mode}`}>
        <div className="prompt-editor">
          <div className="prompt-editor-top"><label htmlFor="settings-prompt-text">{mode === 'agent' ? 'Agent' : '对话'} 模式补充提示词</label><span aria-hidden="true">···</span></div>
          <textarea id="settings-prompt-text" className="prompt-text" value={prompts[mode]} onChange={(event) => onChange(mode, event.target.value)} spellCheck={false} placeholder="输入你的工作方式，支持 Markdown" />
          <div className="prompt-editor-foot"><span>支持 Markdown</span><span>{prompts[mode].length} 字</span></div>
        </div>
        <div className="prompt-preview"><div className="prompt-editor-top"><span>实时预览</span><span className="settings-status-dot connected" /></div><div className="prompt-preview-body">{prompts[mode] ? <MarkdownRenderer content={prompts[mode]} /> : <p className="settings-hint">开始输入 Markdown，右侧会实时显示格式化结果。</p>}</div><div className="prompt-editor-foot">补充内容追加在固定系统提示词之后</div></div>
      </div>
    </div>
    {onReset && <div className="prompt-actions"><button className="quick-secondary" onClick={onReset}><RotateCcw size={13} />恢复默认提示词</button></div>}
  </section>
}
