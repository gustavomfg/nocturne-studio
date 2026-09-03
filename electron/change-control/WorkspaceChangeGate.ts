import path from 'node:path'
import type { WorkspaceChangeEvent } from '../../shared/types'

/** Holds filesystem notifications while a ChangeSet is awaiting a decision. */
export class WorkspaceChangeGate {
  private readonly heldWorkspaces = new Set<string>()
  private readonly pending = new Map<string, WorkspaceChangeEvent>()

  constructor(private readonly onReleased: (event: WorkspaceChangeEvent) => void) {}

  begin(workspace: string) {
    this.heldWorkspaces.add(path.resolve(workspace))
  }

  isHeld(workspace: string) {
    return this.heldWorkspaces.has(path.resolve(workspace))
  }

  enqueue(event: WorkspaceChangeEvent) {
    const workspace = path.resolve(event.workspace)
    if (!this.heldWorkspaces.has(workspace)) {
      this.onReleased(event)
      return false
    }
    const previous = this.pending.get(workspace)
    this.pending.set(workspace, {
      ...event,
      workspace,
      paths: [...new Set([...(previous?.paths ?? []), ...event.paths])].slice(0, 2_000),
      overflow: Boolean(previous?.overflow || event.overflow),
    })
    return true
  }

  release(workspace: string) {
    const normalized = path.resolve(workspace)
    this.heldWorkspaces.delete(normalized)
    const event = this.pending.get(normalized)
    this.pending.delete(normalized)
    if (event) this.onReleased(event)
  }

  clear() {
    this.heldWorkspaces.clear()
    this.pending.clear()
  }
}
