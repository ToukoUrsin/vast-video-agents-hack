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
  { id: 'studio', name: 'Our floor', kind: 'task-caps', source: 'ours' },
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
  'cap-swap': [-0.3, -0.06],
  'cup-pyramid': [0.12, -0.14],
  'vast-astronaut': [-0.08, 0.44],
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
    id: 'cap-swap',
    label: 'Cap swap',
    source: 'ours',
    tint: '#D2C3A6',
    steps: [
      { id: 'cs1', text: 'Take the green cap off the Mountain Dew', expert_clip_id: 'ours-caps-1', expert_start_s: 0, expert_end_s: 4 },
      { id: 'cs2', text: 'Take the black cap off the Coca-Cola', expert_clip_id: 'ours-caps-1', expert_start_s: 4, expert_end_s: 8 },
      { id: 'cs3', text: "Swap the two bottles' places", expert_clip_id: 'ours-caps-1', expert_start_s: 8, expert_end_s: 12 },
      {
        id: 'cs4',
        text: 'Put the green cap on the Coca-Cola',
        expert_clip_id: 'ours-caps-1',
        expert_start_s: 12,
        expert_end_s: 16,
        common_mistake: 'That cap goes on the other bottle.',
      },
      {
        id: 'cs5',
        text: 'Put the black cap on the Mountain Dew',
        expert_clip_id: 'ours-caps-2',
        expert_start_s: 16,
        expert_end_s: 20,
        common_mistake: 'That cap goes on the other bottle.',
      },
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
    id: 'vast-astronaut',
    label: 'VAST astronaut',
    source: 'ours',
    tint: '#C9AC8E',
    steps: [
      { id: 'va1', text: 'Put the round base plate down', expert_clip_id: 'ours-astro-1', expert_start_s: 0, expert_end_s: 3 },
      { id: 'va2', text: 'Put the legs on the base', expert_clip_id: 'ours-astro-1', expert_start_s: 3, expert_end_s: 7 },
      {
        id: 'va3',
        text: 'Put the torso on the legs',
        expert_clip_id: 'ours-astro-1',
        expert_start_s: 7,
        expert_end_s: 11,
        common_mistake: 'The torso goes on the legs before the head.',
      },
      { id: 'va4', text: 'Put the head and helmet on', expert_clip_id: 'ours-astro-1', expert_start_s: 11, expert_end_s: 15 },
      { id: 'va5', text: 'Put the staff in its hand', expert_clip_id: 'ours-astro-2', expert_start_s: 15, expert_end_s: 18 },
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
  { id: 'ours-caps-1', task: 'cap-swap', take: 1, score: 95, caption: 'Person sitting on the floor uncaps both bottles, swaps them and puts each cap on the other bottle.' },
  { id: 'ours-caps-2', task: 'cap-swap', take: 2, score: 87, caption: 'Person swaps the Mountain Dew and Coca-Cola and trades their caps, a little slower.' },
  { id: 'ours-caps-3', task: 'cap-swap', take: 3, score: 52, caption: 'Person swaps the bottles but puts each cap back on its own bottle.' },
  { id: 'ours-cups-1', task: 'cup-pyramid', take: 1, score: 93, caption: 'Person lines up three clear cups upside down, adds two and one on top, then nests them.' },
  { id: 'ours-cups-2', task: 'cup-pyramid', take: 2, score: 86, caption: 'Person builds a three-two-one cup pyramid on the floor and takes it down into one stack.' },
  { id: 'ours-cups-3', task: 'cup-pyramid', take: 3, score: 58, caption: 'Person starts the pyramid with only two cups on the bottom row.' },
  { id: 'ours-astro-1', task: 'vast-astronaut', take: 1, score: 94, caption: 'Person builds the white VAST astronaut on its round base and puts the staff in its hand.' },
  { id: 'ours-astro-2', task: 'vast-astronaut', take: 2, score: 85, caption: 'Person assembles legs, torso, helmeted head and staff on the base plate.' },
  { id: 'ours-astro-3', task: 'vast-astronaut', take: 3, score: 50, caption: 'Person puts the head straight on the legs and leaves the torso on the floor.' },
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
      camera_id: 'floor-cam1',
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
