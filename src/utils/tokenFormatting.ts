export function formatTokenCount(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;

  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  if (safeValue >= 1_000) {
    return `${(safeValue / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }

  return safeValue.toString();
}

export function formatExactTokenCount(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return safeValue.toLocaleString('fr-FR');
}
