import type { SceneKind } from '../data/types'
import { library } from '../data'
import { SITES } from '../data/placeholder'

const kinds = new Map([...SITES, ...library.sites].map((s) => [s.id, s.kind]))
export const getSiteKind = (location: string): SceneKind => kinds.get(location) ?? 'indoor'
