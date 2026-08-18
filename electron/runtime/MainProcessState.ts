export type MainProcessState = 'healthy' | 'fatal-shutdown' | 'terminated'

let state: MainProcessState = 'healthy'

export function markMainProcessFatal() {
  if (state === 'healthy') state = 'fatal-shutdown'
}

export function markMainProcessTerminated() {
  state = 'terminated'
}

export function getMainProcessState(): MainProcessState {
  return state
}

export function isMainProcessOperational() {
  return state === 'healthy'
}
