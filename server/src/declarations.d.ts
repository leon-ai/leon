declare module '@ffprobe-installer/ffprobe' {
  export const path: string
}

declare module 'better-sqlite3' {
  export interface RunResult {
    changes?: number
    lastInsertRowid?: number | bigint
  }

  export interface Statement {
    run(...params: unknown[]): RunResult
    get(...params: unknown[]): Record<string, unknown> | undefined
    all(...params: unknown[]): Array<Record<string, unknown>>
  }

  export interface Database {
    transaction<T>(fn: () => T): () => T
    exec(sql: string): void
    prepare(sql: string): Statement
    close(): void
  }

  export interface DatabaseOptions {
    readonly?: boolean
    fileMustExist?: boolean
    timeout?: number
    verbose?: (...params: unknown[]) => void
  }

  interface DatabaseConstructor {
    new (filename: string, options?: DatabaseOptions): Database
  }

  const Database: DatabaseConstructor
  export default Database
}
