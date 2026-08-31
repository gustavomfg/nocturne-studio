export interface DatabaseTransactionRunner {
  run<T>(operation: string, callback: () => T): T
}
