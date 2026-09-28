export function normalizeMultiline(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

/** First index of each exact option, in original order. */
export function uniqueOptionIndexes(options: string[]): number[] {
  const seen = new Set<string>();
  const indexes: number[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (seen.has(option)) continue;
    seen.add(option);
    indexes.push(index);
  }
  return indexes;
}

/** The one distinct option when every result collapsed to it. */
export function soleOption(options: string[]): string | undefined {
  const indexes = uniqueOptionIndexes(options);
  if (indexes.length !== 1) return undefined;
  const only = options[indexes[0]];
  if (only.length === 0) return undefined;
  return only;
}
