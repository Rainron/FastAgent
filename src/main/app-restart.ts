export interface RestartApplicationDependencies {
  confirm: () => Promise<boolean>
  stop: () => void
  markQuitting: () => void
  relaunch: () => void
  quit: () => void
}

export async function restartApplication(dependencies: RestartApplicationDependencies): Promise<boolean> {
  if (!await dependencies.confirm()) return false
  dependencies.stop()
  dependencies.markQuitting()
  dependencies.relaunch()
  dependencies.quit()
  return true
}
