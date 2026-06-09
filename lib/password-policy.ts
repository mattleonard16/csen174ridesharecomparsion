/**
 * Shared password policy — enforce wherever passwords are CREATED
 * (registration flows, account scripts), not at sign-in. Raising sign-in
 * validation would lock out existing users without improving what's stored.
 *
 * Length-based only, per NIST 800-63B: composition rules (mandatory symbols,
 * mixed case) are discouraged; length plus rate-limited sign-in is the defense.
 */

import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine(
    password => password.trim().length >= PASSWORD_MIN_LENGTH,
    'Password cannot be mostly whitespace'
  )

/** Bcrypt cost factor for new password hashes. */
export const BCRYPT_ROUNDS = 12
