import type { ThinkingLevel } from '../../../shared/types'

export type SubAgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'
export type SubAgentExpectedOutput = 'findings' | 'review' | 'verification'

export interface SubAgentConfig {
  id: string
  name: string
  description: string
  systemPrompt: string
  tools: string[]
  allowWrite: false
  allowMcp: false
  thinkingLevel: ThinkingLevel
  maxTurns: number
}

export interface SubAgentTask {
  taskId: string
  agentId: string
  goal: string
  context?: string
  expectedOutput?: SubAgentExpectedOutput
  verificationRequirements?: string[]
  forbiddenActions?: string[]
}

export interface SubAgentResult {
  taskId: string
  agentId: string
  agentName: string
  status: Exclude<SubAgentStatus, 'queued' | 'running'>
  output: string
  handoff?: { goal: string; verified: string[]; unverified: string[]; findings: string[]; decisions: string[]; recommendations: string[]; remainingSteps: string[] }
  error?: string
  truncated: boolean
  startedAt: number
  finishedAt: number
}

export interface SubAgentRunEvent {
  taskId: string
  agentId: string
  agentName: string
  status: SubAgentStatus
  output?: string
  detail?: string
}

export const SUBAGENT_LIMITS = {
  maxParallelTasks: 4,
  maxTasksPerCall: 8,
  maxTaskCharacters: 20_000,
  maxOutputCharacters: 50_000,
  maxTurns: 12,
  maxRuntimeMs: 10 * 60 * 1000
} as const
