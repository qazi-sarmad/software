/**
 * A record id is a database id only when it is a UUID. The development demo seed uses readable ids
 * (e.g. `u-gbm`), which are not database ids: passing one to a uuid column is a Postgres error, not
 * an empty result. Callers use this to skip a read that cannot apply rather than surface a failure.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}
