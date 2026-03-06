interface ProspectRef {
  id: string;
  local: string;
  contacto: string;
}

export interface MatchResult {
  id: string;
  local: string;
  score: number;
}

export function findBestProspectMatch(
  queryStr: string,
  prospects: ProspectRef[],
): MatchResult | null {
  const normalized = normalize(queryStr);
  if (!normalized) return null;

  let best: MatchResult | null = null;

  for (const p of prospects) {
    const scoreLocal = similarity(normalized, normalize(p.local));
    const scoreContacto = similarity(normalized, normalize(p.contacto));
    const maxScore = Math.max(scoreLocal, scoreContacto);

    if (maxScore > 0.4 && (!best || maxScore > best.score)) {
      best = { id: p.id, local: p.local, score: maxScore };
    }
  }

  return best;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function similarity(a: string, b: string): number {
  const ta = new Set(trigrams(a));
  const tb = new Set(trigrams(b));
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function trigrams(s: string): string[] {
  const padded = `  ${s} `;
  const result: string[] = [];
  for (let i = 0; i < padded.length - 2; i++) {
    result.push(padded.substring(i, i + 3));
  }
  return result;
}
