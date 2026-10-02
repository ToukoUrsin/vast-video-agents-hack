import type { SceneKind } from '../data/types'
import { SITES } from '../data/placeholder'

const kinds = new Map(SITES.map((s) => [s.id, s.kind]))
export const getSiteKind = (location: string): SceneKind => kinds.get(location) ?? 'indoor'
