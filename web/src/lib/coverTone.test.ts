import { describe, expect, it } from 'vitest'
import { COVER_TONES, coverToneStyle, resolveCoverTone } from './coverTone'

describe('resolveCoverTone', () => {
  it('resolves known tokens', () => {
    // Arrange
    const known = ['mist', 'slate', 'sage'] as const

    // Act
    const resolved = known.map((tone) => resolveCoverTone(tone))

    // Assert
    expect(resolved).toEqual(['mist', 'slate', 'sage'])
  })

  it('maps legacy class aliases to tokens', () => {
    // Arrange
    const cases = [
      ['from-[#d8ebe3] via-[#eef6f1] to-[#f7f3ea]', 'mist'],
      ['from-[#e4e8f2] via-[#eef1f8] to-[#f6f4ef]', 'slate'],
      ['from-[#dde8e4] via-[#eaf2ef] to-[#f5f7f4]', 'sage'],
    ] as const

    // Act
    const resolved = cases.map(([legacy]) => resolveCoverTone(legacy))

    // Assert
    expect(resolved).toEqual(cases.map(([, token]) => token))
  })

  it('falls back to mist for unknown tones', () => {
    // Arrange
    const unknown = 'from-red-500 via-orange-400 to-yellow-300'

    // Act
    const resolved = resolveCoverTone(unknown)

    // Assert
    expect(resolved).toBe('mist')
  })
})

describe('coverToneStyle', () => {
  it('returns a linear-gradient inline style object', () => {
    // Arrange
    const tone = 'slate'
    const colors = COVER_TONES.slate

    // Act
    const style = coverToneStyle(tone)

    // Assert
    expect(style).toEqual({
      backgroundImage: `linear-gradient(to bottom right, ${colors.from}, ${colors.via}, ${colors.to})`,
    })
    expect(style).not.toHaveProperty('className')
  })
})
