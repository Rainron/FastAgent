export interface ShellCommandScope { conversationId: string | null; generation: number }

export function createShellCommandLifecycle() {
  let generation = 0
  const active = new Map<string, ShellCommandScope>()
  return {
    begin(id: string, conversationId: string | null) {
      const scope = { conversationId, generation: ++generation }
      active.set(id, scope)
      return scope
    },
    current(id: string, scope: ShellCommandScope, conversationId: string | null) {
      return active.get(id) === scope && scope.conversationId === conversationId
    },
    finish(id: string) { active.delete(id) },
    dispose(cancel: (id: string) => void) {
      for (const id of active.keys()) cancel(id)
      active.clear()
      generation++
    }
  }
}
