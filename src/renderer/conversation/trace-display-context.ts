import { createContext, useContext } from 'react'
import type { TraceDisplaySettings } from '../../shared/types'
import { DEFAULT_TRACE_DISPLAY } from '../../shared/trace-display'

/**
 * 执行轨迹的展示偏好。轨迹组件散落在 MessageList → ExecutionTrace → ToolCallCard 三层，
 * 且中间几层都套了 memo，用 context 下发比一路透传 props 更不容易漏。
 */
export const TraceDisplayContext = createContext<TraceDisplaySettings>(DEFAULT_TRACE_DISPLAY)

export function useTraceDisplay(): TraceDisplaySettings {
  return useContext(TraceDisplayContext)
}
