export type GlobalShortcutAction = 'showMainWindow' | 'quickChat'
export type InAppShortcutAction = 'commandPalette' | 'newConversation' | 'toggleTheme' | 'openSettings' | 'hideToTray' | 'reloadWindow' | 'restartApp' | 'quitApp' | 'externalEditor' | 'composerUndo' | 'composerRedo'

/** 键盘绑定值为 Electron accelerator 形式（如 'Ctrl+Shift+P'）；鼠标绑定值为 'MouseMiddle' | 'MouseBack' | 'MouseForward' */
export interface ShortcutBinding {
  type: 'key' | 'mouse'
  value: string
}

export interface ShortcutSettings {
  global: Partial<Record<GlobalShortcutAction, ShortcutBinding | null>>
  inApp: Partial<Record<InAppShortcutAction, ShortcutBinding | null>>
}
