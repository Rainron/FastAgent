import type { ApprovalRequest, ProjectRecord } from '../../shared/types'

export type WorkspaceConversation = { id: string; title: string; meta: string; archived: boolean; projectId: string | null; modelId: number | null }
export type WorkspaceProject = ProjectRecord

export type WorkspaceSection = 'chats' | 'search' | 'conversations' | 'projects' | 'capabilities' | 'hub' | 'settings'

/** 挂起的审批连同来源 run / 会话：多会话并发时用它决定弹给谁、以及哪个 run 结束该清掉它。 */
export type PendingApproval = { request: ApprovalRequest; runId: string; conversationId: string | null }
