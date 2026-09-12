import type { FastAgentApi } from '../shared/types'

declare global {
  interface Window {
    fastAgent: FastAgentApi
  }
}

export {}
