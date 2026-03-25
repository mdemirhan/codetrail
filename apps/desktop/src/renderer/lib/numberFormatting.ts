const INTEGER_FORMATTER = new Intl.NumberFormat();
const COMPACT_INTEGER_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatInteger(value: number): string {
  return INTEGER_FORMATTER.format(value);
}

export function formatCompactInteger(value: number): string {
  if (Math.abs(value) < 1_000) {
    return formatInteger(value);
  }
  return COMPACT_INTEGER_FORMATTER.format(value);
}
