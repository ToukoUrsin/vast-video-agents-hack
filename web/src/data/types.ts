// Shapes mirror what we will read out of VastDB. Field names stay snake_case on purpose
// so a VastDB row can be passed straight through.

export type ClipSource = 'stock' | 'ours'

/** Scene archetype, only used to draw procedural placeholder thumbnails. */
export type SceneKind =
  | 'warehouse'
  | 'highway'
  | 'dashcam'
  | 'street'
  | 'city'
  | 'indoor'
  | 'task-lego'
  | 'task-cups'
  | 'task-pour'

export interface Clip {
  clip_id: string
  camera_id: string
  /** Site id, see Site.id */
  location: string
  source: ClipSource
  /** e.g. /clips/<clip_id>.jpg. null = draw a procedural placeholder. */
  thumbnail_url: string | null
  /** Optional playable clip, e.g. /clips/<clip_id>.mp4 */
  video_url?: string | null
  /** Cosmos Reason description */
  caption: string
  /** Cosmos Embed vector projected to 2D (any range, normalised at layout time) */
  embedding2d: { x: number; y: number }
  /** null = noise / unclustered */
  cluster_id: string | null
  /** Takes only: quality score 0–100 */
  score?: number
  duration_s?: number
  /** Takes only: e.g. "Take 2" */
  take_label?: string
}

export interface Site {
  id: string
  name: string
  kind: SceneKind
  source: ClipSource
}

export interface Step {
  id: string
  text: string
  /** Best take that shows this step */
  expert_clip_id: string
  expert_start_s: number
  expert_end_s: number
  /** Spoken/visible correction used by the mock checker */
  common_mistake?: string
}

export interface Cluster {
  id: string
  label: string
  source: ClipSource
  /** Muted tint for the label dot, hex */
  tint: string
  steps: Step[]
}

export type StageId = 'segment' | 'detect' | 'describe' | 'embed' | 'store'

export interface IngestStage {
  id: StageId
  label: string
  model?: string
  total: number
  unit: string
}

export interface IngestRun {
  /** Wall-clock time of the real run this screen replays, e.g. "15:42" */
  started_at: string
  /** How long the replay animation takes, seconds */
  replay_s: number
  stages: IngestStage[]
}

export interface LibraryData {
  sites: Site[]
  clips: Clip[]
  clusters: Cluster[]
  ingest: IngestRun
}
