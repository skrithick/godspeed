/** Safe to display as a link. This does not fetch or validate the destination. */
export function publicWebLink(value: string): string | undefined {
  if (value.length > 2048) return;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048) return url.href;
  } catch { /* Not an absolute web URL. */ }
}
