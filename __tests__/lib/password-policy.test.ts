import {
  passwordSchema,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  BCRYPT_ROUNDS,
} from '@/lib/password-policy'

describe('passwordSchema', () => {
  it('accepts a password at the minimum length', () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true)
  })

  it('accepts a long passphrase', () => {
    expect(passwordSchema.safeParse('correct horse battery staple').success).toBe(true)
  })

  it('rejects passwords below the minimum length', () => {
    const result = passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH - 1))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at least/)
    }
  })

  it('rejects passwords above the maximum length', () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false)
  })

  it('rejects whitespace-only passwords even when long enough', () => {
    expect(passwordSchema.safeParse(' '.repeat(PASSWORD_MIN_LENGTH + 4)).success).toBe(false)
  })

  it('rejects the empty string', () => {
    expect(passwordSchema.safeParse('').success).toBe(false)
  })

  it('exports a bcrypt cost factor of at least 12', () => {
    expect(BCRYPT_ROUNDS).toBeGreaterThanOrEqual(12)
  })
})
