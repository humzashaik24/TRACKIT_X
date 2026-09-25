/**
 * Trackit X — PostgREST filter-string helpers.
 *
 * PostgREST's `or=(...)` grammar is a string, not a structured argument:
 * supabase-js interpolates whatever it is given straight into the URL. That makes
 * a search term a genuine injection point — a term containing a comma or a
 * parenthesis rewrites the filter and can widen a query rather than narrow it.
 *
 * Concretely, with a raw term:
 *
 *   .or(`email.ilike.%${term}%`)
 *
 * a term of `a%,id.not.is.null` produces a second disjunct the caller never
 * asked for. On a table whose RLS is correct that still returns only visible
 * rows, so the blast radius is a wrong result set rather than a data leak — but
 * a wrong result set in a payroll directory is its own serious problem, and the
 * same string built carelessly against a table without policies would be a leak.
 *
 * So the term is sanitised and double-quoted before it reaches the grammar.
 * Inside double quotes PostgREST treats commas, parentheses and dots as literal
 * characters, which is what makes the value a value again.
 *
 * Kept in `lib` rather than in a service because the rule belongs to the wire
 * format, not to any one table's queries, and because it is worth unit-testing
 * once rather than per call site.
 */

/**
 * Escapes a value for use inside a PostgREST double-quoted filter value.
 *
 * Only the two characters that are meaningful inside the quoting are escaped —
 * a backslash and a double quote. Everything else is left alone, because the
 * point of quoting is that Postgres stops interpreting it.
 */
function escapeQuotedValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * A quoted `ILIKE` pattern for a user-typed search term.
 *
 * Returns `null` for a term with nothing searchable in it, so callers can skip
 * the filter entirely rather than send `ilike."%%"`, which matches every row and
 * costs a full scan for the privilege.
 *
 * `%` and `_` from the user are NOT escaped, because in a search field they are
 * expected to work as wildcards — typing `a%` should mean "starts with a". The
 * characters that would change the QUERY are escaped; the ones that change the
 * PATTERN are left working.
 *
 * Note this is a `LIKE`-level escape, not a SQL-injection surface: the value
 * travels as a URL query parameter and PostgREST parses it, so the worst a
 * wildcard can do is match more rows than intended within the caller's own
 * organization.
 */
export function ilikePattern(term: string): string | null {
  // Control characters have no place in a search and some are illegal in a URL.
  // Stripped rather than rejected: a paste with a stray newline should search for
  // what the user meant, not fail.
  const cleaned = term.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (cleaned.length === 0) return null;
  return `"%${escapeQuotedValue(cleaned)}%"`;
}

/**
 * Builds the value part of an `or=(...)` filter across several columns.
 *
 * `ilike("pattern")` is emitted per column, all with the same pattern. Returns
 * `null` when there is no term, which callers read as "do not add a filter".
 *
 * @param term    what the user typed
 * @param columns the columns to match, already the exact PostgREST names
 */
export function anyColumnIlike(term: string, columns: readonly string[]): string | null {
  if (columns.length === 0) return null;
  const pattern = ilikePattern(term);
  if (pattern === null) return null;
  return columns.map((column) => `${column}.ilike.${pattern}`).join(',');
}
