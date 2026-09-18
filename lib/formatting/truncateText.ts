/** Preserva palavras completas; uma primeira palavra longa permanece inteira. */
export function truncateText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;

  const boundary = text.lastIndexOf(" ", maxLength);
  const end = boundary > 0 ? boundary : text.indexOf(" ", maxLength);
  if (end < 0) return text;
  return `${text.slice(0, end).trimEnd()}...`;
}
