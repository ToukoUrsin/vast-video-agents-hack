import { createContext, useContext, useEffect, useRef } from 'react'
import type { FieldEngine } from '../lib/field'
import type { SessionResult } from '../coach/types'

export type ScreenId = 1 | 2 | 3 | 4

export interface IngestState {
  phase: 'idle' | 'running' | 'done'
  startedAt: number
}

export interface AppCtx {
  screen: ScreenId
  setScreen: (s: ScreenId) => void
  field: FieldEngine
  dev: boolean
  ingest: IngestState
  setIngest: (s: IngestState) => void
  mapPhase: 'grid' | 'clusters'
  setMapPhase: (p: 'grid' | 'clusters') => void
  session: SessionResult | null
  setSession: (r: SessionResult | null) => void
  /** Screens register their Space / R handlers here */
  keys: React.MutableRefObject<Partial<Record<string, () => void>>>
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = () => useContext(Ctx)

/** Register key handlers (e.g. ' ' for Space, 'r') while the calling screen is mounted. */
export function useKeys(handlers: Partial<Record<string, () => void>>) {
  const { keys } = useApp()
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    const names = Object.keys(ref.current)
    for (const k of names) keys.current[k] = () => ref.current[k]?.()
    return () => {
      for (const k of names) delete keys.current[k]
    }
  }, [keys])
}
