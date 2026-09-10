import type Database from 'better-sqlite3'
import type { InterruptedOperation } from '../../shared/operationRecovery'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

/** Startup classification only: no filesystem access, process restart, or inferred success. */
export class OperationRecoveryRepository {
  constructor(private readonly database: Database.Database, private readonly transactions: DatabaseTransactionRunner) {}

  reconcile() {
    this.transactions.run('operations.reconcile', () => {
      const now = new Date().toISOString()
      const message = 'Operação interrompida; o estado precisa ser reconciliado. Nenhum trabalho foi retomado automaticamente.'
      const sources = [
        ['executions', 'execution', "status IN ('created','planning','running','validating','awaiting-review')", 'id', 'finished_at'],
        ['checkpoints', 'checkpoint', "status='capturing'", 'execution_id', null],
        ['validation_runs', 'validation', "status IN ('queued','running')", 'execution_id', 'completed_at'],
        ['project_index_runs', 'project-index', "status IN ('queued','running')", 'NULL', 'completed_at'],
        ['semantic_index_runs', 'semantic-index', "status IN ('queued','running')", 'NULL', 'completed_at'],
      ] as const
      for (const [table, kind, predicate, execution, finished] of sources) {
        this.database.prepare(`INSERT OR IGNORE INTO interrupted_operations(id,workspace,execution_id,kind,source_id,original_status,detected_at,message)
          SELECT ? || ':' || id,workspace,${execution},?,id,status,?,? FROM ${table} WHERE ${predicate}`).run(kind, kind, now, message)
        this.database.prepare(`UPDATE ${table} SET status='failed',error=?${finished ? `,${finished}=?` : ''} WHERE ${predicate}`).run(...(finished ? [message, now] : [message]))
      }
      this.database.prepare(`INSERT OR IGNORE INTO interrupted_operations(id,workspace,execution_id,kind,source_id,original_status,detected_at,message)
        SELECT 'decision:' || o.id,e.workspace,o.execution_id,'decision',o.id,o.status,?,?
        FROM change_decision_operations o JOIN executions e ON e.id=o.execution_id WHERE o.status='running'`).run(now, message)
      this.database.exec(`UPDATE changes SET status='conflicted' WHERE id IN (SELECT change_id FROM change_decision_operations WHERE status='running');
        UPDATE change_sets SET status='conflicted' WHERE id IN (SELECT change_set_id FROM changes WHERE id IN (SELECT change_id FROM change_decision_operations WHERE status='running'));
        UPDATE executions SET decision='conflicted' WHERE id IN (SELECT execution_id FROM change_decision_operations WHERE status='running');`)
      this.database.prepare("UPDATE change_decision_operations SET status='interrupted',finished_at=?,error=? WHERE status='running'").run(now, message)
      this.database.prepare(`INSERT OR IGNORE INTO interrupted_operations(id,workspace,execution_id,kind,source_id,original_status,detected_at,message)
        SELECT 'command:' || c.id,e.workspace,c.execution_id,'command',c.id,c.status,?,?
        FROM execution_commands c JOIN executions e ON e.id=c.execution_id WHERE c.status='running'`).run(now, message)
      this.database.prepare(`UPDATE execution_commands SET status='failed',finished_at=?,output_summary=? WHERE status='running'`).run(now, message)
      this.database.exec("UPDATE semantic_units SET status='stale' WHERE status='processing'")
      this.database.prepare(`INSERT OR IGNORE INTO interrupted_operations(id,workspace,execution_id,kind,source_id,original_status,detected_at,message)
        SELECT 'awaiting-decision:' || c.id,e.workspace,c.execution_id,'awaiting-decision',c.id,c.status,?,?
        FROM change_sets c JOIN executions e ON e.id=c.execution_id WHERE c.status IN ('pending','partially-accepted','conflicted')`).run(now, 'Decisão pendente recuperada; revise os arquivos atuais antes de decidir. Nenhuma decisão foi aplicada automaticamente.')
    })
  }

  list(): InterruptedOperation[] {
    return this.database.prepare(`SELECT id,workspace,execution_id executionId,kind,source_id sourceId,original_status originalStatus,
      detected_at detectedAt,message FROM interrupted_operations ORDER BY detected_at DESC,id LIMIT 200`).all() as InterruptedOperation[]
  }

  pendingDecisions(): Array<{ executionId: string; workspace: string }> {
    return this.database.prepare("SELECT DISTINCT c.execution_id executionId,e.workspace FROM change_sets c JOIN executions e ON e.id=c.execution_id WHERE c.status IN ('pending','partially-accepted','conflicted')").all() as Array<{ executionId: string; workspace: string }>
  }
}
