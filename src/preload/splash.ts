/**
 * 启动页专用桥接：只开一条接收通道。
 *
 * 不复用主 preload 是为了让启动页真的「轻」——它唯一的职责是把主进程给的状态画出来，
 * 不该拿到任何可以改数据的能力。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { SplashUpdate } from '../shared/types'

contextBridge.exposeInMainWorld('fastAgentSplash', {
  onUpdate: (listener: (update: SplashUpdate) => void) => {
    ipcRenderer.on('splash:update', (_event, payload: SplashUpdate) => listener(payload))
  }
})
