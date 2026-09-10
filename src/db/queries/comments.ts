import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, users } from "@/db/schema";

export function commentsForContentQuery(
  workspaceId: string,
  contentId: string,
) {
  return db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(
      and(
        eq(comments.workspaceId, workspaceId),
        eq(comments.contentId, contentId),
      ),
    )
    .orderBy(asc(comments.createdAt))
    .limit(200);
}

export async function listComments(workspaceId: string, contentId: string) {
  return commentsForContentQuery(workspaceId, contentId);
}

export async function addComment(input: {
  workspaceId: string;
  contentId: string;
  authorId: string;
  body: string;
}) {
  // Returns just enough of the inserted row (id + createdAt) for the caller
  // to build the one new CommentView itself — the author is already known
  // (the caller's own session user), so there's no need to re-read the
  // users join listComments does just to learn a name/email we already have.
  const [row] = await db
    .insert(comments)
    .values(input)
    .returning({ id: comments.id, createdAt: comments.createdAt });
  return row;
}
