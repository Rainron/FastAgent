import { createContext, useContext } from 'react'

export interface SubAgentSelection {
  turnId: string
  taskId: string
}

export interface SubAgentPanelControl {
  /** 右侧详情面板当前展示的子代理；面板关着时为 null。 */
  selected: SubAgentSelection | null
  /** 点同一个子代理收起面板，点别的切过去。 */
  toggle: (selection: SubAgentSelection) => void
}

/**
 * 子代理行散在 MessageList → ExecutionTrace 之下，中间几层都套了 memo，
 * 与轨迹展示偏好一样用 context 下发，免得每层透传一个回调。
 */
export const SubAgentPanelContext = createContext<SubAgentPanelControl>({ selected: null, toggle: () => undefined })

export function useSubAgentPanelControl(): SubAgentPanelControl {
  return useContext(SubAgentPanelContext)
}
