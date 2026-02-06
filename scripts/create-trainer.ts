import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'trainer@trainx.club';
  const password = 'trainer123';
  const name = 'Trainer';

  const hashedPassword = await bcrypt.hash(password, 12);

  const trainer = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name,
      password: hashedPassword,
      role: 'TRAINER',
    },
  });

  console.log('Trainer created:', trainer);
  console.log('\nLogin credentials:');
  console.log('Email:', email);
  console.log('Password:', password);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
