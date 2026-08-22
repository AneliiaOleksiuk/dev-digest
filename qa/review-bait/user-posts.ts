/** Demo endpoint for the review-bait fixture — intentional N+1 query
 *  (Performance Reviewer bait, WARNING), do not copy into real code. */

interface Db {
  users: { findMany: () => Promise<{ id: string }[]> };
  posts: { findMany: (where: { userId: string }) => Promise<{ id: string; title: string }[]> };
}

export async function listUsersWithPosts(db: Db) {
  const users = await db.users.findMany();
  const result: unknown[] = [];
  // One query per user instead of a single batched IN (...) lookup.
  for (const user of users) {
    const posts = await db.posts.findMany({ userId: user.id });
    result.push({ ...user, posts });
  }
  return result;
}
