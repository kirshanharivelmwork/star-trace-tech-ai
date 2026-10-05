/**
 * A tiny typed fake of the Supabase JS query builder for route tests.
 *
 * Every `.from(table)…` chain and every `.rpc(name, args)` is recorded as a
 * `Call`. The test supplies a `resolve(call)` function that decides what the
 * "database" returns, so assertions can inspect exactly what a route wrote
 * (table, operation, payload, onConflict, filters).
 */

export type QueryError = { message: string; code?: string }

export type QueryResult = {
  data?: unknown
  error?: QueryError | null
  count?: number | null
}

export type Filter = { method: string; column: string; value: unknown }

export type Call = {
  /** Table name for `.from()`, function name for `.rpc()`. */
  table: string
  op: "select" | "insert" | "update" | "upsert" | "delete" | "rpc"
  payload?: unknown
  options?: Record<string, unknown>
  filters: Filter[]
  single: boolean
}

export type Resolver = (call: Call) => QueryResult | Promise<QueryResult>

type NormalizedResult = {
  data: unknown
  error: QueryError | null
  count: number | null
}

const normalize = (result: QueryResult): NormalizedResult => ({
  data: result.data ?? null,
  error: result.error ?? null,
  count: result.count ?? null,
})

class FakeQuery implements PromiseLike<NormalizedResult> {
  constructor(
    private readonly call: Call,
    private readonly resolve: Resolver,
    private readonly log: Call[]
  ) {}

  private setOp(op: Call["op"], payload: unknown, options?: Record<string, unknown>) {
    this.call.op = op
    this.call.payload = payload
    this.call.options = options
    return this
  }

  select(...args: [columns?: string, options?: Record<string, unknown>]) {
    // `.insert(...).select()` keeps the write op; only a bare select is a read.
    const options = args[1]
    if (options) this.call.options = { ...this.call.options, ...options }
    return this
  }
  insert(payload: unknown, options?: Record<string, unknown>) {
    return this.setOp("insert", payload, options)
  }
  update(payload: unknown, options?: Record<string, unknown>) {
    return this.setOp("update", payload, options)
  }
  upsert(payload: unknown, options?: Record<string, unknown>) {
    return this.setOp("upsert", payload, options)
  }
  delete() {
    return this.setOp("delete", undefined)
  }

  private filter(method: string, column: string, value: unknown) {
    this.call.filters.push({ method, column, value })
    return this
  }
  eq(column: string, value: unknown) {
    return this.filter("eq", column, value)
  }
  is(column: string, value: unknown) {
    return this.filter("is", column, value)
  }
  in(column: string, value: unknown) {
    return this.filter("in", column, value)
  }
  order() {
    return this
  }
  limit() {
    return this
  }
  maybeSingle() {
    this.call.single = true
    return this
  }
  single() {
    this.call.single = true
    return this
  }

  then<TResult1 = NormalizedResult, TResult2 = never>(
    onfulfilled?: ((value: NormalizedResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    this.log.push(this.call)
    return Promise.resolve(this.resolve(this.call))
      .then(normalize)
      .then(onfulfilled, onrejected)
  }
}

const newCall = (table: string, op: Call["op"]): Call => ({
  table,
  op,
  filters: [],
  single: false,
})

export type FakeSupabase = {
  from: (table: string) => FakeQuery
  rpc: (name: string, args?: Record<string, unknown>) => FakeQuery
  calls: Call[]
  /** Calls matching a table (or rpc name) and, optionally, an operation. */
  callsFor: (table: string, op?: Call["op"]) => Call[]
}

export const createFakeSupabase = (resolve: Resolver): FakeSupabase => {
  const calls: Call[] = []

  return {
    calls,
    from: (table) => new FakeQuery(newCall(table, "select"), resolve, calls),
    rpc: (name, args) => {
      const call = newCall(name, "rpc")
      call.payload = args
      return new FakeQuery(call, resolve, calls)
    },
    callsFor: (table, op) =>
      calls.filter((call) => call.table === table && (!op || call.op === op)),
  }
}

/** Value of the first `eq`/`is` filter on a column, if any. */
export const filterValue = (call: Call, column: string): unknown =>
  call.filters.find((filter) => filter.column === column)?.value
