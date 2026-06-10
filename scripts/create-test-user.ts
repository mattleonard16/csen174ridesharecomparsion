import { prisma } from '../lib/prisma'
import bcrypt from 'bcryptjs'
import { passwordSchema, BCRYPT_ROUNDS } from '../lib/password-policy'

async function createTestUser() {
  const email = process.argv[2] || 'mleonard1616@gmail.com'
  const password = process.argv[3] || 'testpassword123'
  const name = process.argv[4] || 'Matt Leonard'

  const policyCheck = passwordSchema.safeParse(password)
  if (!policyCheck.success) {
    console.error('❌ Password rejected:', policyCheck.error.issues[0]?.message)
    process.exit(1)
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS)

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
    })

    if (existing) {
      console.log('User already exists, updating password...')
      await prisma.user.update({
        where: { email },
        data: { password: hashedPassword },
      })
      console.log('✅ Password updated!')
    } else {
      const user = await prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
        },
      })
      console.log('✅ User created:', user.id)
    }

    console.log('\n📧 Email:', email)
    console.log('🔑 Password:', password)
    console.log('\nYou can now test sign-in with these credentials.')
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

createTestUser()
