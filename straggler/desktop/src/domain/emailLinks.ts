/** One mailbox only. Strip headers before handing a link to the OS. */
export function emailLink(
  value: string,
): { href: string; address: string; stripped: boolean } | null {
  if (/[\p{Cc}]|%0[ad]/iu.test(value)) return null;
  const input = value.trim();
  const mailto = /^mailto:/i.test(input);
  const target = mailto ? input.slice(7) : input;
  const rawAddress = mailto ? target.split(/[?#]/, 1)[0] : target;
  let address: string;
  try {
    address = mailto ? decodeURIComponent(rawAddress) : rawAddress;
  } catch {
    return null;
  }
  const parts = address.split('@');
  if (parts.length !== 2 || /[\p{Cc}]|%0[ad]/iu.test(address)) return null;
  const [local, domain] = parts;
  if (
    !local ||
    local.length > 64 ||
    address.length > 254 ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  )
    return null;
  // Encode URI delimiters allowed inside a mailbox local part.
  const encoded = address.replace(
    /[%?#/]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return { href: `mailto:${encoded}`, address, stripped: mailto && rawAddress !== target };
}
