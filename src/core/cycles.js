export function suggestOverride(runInfo) {
  return runInfo.reads
    .map((r) => `${r.isIndex ? 'I' : 'Y'}${r.cycles}`)
    .join(';');
}

const SEGMENT = /^[YIN](\d+)([YIN]\d+)*$/;

export function validateOverride(s) {
  const trimmed = (s ?? '').trim();
  if (!trimmed) return { ok: true, value: '' };
  const segments = trimmed.split(';');
  for (const seg of segments) {
    if (!SEGMENT.test(seg)) {
      return {
        ok: false,
        hint: `Bad segment "${seg}". Format: Y<n>/I<n>/N<n> joined; e.g. Y151;I8N2;I8N2;Y151`,
      };
    }
  }
  return { ok: true, value: trimmed };
}

export function totalIndexCycles(override) {
  const segments = override.split(';');
  return segments.map((seg) => {
    const parts = seg.match(/[YIN]\d+/g) ?? [];
    let total = 0;
    let isIndex = false;
    for (const p of parts) {
      if (p[0] === 'I') isIndex = true;
      total += Number(p.slice(1));
    }
    return { isIndex, cycles: total };
  });
}
