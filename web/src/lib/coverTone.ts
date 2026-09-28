/** Finite cover tone tokens — never treat API strings as Tailwind class names. */
export const COVER_TONES = {
  mist: { from: '#d8ebe3', via: '#eef6f1', to: '#f7f3ea' },
  slate: { from: '#e4e8f2', via: '#eef1f8', to: '#f6f4ef' },
  sage: { from: '#dde8e4', via: '#eaf2ef', to: '#f5f7f4' },
} as const

export type CoverToneId = keyof typeof COVER_TONES

const DEFAULT_TONE: CoverToneId = 'mist'

/** Legacy Tailwind fragments from early seed data → token ids. */
const LEGACY_CLASS_ALIASES: Record<string, CoverToneId> = {
  'from-[#d8ebe3] via-[#eef6f1] to-[#f7f3ea]': 'mist',
  'from-[#e4e8f2] via-[#eef1f8] to-[#f6f4ef]': 'slate',
  'from-[#dde8e4] via-[#eaf2ef] to-[#f5f7f4]': 'sage',
}

export function resolveCoverTone(tone: string): CoverToneId {
  if (tone in COVER_TONES) return tone as CoverToneId
  return LEGACY_CLASS_ALIASES[tone] ?? DEFAULT_TONE
}

export function coverToneStyle(tone: string): { backgroundImage: string } {
  const colors = COVER_TONES[resolveCoverTone(tone)]
  return {
    backgroundImage: `linear-gradient(to bottom right, ${colors.from}, ${colors.via}, ${colors.to})`,
  }
}
