import type { ConversationTurn } from '../../shared/types'
import type { ContextMenuItem } from './message-context-menu'

export interface MessageMenuHandlers {
  copyText: (text: string) => void
  quote: (text: string) => void
  rerun: (turn: ConversationTurn) => void
  saveKnowledge: (projectId: string, text: string) => void
  deleteTurn: (turnId: string) => void
}

export interface MessageMenuInput {
  turn: ConversationTurn
  /** 右键落在用户消息还是助手回答上；两侧的动作文案与语义不同。 */
  side: 'user' | 'assistant'
  /** 当前划选文本，空串表示没有划选。 */
  selected: string
  /** 已归属项目的会话才有可写入的知识库，未归属会话不给这一项。 */
  projectId: string | null
}

/**
 * 消息右键菜单的条目。按划选内容与所在消息侧组装，
 * 抽成纯函数是为了能直接测：组件里没法在 node 环境跑。
 */
export function buildMessageMenuItems(input: MessageMenuInput, handlers: MessageMenuHandlers): ContextMenuItem[] {
  const { turn, side, selected, projectId } = input
  const items: ContextMenuItem[] = []
  if (selected) items.push({ id: 'copy-selection', label: '复制选中', onSelect: () => handlers.copyText(selected) })

  const ownText = side === 'user' ? turn.userMessage.text : turn.assistantMessage?.text ?? ''
  if (side === 'user') {
    items.push({ id: 'copy-message', label: '复制原文', onSelect: () => handlers.copyText(ownText) })
    items.push({ id: 'quote', label: '引用到输入框', onSelect: () => handlers.quote(ownText) })
    items.push({ id: 'retry', label: '重新发送', onSelect: () => handlers.rerun(turn) })
  } else {
    items.push({ id: 'copy-message', label: '复制回答', onSelect: () => handlers.copyText(ownText) })
    items.push({ id: 'quote', label: '引用到输入框', onSelect: () => handlers.quote(ownText) })
    items.push({ id: 'regenerate', label: '重新生成', onSelect: () => handlers.rerun(turn) })
  }

  if (projectId) {
    const text = selected || ownText
    if (text.trim()) {
      items.push({
        id: 'save-knowledge',
        label: selected ? '把选中内容存为知识' : '存为项目知识',
        onSelect: () => handlers.saveKnowledge(projectId, text)
      })
    }
  }
  items.push({ id: 'delete', label: '删除本轮问答', danger: true, onSelect: () => handlers.deleteTurn(turn.id) })
  return items
}
