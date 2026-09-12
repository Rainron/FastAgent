import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { QuestionAnswer, QuestionItem } from '../../../shared/types'

export interface QuestionToolContext {
  cwd: string
  /** run 级中止信号：取消时挂起的提问结算为拒绝 */
  signal: AbortSignal
  /** 发起提问：发 question_required 事件并等待渲染进程回答；被取消时 reject。 */
  requestQuestion: (toolCallId: string, questions: QuestionItem[], signal: AbortSignal) => Promise<QuestionAnswer[]>
}

export function createQuestionTool(context: QuestionToolContext): ToolDefinition {
  return defineTool({
    name: 'question',
    label: 'Question',
    description: '向用户提出一个或多个澄清问题并等待回答。任务含糊、缺少关键决策或需要用户选择时使用。',
    promptSnippet: 'Ask the user clarifying questions and wait for answers',
    promptGuidelines: [
      'Use question when the task is ambiguous, requires a user decision, or needs information only the user can provide.',
      'Ask at most three questions at a time; each question must have a unique id.',
      'Options may be plain strings or objects {title, description, recommended}; set recommended on the option you advise. Use type "multi-select" for multiple answers, "text" or "textarea" for free-form input, and required:false for optional questions.'
    ],
    parameters: Type.Object({
      questions: Type.Array(Type.Object({
        id: Type.String({ description: '问题唯一标识' }),
        title: Type.String({ description: '问题标题' }),
        question: Type.String({ description: '问题说明' }),
        type: Type.Optional(Type.Union([
          Type.Literal('single-select'),
          Type.Literal('multi-select'),
          Type.Literal('text'),
          Type.Literal('textarea')
        ], { description: '交互形式；有 options 时默认 single-select，无 options 时默认 text' })),
        required: Type.Optional(Type.Boolean({ description: '是否必答，默认 true' })),
        options: Type.Optional(Type.Array(Type.Union([
          Type.String(),
          Type.Object({
            title: Type.String({ description: '选项名称' }),
            description: Type.Optional(Type.String({ description: '辅助说明' })),
            recommended: Type.Optional(Type.Boolean({ description: '是否为推荐选项' }))
          })
        ])))
      }))
    }),
    async execute(toolCallId, params, signal, _onUpdate, _extensionCtx) {
      const waitSignal = signal ?? context.signal
      if (waitSignal.aborted) throw new Error('执行已取消')
      const answers = await context.requestQuestion(toolCallId, params.questions, waitSignal)
      const text = answers
        .map((answer) => {
          const question = params.questions.find((item) => item.id === answer.id)
          return `Q: ${question?.question ?? answer.id}\n用户回答: ${answer.answer || '（未回答）'}`
        })
        .join('\n\n')
      return { content: [{ type: 'text', text: text || '用户没有提供回答' }], details: { answers } }
    }
  })
}