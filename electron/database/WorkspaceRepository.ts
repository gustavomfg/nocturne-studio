import path from 'node:path'
import type Database from 'better-sqlite3'
import type { WorkspaceModelBindingRepository } from './WorkspaceModelBindingRepository'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

export interface WorkspaceRow {
  path: string
  name: string
  favorite: boolean
  authorized: boolean
  createdAt: string
  lastOpenedAt: string
}

/** Owns the workspace history and the cross-table move operation. */
export class WorkspaceRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly modelBindings: WorkspaceModelBindingRepository,
    private readonly transactions: DatabaseTransactionRunner,
  ) {}

  list(): WorkspaceRow[] {
    const rows = this.database.prepare(`SELECT path, name, favorite, authorized,
      created_at createdAt, last_opened_at lastOpenedAt
      FROM workspaces ORDER BY favorite DESC, last_opened_at DESC`).all() as Array<
      Omit<WorkspaceRow, 'favorite' | 'authorized'> & { favorite: number; authorized: number }
    >
    return rows.map((row) => ({
      ...row,
      favorite: Boolean(row.favorite),
      authorized: Boolean(row.authorized),
    }))
  }

  touch(workspace: string) {
    const now = new Date().toISOString()
    this.database.prepare(`INSERT INTO workspaces(path,name,authorized,created_at,last_opened_at)
      VALUES(?,?,1,?,?)
      ON CONFLICT(path) DO UPDATE SET
        name=excluded.name,authorized=1,last_opened_at=excluded.last_opened_at`)
      .run(workspace, path.basename(workspace), now, now)
  }

  relocate(source: string, destination: string) {
    if (source === destination) {
      this.touch(destination)
      return
    }

    const modelBindings = this.modelBindings.get(source)
    this.transactions.run('workspaces.relocate', () => {
      const current = this.database.prepare(`SELECT path,name,favorite,authorized,
        created_at createdAt,last_opened_at lastOpenedAt
        FROM workspaces WHERE path=?`).get(source) as {
        path: string
        name: string
        favorite: number
        authorized: number
        createdAt: string
        lastOpenedAt: string
      } | undefined
      if (!current) throw new Error('Workspace original não encontrado no histórico local.')
      if (this.database.prepare('SELECT 1 FROM workspaces WHERE path=?').get(destination)) {
        throw new Error('A pasta selecionada já pertence a outro workspace salvo.')
      }

      const now = new Date().toISOString()
      this.database.prepare(`INSERT INTO workspaces(path,name,favorite,authorized,created_at,last_opened_at)
        VALUES(?,?,?,1,?,?)`).run(
        destination,
        path.basename(destination),
        current.favorite,
        current.createdAt,
        now,
      )
      this.database.prepare('UPDATE conversations SET workspace=? WHERE workspace=?').run(destination, source)
      this.database.prepare('UPDATE artifacts SET workspace=? WHERE workspace=?').run(destination, source)
      this.database.prepare('UPDATE workspace_memory SET workspace=? WHERE workspace=?').run(destination, source)
      this.database.prepare('UPDATE suggestions SET workspace_id=? WHERE workspace_id=?').run(destination, source)
      this.database.prepare('UPDATE brain_memories SET workspace_id=? WHERE workspace_id=?').run(destination, source)
      if (modelBindings) {
        this.modelBindings.set({ ...modelBindings, workspaceId: destination })
        this.modelBindings.delete(source)
      }
      this.database.prepare('DELETE FROM workspaces WHERE path=?').run(source)
    })
  }

  remove(workspace: string) {
    this.database.prepare('DELETE FROM workspaces WHERE path=?').run(workspace)
  }

  setFavorite(workspace: string, favorite: boolean) {
    this.database.prepare('UPDATE workspaces SET favorite=? WHERE path=?').run(favorite ? 1 : 0, workspace)
  }
}
