const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();
(async () => {
  const out = { at: new Date().toISOString(), users: await prisma.user.findMany(), fitnessData: await prisma.fitnessData.findMany() };
  fs.writeFileSync(process.argv[2], JSON.stringify(out));
  console.log('бэкап:', Math.round(fs.statSync(process.argv[2]).size/1024), 'КБ');
  await prisma.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1);});
