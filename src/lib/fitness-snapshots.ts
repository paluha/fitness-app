import { prisma } from './prisma';

// Keep this many snapshots per user. Older ones get pruned on every write.
export const MAX_SNAPSHOTS_PER_USER = 50;

// Create a rolling backup of a user's FitnessData after every successful save.
// Non-fatal: logged and swallowed on error so a snapshot failure never breaks
// the main save path.
export async function createSnapshotForUser(userId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await prisma.fitnessSnapshot.create({ data: { userId, data: data as object } });
    // Trim old snapshots beyond the retention count
    const extras = await prisma.fitnessSnapshot.findMany({
      where: { userId },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      skip: MAX_SNAPSHOTS_PER_USER,
    });
    if (extras.length > 0) {
      await prisma.fitnessSnapshot.deleteMany({
        where: { id: { in: extras.map(x => x.id) } },
      });
    }
  } catch (e) {
    console.error('[snapshot create failed]', e);
  }
}
