import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Ctx, type AppCtx, type IngestState, type ScreenId } from './app/context'
import { Stage } from './ui/Stage'
import { TopBar } from './ui/TopBar'
import { FieldEngine } from './lib/field'
import { library } from './data'
import { Library } from './screens/Library'
import { MapScreen } from './screens/MapScreen'
import { Coach } from './screens/Coach'
import { Score } from './screens/Score'
import type { SessionResult } from './coach/types'

const params = new URLSearchParams(location.search)
const initialScreen = (Number(params.get('screen')) || 1) as ScreenId

export default function App() {
  const [screen, setScreen] = useState<ScreenId>(initialScreen)
  const [ingest, setIngest] = useState<IngestState>({ phase: params.has('ingested') ? 'done' : 'idle', startedAt: 0 })
  const [mapPhase, setMapPhase] = useState<'grid' | 'clusters'>(params.has('clustered') ? 'clusters' : 'grid')
  const [session, setSession] = useState<SessionResult | null>(null)
  const field = useMemo(() => new FieldEngine(library.clips), [])
  const keys = useRef<Partial<Record<string, () => void>>>({})
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dev = params.has('dev')

  useEffect(() => {
    field.attach(canvasRef.current!)
    ;(window as unknown as { field: FieldEngine }).field = field
    return () => field.detach()
  }, [field])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLInputElement) return
      if (['1', '2', '3', '4'].includes(e.key)) {
        setScreen(Number(e.key) as ScreenId)
        return
      }
      const k = e.key === ' ' ? ' ' : e.key.toLowerCase()
      const h = keys.current[k]
      if (h) {
        e.preventDefault()
        h()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ctx: AppCtx = { screen, setScreen, field, dev, ingest, setIngest, mapPhase, setMapPhase, session, setSession, keys }

  return (
    <Ctx.Provider value={ctx}>
      <Stage>
        <canvas ref={canvasRef} className="absolute inset-0 z-10" style={{ width: 1920, height: 1080 }} />
        <TopBar />
        <AnimatePresence mode="wait">
          <motion.div
            key={screen}
            className="pointer-events-none absolute inset-0 z-20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            {screen === 1 && <Library />}
            {screen === 2 && <MapScreen />}
            {screen === 3 && <Coach />}
            {screen === 4 && <Score />}
          </motion.div>
        </AnimatePresence>
      </Stage>
    </Ctx.Provider>
  )
}
