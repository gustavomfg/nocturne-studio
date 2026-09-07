export const updateErrorStages = ['check', 'metadata', 'download', 'validation', 'install'] as const
export type UpdateErrorStage = typeof updateErrorStages[number]

export const updatePlatforms = ['windows', 'macos', 'linux', 'other'] as const
export type UpdatePlatform = typeof updatePlatforms[number]

export type UpdateCheckTrigger = 'automatic' | 'manual'

export interface UpdateStateBase {
  currentVersion: string
  platform: UpdatePlatform
}

export type UpdateState =
  | (UpdateStateBase & { status: 'idle'; lastCheckedAt: string | null })
  | (UpdateStateBase & { status: 'checking'; trigger: UpdateCheckTrigger })
  | (UpdateStateBase & { status: 'up-to-date'; lastCheckedAt: string })
  | (UpdateStateBase & {
    status: 'available'
    version: string
    releaseNotes: string
    releaseDate: string | null
    discoveredBy: UpdateCheckTrigger
  })
  | (UpdateStateBase & {
    status: 'downloading'
    version: string
    percent: number
    transferred: number | null
    total: number | null
    bytesPerSecond: number | null
  })
  | (UpdateStateBase & {
    status: 'ready'
    version: string
    releaseNotes: string
    releaseDate: string | null
  })
  | (UpdateStateBase & { status: 'unsupported'; reason: string })
  | (UpdateStateBase & {
    status: 'error'
    stage: UpdateErrorStage
    message: string
    recoverable: boolean
    version: string | null
  })

export type UpdateStateListener = (state: UpdateState) => void
