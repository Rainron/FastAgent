export type ComposerDensity = 'wide' | 'medium' | 'compact'

export interface ComposerLayoutInput {
  width: number
  running: boolean
  hasDraft: boolean
  workspace: boolean
  branch: boolean
  permission: boolean
  reasoning: boolean
  plan: boolean
  fontScale?: number
}

export function composerLayout(input: ComposerLayoutInput) {
  const width = Math.max(0, input.width) / Math.max(1, input.fontScale ?? 1)
  const actions = input.running ? (input.hasDraft ? 108 : 72) : 36
  const context = 32 + (input.workspace ? 116 : 0) + (input.branch ? 112 : 0)
    + (input.plan ? 48 : 0) + 72 + (input.hasDraft ? 32 : 0)
  const controls = 72 + (input.reasoning ? 190 : 132) + (input.permission ? 140 : 0)
  const wide = context + controls + actions + 60
  const compact = context + 72 + 100 + (input.permission ? 40 : 0) + actions + 48
  const rows = width < compact ? 2 : 1
  const density: ComposerDensity = width >= wide ? 'wide' : width < 400 ? 'compact' : 'medium'
  return { rows, density, overflow: width < wide, iconContext: width < 400 }
}
