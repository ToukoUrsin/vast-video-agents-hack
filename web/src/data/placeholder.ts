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
  { id: 'studio', name: 'Our bench', kind: 'task-lego', source: 'ours' },
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
  'lego-tower': [-0.3, -0.06],
  'cup-pyramid': [0.12, -0.14],
  'pour-drink': [-0.08, 0.44],
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
    id: 'lego-tower',
    label: 'Lego assembly',
    source: 'ours',
    tint: '#D2C3A6',
    steps: [
      { id: 'lt1', text: 'Place the base plate flat on the table', expert_clip_id: 'ours-lego-1', expert_start_s: 0, expert_end_s: 4 },
      { id: 'lt2', text: 'Put a red brick on it', expert_clip_id: 'ours-lego-1', expert_start_s: 4, expert_end_s: 8 },
      {
        id: 'lt3',
        text: 'Put a blue brick on the red one',
        expert_clip_id: 'ours-lego-1',
        expert_start_s: 8,
        expert_end_s: 12,
        common_mistake: 'Wait. The blue brick goes on the red one before the yellow.',
      },
      { id: 'lt4', text: 'Put a yellow brick on top', expert_clip_id: 'ours-lego-1', expert_start_s: 12, expert_end_s: 16 },
      { id: 'lt5', text: 'Push the finished tower to the right side', expert_clip_id: 'ours-lego-2', expert_start_s: 16, expert_end_s: 20 },
    ],
  },
  {
    id: 'cup-pyramid',
    label: 'Cup pyramid',
    source: 'ours',
    tint: '#A9BBA2',
    steps: [
      {
        id: 'cp1',
        text: 'Place 3 cups upside down in a row',
        expert_clip_id: 'ours-cups-1',
        expert_start_s: 0,
        expert_end_s: 6,
        common_mistake: 'The bottom row needs three cups. Add the third cup first.',
      },
      { id: 'cp2', text: 'Put 2 cups on top', expert_clip_id: 'ours-cups-1', expert_start_s: 6, expert_end_s: 11 },
      { id: 'cp3', text: 'Put 1 cup on top', expert_clip_id: 'ours-cups-1', expert_start_s: 11, expert_end_s: 14 },
      { id: 'cp4', text: 'Take the pyramid down into one stack', expert_clip_id: 'ours-cups-2', expert_start_s: 14, expert_end_s: 20 },
    ],
  },
  {
    id: 'pour-drink',
    label: 'Pour a drink',
    source: 'ours',
    tint: '#C9AC8E',
    steps: [
      { id: 'pd1', text: 'Put a cup on the table', expert_clip_id: 'ours-pour-1', expert_start_s: 0, expert_end_s: 3 },
      { id: 'pd2', text: 'Open the bottle', expert_clip_id: 'ours-pour-1', expert_start_s: 3, expert_end_s: 7 },
      { id: 'pd3', text: 'Pour until the cup is about half full', expert_clip_id: 'ours-pour-1', expert_start_s: 7, expert_end_s: 13 },
      {
        id: 'pd4',
        text: 'Close the bottle cap',
        expert_clip_id: 'ours-pour-1',
        expert_start_s: 13,
        expert_end_s: 16,
        common_mistake: 'Close the bottle cap before you move the cup.',
      },
      { id: 'pd5', text: 'Move the cup forward', expert_clip_id: 'ours-pour-2', expert_start_s: 16, expert_end_s: 19 },
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
  { id: 'ours-lego-1', task: 'lego-tower', take: 1, score: 95, caption: 'Person sets the base plate down, stacks red, blue and yellow bricks and slides the tower right.' },
  { id: 'ours-lego-2', task: 'lego-tower', take: 2, score: 88, caption: 'Person builds the red, blue, yellow tower on the base plate, a little slower.' },
  { id: 'ours-lego-3', task: 'lego-tower', take: 3, score: 54, caption: 'Person puts the yellow brick straight on the red one and skips the blue brick.' },
  { id: 'ours-cups-1', task: 'cup-pyramid', take: 1, score: 93, caption: 'Person lines up three cups upside down, adds two and one on top, then stacks them.' },
  { id: 'ours-cups-2', task: 'cup-pyramid', take: 2, score: 86, caption: 'Person builds a three-two-one cup pyramid and takes it down into one stack.' },
  { id: 'ours-cups-3', task: 'cup-pyramid', take: 3, score: 58, caption: 'Person starts the pyramid with only two cups on the bottom row.' },
  { id: 'ours-pour-1', task: 'pour-drink', take: 1, score: 94, caption: 'Person sets a cup down, opens the bottle, pours half a cup and closes the cap.' },
  { id: 'ours-pour-2', task: 'pour-drink', take: 2, score: 85, caption: 'Person pours a drink to about half and recaps the bottle before moving the cup.' },
  { id: 'ours-pour-3', task: 'pour-drink', take: 3, score: 49, caption: 'Person pours the drink and moves the cup forward with the bottle still open.' },
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
