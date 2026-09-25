/**
 * PostgREST filter-string construction.
 *
 * The rules under test are the security-relevant ones. `or=(...)` is a grammar that
 * supabase-js assembles by string interpolation, so a search term is a filter
 * injection point — and a test that only checked "the happy path produces something
 * with the term in it" would pass while the quoting was absent.
 */
import { anyColumnIlike, ilikePattern } from '@/lib/postgrestFilters';

describe('ilikePattern', () => {
  it('returns null when there is nothing to search for', () => {
    expect(ilikePattern('')).toBeNull();
    expect(ilikePattern('   ')).toBeNull();
    expect(ilikePattern('\n\t ')).toBeNull();
  });

  it('wraps the term in percent wildcards inside a quoted value', () => {
    expect(ilikePattern('ramesh')).toBe('"%ramesh%"');
  });

  it('strips control characters rather than rejecting the term', () => {
    // A paste with a stray newline should search for what the user meant. Refusing
    // the whole term would make a search box fail on a clipboard artefact.
    expect(ilikePattern('ra\nme\u0007sh')).toBe('"%ramesh%"');
  });

  it('quotes the value so a comma cannot open a new disjunct', () => {
    // Without the quotes this becomes two clauses, and the second is a filter the
    // caller never asked for.
    const pattern = ilikePattern('a%,id.not.is.null');
    expect(pattern).toBe('"%a%,id.not.is.null%"');
    expect(pattern?.includes(',"')).toBe(false);
  });

  it('quotes the value so a parenthesis cannot close the filter early', () => {
    expect(ilikePattern('x),or(id.not.is.null')).toBe('"%x),or(id.not.is.null%"');
  });

  it('quotes the value so a dot is a literal character, not a column separator', () => {
    expect(ilikePattern('a.or.b')).toBe('"%a.or.b%"');
  });

  it('escapes a double quote so it cannot terminate the value', () => {
    expect(ilikePattern('say "hi"')).toBe('"%say \\"hi\\"%"');
  });

  it('escapes a backslash before the quote it would otherwise escape', () => {
    // Order matters: escaping backslashes first is what makes this a literal
    // backslash rather than an escaped character.
    expect(ilikePattern('a\\b')).toBe('"%a\\\\b%"');
  });

  it('leaves the LIKE wildcards working, because a search field expects them to', () => {
    // `%` is the user's own pattern, not part of the query grammar. Escaping it
    // would make "a%" match nothing, which surprises people.
    expect(ilikePattern('a%')).toBe('"%a%%"');
    expect(ilikePattern('a_b')).toBe('"%a_b%"');
  });

  it('preserves a term that is only wildcards', () => {
    // It matches everything, which is a legitimate thing for a user to type, and
    // `%%` is cheaper than the same effect achieved some other way.
    expect(ilikePattern('%%')).toBe('"%%%%"');
  });
});

describe('anyColumnIlike', () => {
  it('builds one disjunct per column with the same pattern', () => {
    expect(anyColumnIlike('a', ['first_name', 'last_name'])).toBe(
      'first_name.ilike."%a%",last_name.ilike."%a%"',
    );
  });

  it('returns null with no columns, so no filter is added at all', () => {
    // Emitting `or=()` would be a malformed filter, not a permissive one.
    expect(anyColumnIlike('a', [])).toBeNull();
  });

  it('returns null for an empty term rather than matching every row', () => {
    expect(anyColumnIlike('', ['name'])).toBeNull();
    expect(anyColumnIlike('   ', ['name'])).toBeNull();
  });

  it('quotes the pattern in every column, not just the first', () => {
    const filter = anyColumnIlike('x,y', ['a', 'b', 'c']);
    expect(filter).toBe('a.ilike."%x,y%",b.ilike."%x,y%",c.ilike."%x,y%"');
  });
});
