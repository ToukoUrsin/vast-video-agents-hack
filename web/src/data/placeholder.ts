// Placeholder library. Same shapes as the VastDB reads (see types.ts), seeded so every
// reload looks identical. Swap for real rows in data/index.ts.
import type { Clip, Cluster, LibraryData, Site } from './types'
import { gauss, mulberry32, pick } from '../lib/rng'

export const SITES: Site[] = [
  { id: 'warehouse', name: 'Warehouse', kind: 'warehouse', source: 'stock' },
  { id: 'i24', name: 'Highway I-24', kind: 'highway', source: 'stock' },
  { id: 'toronto', name: 'Toronto dashcam', kind: 'dashcam', source: 'stock' },
  { id: 'neighborhood', name: 'Neighborhood street', kind: 'street', source: 'stock' },
  { id: 'sf', name: 'SF streets', kind: 'city', source: 'stock' },
  { id: 'smartspace', name: 'Indoor smart space', kind: 'indoor', source: 'stock' },
  { id: 'studio', name: 'Our bench', kind: 'task-box', source: 'ours' },
]

const SITE_COUNTS: Record<string, number> = {
  warehouse: 96,
  i24: 84,
  toronto: 54,
  neighborhood: 62,
  sf: 70,
  smartspace: 46,
}

/** Probability that a clip from a site belongs to each archive cluster; remainder = noise. */
const SITE_CLUSTERS: Record<string, [string, number][]> = {
  warehouse: [['forklift', 0.66], ['aisle', 0.26]],
  i24: [['truck', 0.9]],
  toronto: [['crossing', 0.42], ['car', 0.42]],
  neighborhood: [['car', 0.86]],
  sf: [['crossing', 0.82]],
  smartspace: [['aisle', 0.84]],
}

/** Cluster centres in embedding space (roughly -1..1). */
const CENTRES: Record<string, [number, number]> = {
  'packing-box': [-0.3, -0.06],
  'making-tea': [0.12, -0.14],
  'safety-gear': [-0.08, 0.44],
  forklift: [-0.66, -0.4],
  aisle: [-0.62, 0.46],
  truck: [0.66, -0.46],
  crossing: [0.64, 0.42],
  car: [0.02, -0.74],
}

const CAPTIONS: Record<string, string[]> = {
  forklift: [
    'A forklift lifts a wrapped pallet and reverses out of the aisle.',
    'Forklift carries two stacked cartons toward the loading bay.',
    'Operator lowers the forks and slides them under a pallet.',
    'A forklift turns at the end of the rack with a raised load.',
  ],
  aisle: [
    'A person walks down the aisle scanning the shelf labels.',
    'Worker stops at a bay and takes a box from the middle shelf.',
    'Two people pass each other in a narrow aisle.',
    'A person pushes a cart slowly past the shelving.',
  ],
  truck: [
    'A semi-truck signals and moves into the left lane.',
    'A box truck drifts across the lane line while overtaking.',
    'Truck merges between two cars in moderate traffic.',
    'A tanker changes lanes after a car slows ahead.',
  ],
  crossing: [
    'Pedestrians cross at the crosswalk while cars wait.',
    'A person with a backpack crosses mid-block between parked cars.',
    'A group crosses as the signal changes.',
    'A cyclist and two pedestrians cross in front of the camera.',
  ],
  car: [
    'A sedan passes the houses at low speed.',
    'A car slows for a speed bump in a residential street.',
    'An SUV pulls out of a driveway and drives away.',
    'A delivery van passes and stops two houses down.',
  ],
  noise: [
    'Empty scene, no significant motion.',
    'Camera view with light changes and no people.',
    'A bird crosses the frame; nothing else moves.',
    'Static view, a parked vehicle, no activity.',
  ],
}

export const CLUSTERS: Cluster[] = [
  {
    id: 'packing-box',
    label: 'Packing a box',
    source: 'ours',
    tint: '#D2C3A6',
    steps: [
      { id: 'pb1', text: 'Fold bottom flaps', expert_clip_id: 'ours-box-1', expert_start_s: 1, expert_end_s: 6 },
      {
        id: 'pb2',
        text: 'Tape the bottom seam',
        expert_clip_id: 'ours-box-1',
        expert_start_s: 6,
        expert_end_s: 12,
        common_mistake: "Hold on. The bottom seam isn't taped yet. Tape it before the item goes in.",
      },
      { id: 'pb3', text: 'Insert item', expert_clip_id: 'ours-box-2', expert_start_s: 12, expert_end_s: 16 },
      { id: 'pb4', text: 'Close top flaps', expert_clip_id: 'ours-box-1', expert_start_s: 16, expert_end_s: 21 },
      { id: 'pb5', text: 'Tape and label', expert_clip_id: 'ours-box-1', expert_start_s: 21, expert_end_s: 29 },
    ],
  },
  {
    id: 'making-tea',
    label: 'Making tea',
    source: 'ours',
    tint: '#A9BBA2',
    steps: [
      { id: 'mt1', text: 'Fill the kettle', expert_clip_id: 'ours-tea-1', expert_start_s: 0, expert_end_s: 6 },
      { id: 'mt2', text: 'Switch the kettle on', expert_clip_id: 'ours-tea-1', expert_start_s: 6, expert_end_s: 9 },
      {
        id: 'mt3',
        text: 'Tea bag in the cup',
        expert_clip_id: 'ours-tea-2',
        expert_start_s: 9,
        expert_end_s: 13,
        common_mistake: 'Wait. The tea bag goes in the cup before the water.',
      },
      { id: 'mt4', text: 'Pour the hot water', expert_clip_id: 'ours-tea-1', expert_start_s: 13, expert_end_s: 19 },
      { id: 'mt5', text: 'Remove the tea bag', expert_clip_id: 'ours-tea-1', expert_start_s: 19, expert_end_s: 24 },
    ],
  },
  {
    id: 'safety-gear',
    label: 'Putting on safety gear',
    source: 'ours',
    tint: '#C9AC8E',
    steps: [
      { id: 'sg1', text: 'Put on the hi-vis vest', expert_clip_id: 'ours-gear-1', expert_start_s: 0, expert_end_s: 5 },
      {
        id: 'sg2',
        text: 'Fasten the vest',
        expert_clip_id: 'ours-gear-1',
        expert_start_s: 5,
        expert_end_s: 9,
        common_mistake: "The vest is still open. Fasten it before you move on.",
      },
      { id: 'sg3', text: 'Put on safety glasses', expert_clip_id: 'ours-gear-2', expert_start_s: 9, expert_end_s: 13 },
      { id: 'sg4', text: 'Put on gloves', expert_clip_id: 'ours-gear-1', expert_start_s: 13, expert_end_s: 19 },
      { id: 'sg5', text: 'Put on the hard hat', expert_clip_id: 'ours-gear-1', expert_start_s: 19, expert_end_s: 23 },
    ],
  },
  archive('forklift', 'Forklift moving pallet', '#8FA2B4', ['Approach the pallet', 'Lower the forks', 'Lift the load', 'Reverse out', 'Drive to the bay']),
  archive('aisle', 'Person walking aisle', '#93AEA7', ['Enter the aisle', 'Scan the shelves', 'Stop at the bay', 'Pick the item', 'Walk out']),
  archive('truck', 'Truck changing lanes', '#A6A9AE', ['Hold the lane', 'Signal', 'Check the gap', 'Cross the line', 'Settle in lane']),
  archive('crossing', 'People crossing street', '#B79F9A', ['Wait at the curb', 'Look both ways', 'Step off', 'Cross', 'Reach the far curb']),
  archive('car', 'Car passing houses', '#B3AC8F', ['Enter frame', 'Pass the driveway', 'Slow for the bump', 'Pass the houses', 'Leave frame']),
]

function archive(id: string, label: string, tint: string, steps: string[]): Cluster {
  return {
    id,
    label,
    source: 'stock',
    tint,
    steps: steps.map((text, i) => ({
      id: `${id}${i + 1}`,
      text,
      expert_clip_id: `${id}-expert`,
      expert_start_s: i * 3,
      expert_end_s: i * 3 + 3,
    })),
  }
}

const TAKES: Array<{ id: string; task: string; take: number; score: number; caption: string }> = [
  { id: 'ours-box-1', task: 'packing-box', take: 1, score: 94, caption: 'Person folds the bottom flaps, tapes the seam, packs a mug and seals the box.' },
  { id: 'ours-box-2', task: 'packing-box', take: 2, score: 89, caption: 'Person assembles a box, inserts the item and tapes the top, slightly slower.' },
  { id: 'ours-box-3', task: 'packing-box', take: 3, score: 52, caption: 'Person inserts the item before taping the bottom; the bottom flaps open.' },
  { id: 'ours-tea-1', task: 'making-tea', take: 1, score: 92, caption: 'Person fills the kettle, puts a tea bag in the cup and pours the water.' },
  { id: 'ours-tea-2', task: 'making-tea', take: 2, score: 86, caption: 'Person makes tea, removing the bag after a short steep.' },
  { id: 'ours-tea-3', task: 'making-tea', take: 3, score: 61, caption: 'Person pours water before adding the tea bag and leaves the bag in.' },
  { id: 'ours-gear-1', task: 'safety-gear', take: 1, score: 96, caption: 'Person puts on a hi-vis vest, fastens it, adds glasses, gloves and a hard hat.' },
  { id: 'ours-gear-2', task: 'safety-gear', take: 2, score: 84, caption: 'Person puts on the gear in order but adjusts the glasses twice.' },
  { id: 'ours-gear-3', task: 'safety-gear', take: 3, score: 47, caption: 'Person leaves the vest unfastened and skips the gloves.' },
]

function buildClips(): Clip[] {
  const rand = mulberry32(20261002)
  const clips: Clip[] = []
  for (const [site, count] of Object.entries(SITE_COUNTS)) {
    for (let i = 0; i < count; i++) {
      let cluster: string | null = null
      let r = rand()
      for (const [cid, p] of SITE_CLUSTERS[site]) {
        if (r < p) {
          cluster = cid
          break
        }
        r -= p
      }
      const [cx, cy] = cluster ? CENTRES[cluster] : [rand() * 1.8 - 0.9, rand() * 1.8 - 0.9]
      const spread = cluster ? 0.09 : 0
      const cam = Math.floor(rand() * 4) + 1
      clips.push({
        clip_id: `${site}-${String(i + 1).padStart(3, '0')}`,
        camera_id: `${site}-cam${cam}`,
        location: site,
        source: 'stock',
        thumbnail_url: null,
        caption: pick(rand, CAPTIONS[cluster ?? 'noise']),
        embedding2d: { x: cx + gauss(rand) * spread, y: cy + gauss(rand) * spread },
        cluster_id: cluster,
        duration_s: 6 + Math.round(rand() * 20),
      })
    }
  }
  for (const t of TAKES) {
    const [cx, cy] = CENTRES[t.task]
    const off = (100 - t.score) / 100
    clips.push({
      clip_id: t.id,
      camera_id: 'bench-cam1',
      location: 'studio',
      source: 'ours',
      thumbnail_url: null,
      caption: t.caption,
      embedding2d: { x: cx + off * 0.3, y: cy + off * 0.2 },
      cluster_id: t.task,
      score: t.score,
      take_label: `Take ${t.take}`,
      duration_s: 24 + Math.round(rand() * 14),
    })
  }
  return clips
}

const clips = buildClips()

export const PLACEHOLDER: LibraryData = {
  sites: SITES,
  clips,
  clusters: CLUSTERS,
  ingest: {
    started_at: '15:42',
    replay_s: 9,
    stages: [
      { id: 'segment', label: 'Segment', total: clips.length, unit: 'clips' },
      { id: 'detect', label: 'Detect', model: 'YOLO', total: 18_406, unit: 'boxes' },
      { id: 'describe', label: 'Describe', model: 'Cosmos Reason', total: clips.length, unit: 'captions' },
      { id: 'embed', label: 'Embed', model: 'Cosmos Embed', total: clips.length, unit: 'vectors' },
      { id: 'store', label: 'VastDB', total: clips.length, unit: 'rows' },
    ],
  },
}
