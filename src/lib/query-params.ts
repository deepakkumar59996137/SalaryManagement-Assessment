export type ParamValue = string | number | undefined | null;

/**
 * Radix Select cannot use "" as an item value, so an "any" option needs a
 * sentinel. It is mapped back to absent before it reaches the URL.
 */
export const ANY_VALUE = '__any__';

/**
 * Build a query string from the current one plus a set of changes.
 *
 * Empty, null and sentinel values remove the parameter rather than writing a
 * blank one, so a cleared filter leaves a clean, shareable URL.
 *
 * Changing anything other than the page resets to page 1 — otherwise narrowing
 * a filter while on page 12 lands the HR Manager on an empty table.
 */
export function buildQuery(
  current: URLSearchParams | ReadonlyURLSearchParamsLike,
  updates: Record<string, ParamValue>,
): string {
  const next = new URLSearchParams(current.toString());

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null || value === '' || value === ANY_VALUE) {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }

  if (!('page' in updates)) next.delete('page');
  if (next.get('page') === '1') next.delete('page');

  const query = next.toString();
  return query ? `?${query}` : '';
}

/** Structural type so this module does not depend on next/navigation. */
interface ReadonlyURLSearchParamsLike {
  toString(): string;
}
