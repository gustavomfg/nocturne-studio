export interface InterruptedOperation {
  id: string
  workspace: string
  executionId: string | null
  kind: string
  sourceId: string
  originalStatus: string
  detectedAt: string
  message: string
}
