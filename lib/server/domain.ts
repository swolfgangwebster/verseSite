import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  getDailyVerse,
  getPassage,
  getSiteDate,
  parseReference,
} from "../bible";
import type {
  Comment,
  FriendsResult,
  ModerationStatus,
  Notification,
  Page,
  PublicProfile,
  ReactionKind,
  Reflection,
  RelationshipUser,
  User,
  Visibility,
} from "../types";
import { Database, insertPassage, type Row } from "./db";
import { getEnv } from "./env";
import { moderateText, normalizeText } from "./moderation";

export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const reflectionSchema = z
  .object({
    reference: z.string().trim().min(1).max(100),
    title: z.string().trim().max(120),
    body: z
      .string()
      .trim()
      .min(1, "Write a few words before saving.")
      .max(10000),
    visibility: z.enum(["PRIVATE", "FRIENDS", "PUBLIC"]),
    commentsEnabled: z.boolean(),
    reactionsEnabled: z.boolean(),
  })
  .strict();
const commentSchema = z
  .object({ body: z.string().trim().min(1).max(2000) })
  .strict();
export const reactionSchema = z
  .object({
    kind: z.enum(["Amen", "Thoughtful", "Encouraging", "Helpful"]).nullable(),
  })
  .strict();
export const friendshipSchema = z
  .object({
    userId: z.string().min(1).max(100),
    action: z.enum([
      "request",
      "accept",
      "decline",
      "cancel",
      "remove",
      "block",
      "unblock",
    ]),
  })
  .strict();
export const reportSchema = z
  .object({
    reflectionId: z.string().max(100).optional(),
    commentId: z.string().max(100).optional(),
    reason: z.enum([
      "harassment",
      "hate",
      "spam",
      "sexual",
      "threat",
      "context",
      "other",
    ]),
    details: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine(
    (value) => Boolean(value.reflectionId) !== Boolean(value.commentId),
    "Select one item to report.",
  );
const settingsSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9_]{3,24}$/,
        "Use 3–24 lowercase letters, numbers, or underscores.",
      )
      .optional(),
    displayName: z.string().trim().min(2).max(60).optional(),
    bio: z.string().trim().max(300).optional(),
    defaultVisibility: z.enum(["PRIVATE", "FRIENDS", "PUBLIC"]).optional(),
    defaultComments: z.boolean().optional(),
    defaultReactions: z.boolean().optional(),
    theme: z.enum(["light", "dark", "system"]).optional(),
    notifyFriends: z.boolean().optional(),
    notifyComments: z.boolean().optional(),
    notifyReactions: z.boolean().optional(),
  })
  .strict();
const moderationSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.enum(["reflection", "comment"]),
    action: z.enum(["approve", "hide", "dismiss"]),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();
const now = () => new Date().toISOString();
const pair = (first: string, second: string) => [first, second].sort();
const pageNumber = (value: string | null | undefined) =>
  Math.max(1, Math.min(100000, Number.parseInt(value || "1", 10) || 1));
const boolean = (value: unknown) => value === 1 || value === true;

export interface AuthService {
  currentUser(token: string | undefined): User | null;
  signIn(userId: string): { token: string; user: User };
  signOut(token: string | undefined): void;
}
export interface UserRepository {
  user(id: string): User | null;
  profile(
    username: string,
    viewer: User | null,
    params?: URLSearchParams,
  ): {
    profile: PublicProfile;
    relationship: RelationshipUser["relationship"];
    reflections: Page<Reflection>;
  };
}
export interface ReflectionRepository {
  listReflections(
    viewer: User | null,
    params: URLSearchParams,
  ): Page<Reflection>;
  getReflection(id: string, viewer: User | null): Reflection;
  createReflection(
    user: User,
    input: unknown,
  ): { reflection: Reflection; message: string };
}
export interface RelationshipRepository {
  friends(user: User): FriendsResult;
  relationship(
    user: User | null,
    targetId: string,
  ): RelationshipUser["relationship"];
}
export interface InteractionRepository {
  listComments(id: string, viewer: User | null, page?: number): Page<Comment>;
  react(user: User, id: string, input: unknown): Reflection;
}
export interface ReportRepository {
  report(user: User, input: unknown): void;
}
export interface NotificationRepository {
  notifications(user: User): Notification[];
}
export interface ModerationRepository {
  moderationQueue(
    user: User,
    page?: number,
  ): { items: Record<string, unknown>[]; page: number; hasMore: boolean };
  moderate(user: User, input: unknown): void;
}
export interface DailyVerseRepository {
  daily(date?: string): ReturnType<typeof getDailyVerse>;
}

export function publicProfile(user: User): PublicProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatar: user.avatar,
    createdAt: user.createdAt,
  };
}

export function isBlocked(
  db: Database,
  first: string | undefined,
  second: string,
) {
  return Boolean(
    first &&
    db.one(
      "SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)",
      first,
      second,
      second,
      first,
    ),
  );
}

/** The single authority: moderator privileges apply only through the separately audited moderation service. */
export function canViewReflection(
  db: Database,
  viewer: Pick<User, "id"> | null,
  reflection: {
    authorId: string;
    visibility: Visibility;
    moderationStatus: ModerationStatus;
    deletedAt?: string | null;
  },
) {
  if (reflection.deletedAt || isBlocked(db, viewer?.id, reflection.authorId))
    return false;
  if (viewer?.id === reflection.authorId) return true;
  if (reflection.moderationStatus !== "APPROVED") return false;
  if (reflection.visibility === "PUBLIC") return true;
  if (reflection.visibility === "PRIVATE" || !viewer) return false;
  const [low, high] = pair(viewer.id, reflection.authorId);
  return Boolean(
    db.one(
      "SELECT 1 FROM friendships WHERE user_low=? AND user_high=? AND status='ACCEPTED'",
      low,
      high,
    ),
  );
}

/** SQL equivalent provides correct pagination before the final centralized policy check. All values remain bound parameters. */
function visibilitySql(viewer: User | null) {
  if (!viewer)
    return {
      sql: "r.deleted_at IS NULL AND r.moderation_status='APPROVED' AND r.visibility='PUBLIC'",
      params: [] as string[],
    };
  return {
    sql: `r.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=r.author_id) OR (b.blocked_id=? AND b.blocker_id=r.author_id)) AND (r.author_id=? OR (r.moderation_status='APPROVED' AND (r.visibility='PUBLIC' OR (r.visibility='FRIENDS' AND EXISTS(SELECT 1 FROM friendships f WHERE f.status='ACCEPTED' AND ((f.user_low=? AND f.user_high=r.author_id) OR (f.user_high=? AND f.user_low=r.author_id)))))))`,
    params: [viewer.id, viewer.id, viewer.id, viewer.id, viewer.id],
  };
}

export class CommunityService
  implements
    AuthService,
    UserRepository,
    ReflectionRepository,
    RelationshipRepository,
    InteractionRepository,
    ReportRepository,
    NotificationRepository,
    ModerationRepository,
    DailyVerseRepository
{
  constructor(public db: Database) {}
  user(id: string): User | null {
    const row = this.db.one(
      "SELECT u.*,p.display_name,p.bio,p.avatar FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=?",
      id,
    );
    if (!row) return null;
    return {
      id: String(row.id),
      username: String(row.username),
      displayName: String(row.display_name),
      bio: String(row.bio),
      avatar: row.avatar as string | null,
      role: row.role as User["role"],
      createdAt: String(row.created_at),
      defaultVisibility: row.default_visibility as Visibility,
      defaultComments: boolean(row.default_comments),
      defaultReactions: boolean(row.default_reactions),
      theme: row.theme as User["theme"],
      notifyFriends: boolean(row.notify_friends),
      notifyComments: boolean(row.notify_comments),
      notifyReactions: boolean(row.notify_reactions),
    };
  }
  currentUser(token: string | undefined) {
    if (!getEnv().developmentAuth) return null;
    if (!token || token.length !== 64) return null;
    const row = this.db.one(
      "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
      createHash("sha256").update(token).digest("hex"),
      now(),
    );
    return row ? this.user(String(row.user_id)) : null;
  }
  signIn(userId: string) {
    if (!getEnv().developmentAuth)
      throw new DomainError(
        403,
        "Development sign-in is disabled. Configure an authentication provider.",
      );
    const user = this.user(userId);
    if (!user)
      throw new DomainError(404, "This development account does not exist.");
    const token = randomBytes(32).toString("hex");
    this.db.run("DELETE FROM sessions WHERE expires_at<=?", now());
    this.db.run(
      "INSERT INTO sessions VALUES(?,?,?,?)",
      createHash("sha256").update(token).digest("hex"),
      userId,
      new Date(Date.now() + 7 * 86400000).toISOString(),
      now(),
    );
    return { token, user };
  }
  signOut(token: string | undefined) {
    if (token)
      this.db.run(
        "DELETE FROM sessions WHERE token_hash=?",
        createHash("sha256").update(token).digest("hex"),
      );
  }
  developmentUsers() {
    return getEnv().developmentAuth
      ? this.db
          .all("SELECT id FROM users ORDER BY created_at,id")
          .map((row) => publicProfile(this.user(String(row.id))!))
      : [];
  }
  daily(date?: string) {
    const timezone = getEnv().SITE_TIMEZONE;
    const siteDate = date || getSiteDate(new Date(), timezone);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(siteDate) ||
      !Number.isFinite(Date.parse(`${siteDate}T12:00:00Z`)) ||
      new Date(`${siteDate}T12:00:00Z`).toISOString().slice(0, 10) !== siteDate
    )
      throw new DomainError(400, "Choose a valid date.");
    const curated = this.db
      .all("SELECT date,reference FROM daily_verses WHERE date=?", siteDate)
      .map((row) => ({
        date: String(row.date),
        reference: String(row.reference),
      }));
    // Midday UTC is stable for the explicitly requested calendar date regardless of site timezone.
    if (date)
      return {
        ...getDailyVerse(new Date(`${siteDate}T12:00:00Z`), "UTC", curated),
        date: siteDate,
      };
    return getDailyVerse(new Date(), timezone, curated);
  }
  dailyHistory() {
    return this.db.all(
      "SELECT date,reference FROM daily_verses WHERE date<=? ORDER BY date DESC LIMIT 30",
      getSiteDate(new Date(), getEnv().SITE_TIMEZONE),
    );
  }
  rawReflection(id: string) {
    return this.db.one(
      "SELECT r.*,p.reference,p.book_id,p.target_json FROM reflections r JOIN reflection_passages p ON p.reflection_id=r.id AND p.position=0 WHERE r.id=?",
      id,
    );
  }
  permitted(row: Row | undefined, viewer: User | null) {
    return Boolean(
      row &&
      canViewReflection(this.db, viewer, {
        authorId: String(row.author_id),
        visibility: row.visibility as Visibility,
        moderationStatus: row.moderation_status as ModerationStatus,
        deletedAt: row.deleted_at as string | null,
      }),
    );
  }
  requireReflection(id: string, viewer: User | null) {
    const row = this.rawReflection(id);
    if (!this.permitted(row, viewer))
      throw new DomainError(404, "This reflection is unavailable.");
    return row!;
  }
  serializeReflection(row: Row, viewer: User | null): Reflection {
    if (!this.permitted(row, viewer))
      throw new DomainError(404, "This reflection is unavailable.");
    const reactions = { Amen: 0, Thoughtful: 0, Encouraging: 0, Helpful: 0 };
    if (boolean(row.reactions_enabled)) {
      const entries = this.db.all(
        "SELECT user_id,kind FROM reactions WHERE reflection_id=?",
        row.id,
      );
      for (const entry of entries)
        if (!isBlocked(this.db, viewer?.id, String(entry.user_id)))
          reactions[entry.kind as ReactionKind]++;
    }
    const comments = boolean(row.comments_enabled)
      ? this.db
          .all(
            "SELECT author_id FROM comments WHERE reflection_id=? AND deleted_at IS NULL AND moderation_status='APPROVED'",
            row.id,
          )
          .filter(
            (comment) =>
              !isBlocked(this.db, viewer?.id, String(comment.author_id)),
          ).length
      : 0;
    const mine =
      viewer && boolean(row.reactions_enabled)
        ? this.db.one(
            "SELECT kind FROM reactions WHERE reflection_id=? AND user_id=?",
            row.id,
            viewer.id,
          )
        : null;
    return {
      id: String(row.id),
      authorId: String(row.author_id),
      author: publicProfile(this.user(String(row.author_id))!),
      title: String(row.title),
      body: String(row.body),
      reference: String(row.reference),
      bookId: String(row.book_id),
      target: JSON.parse(String(row.target_json)),
      visibility: row.visibility as Visibility,
      commentsEnabled: boolean(row.comments_enabled),
      reactionsEnabled: boolean(row.reactions_enabled),
      moderationStatus: row.moderation_status as ModerationStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      edited: row.created_at !== row.updated_at,
      commentCount: comments,
      reactions,
      myReaction: (mine?.kind as ReactionKind) || null,
    };
  }
  getReflection(id: string, viewer: User | null) {
    return this.serializeReflection(this.requireReflection(id, viewer), viewer);
  }
  listReflections(
    viewer: User | null,
    params: URLSearchParams,
  ): Page<Reflection> {
    const scope = params.get("scope") || "public";
    if (!["public", "friends", "mine", "profile"].includes(scope))
      throw new DomainError(400, "Choose a valid reflection feed.");
    if ((scope === "mine" || scope === "friends") && !viewer)
      throw new DomainError(401, "Sign in to see this collection.");
    const access = visibilitySql(viewer);
    const where = [access.sql];
    const values: (string | number)[] = [...access.params];
    if (scope === "mine") {
      where.push("r.author_id=?");
      values.push(viewer!.id);
    }
    if (scope === "public")
      where.push("r.visibility='PUBLIC' AND r.moderation_status='APPROVED'");
    if (scope === "friends") {
      where.push(
        "r.visibility IN ('PUBLIC','FRIENDS') AND r.moderation_status='APPROVED' AND EXISTS(SELECT 1 FROM friendships f WHERE f.status='ACCEPTED' AND ((f.user_low=? AND f.user_high=r.author_id) OR (f.user_high=? AND f.user_low=r.author_id)))",
      );
      values.push(viewer!.id, viewer!.id);
    }
    if (scope === "profile") {
      const authorId = params.get("authorId");
      if (!authorId) throw new DomainError(400, "Choose a profile.");
      where.push("r.author_id=?");
      values.push(authorId);
    }
    if (params.get("reference")) {
      const target = this.parseTarget(params.get("reference")!);
      where.push(
        "p.book_id=? AND (p.start_chapter*1000+p.start_verse)<=? AND (p.end_chapter*1000+p.end_verse)>=?",
      );
      values.push(
        target.bookId,
        target.endChapter * 1000 + target.endVerse,
        target.startChapter * 1000 + target.startVerse,
      );
    }
    if (params.get("book")) {
      where.push("p.book_id=?");
      values.push(params.get("book")!);
    }
    if (params.get("visibility")) {
      where.push("r.visibility=?");
      values.push(params.get("visibility")!);
    }
    if (params.get("q")) {
      // Global text search is public-only; the journal deliberately supports the author's own private text.
      if (scope !== "mine") where.push("r.visibility='PUBLIC'");
      where.push(
        "(r.body LIKE ? ESCAPE '\\' OR r.title LIKE ? ESCAPE '\\' OR p.reference LIKE ? ESCAPE '\\')",
      );
      const q = `%${params
        .get("q")!
        .slice(0, 200)
        .replace(/[\\%_]/g, "\\$&")}%`;
      values.push(q, q, q);
    }
    for (const [key, operator] of [
      ["from", ">="],
      ["to", "<="],
    ])
      if (params.get(key)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(params.get(key)!))
          throw new DomainError(400, "Use dates in YYYY-MM-DD format.");
        where.push(`substr(r.created_at,1,10) ${operator} ?`);
        values.push(params.get(key)!);
      }
    const page = pageNumber(params.get("page"));
    const pageSize = 12;
    const sort =
      params.get("sort") === "oldest"
        ? "r.created_at ASC,r.id"
        : params.get("sort") === "biblical"
          ? "COALESCE(b.sort_order,999),p.start_chapter,p.start_verse,r.created_at DESC,r.id"
          : "r.created_at DESC,r.id";
    const rows = this.db.all(
      `SELECT r.*,p.reference,p.book_id,p.target_json FROM reflections r JOIN reflection_passages p ON p.reflection_id=r.id AND p.position=0 LEFT JOIN bible_books b ON b.id=p.book_id WHERE ${where.join(" AND ")} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      ...values,
      pageSize + 1,
      (page - 1) * pageSize,
    );
    return {
      items: rows
        .slice(0, pageSize)
        .filter((row) => this.permitted(row, viewer))
        .map((row) => this.serializeReflection(row, viewer)),
      page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  }
  parseTarget(reference: string) {
    try {
      return parseReference(reference);
    } catch (error) {
      throw new DomainError(
        400,
        error instanceof Error
          ? error.message
          : "Enter a valid Bible reference.",
      );
    }
  }
  audit(
    actorId: string,
    type: string,
    id: string | null,
    outcome: string,
    ruleId: string,
    note = "",
  ) {
    this.db.run(
      "INSERT INTO moderation_events VALUES(?,?,?,?,?,?,?,?)",
      randomUUID(),
      actorId,
      type,
      id,
      outcome,
      ruleId,
      note,
      now(),
    );
  }
  checkContent(user: User, type: string, id: string | null, text: string) {
    const result = moderateText(text);
    this.audit(user.id, type, id, result.outcome, result.ruleId);
    if (result.outcome === "BLOCK") throw new DomainError(422, result.message);
    return result;
  }
  repeatedContent(user: User, text: string) {
    const fingerprint = createHash("sha256")
      .update(text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim())
      .digest("hex");
    const existing = this.db.one(
      "SELECT created_at FROM content_fingerprints WHERE user_id=? AND fingerprint=?",
      user.id,
      fingerprint,
    );
    if (existing && Number(existing.created_at) > Date.now() - 60000)
      throw new DomainError(
        429,
        "This looks like something you just shared. Please wait a minute before posting it again.",
      );
    this.db.run(
      "DELETE FROM content_fingerprints WHERE created_at<?",
      Date.now() - 3600000,
    );
    this.db.run(
      "INSERT INTO content_fingerprints VALUES(?,?,?) ON CONFLICT(user_id,fingerprint) DO UPDATE SET created_at=excluded.created_at",
      user.id,
      fingerprint,
      Date.now(),
    );
  }
  createReflection(user: User, input: unknown) {
    const defaults = {
      title: "",
      visibility: user.defaultVisibility,
      commentsEnabled: user.defaultComments,
      reactionsEnabled: user.defaultReactions,
    };
    const data = reflectionSchema.parse(
      typeof input === "object" && input !== null && !Array.isArray(input)
        ? { ...defaults, ...input }
        : input,
    );
    const target = this.parseTarget(data.reference);
    const passage = getPassage(target);
    if (!passage.available)
      throw new DomainError(
        400,
        "This passage is not in the local Bible sample yet. Choose an available passage or import the full text.",
      );
    const id = randomUUID();
    const body = normalizeText(data.body);
    const title = normalizeText(data.title);
    if (!body) throw new DomainError(400, "Write a few words before saving.");
    const moderation = this.checkContent(
      user,
      "reflection",
      id,
      `${title}\n${body}`,
    );
    this.repeatedContent(user, body);
    this.db.transaction(() => {
      const timestamp = now();
      this.db.run(
        "INSERT INTO reflections(id,author_id,title,body,visibility,comments_enabled,reactions_enabled,moderation_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        id,
        user.id,
        title,
        body,
        data.visibility,
        Number(data.commentsEnabled),
        Number(data.reactionsEnabled),
        moderation.outcome === "REVIEW" ? "REVIEW" : "APPROVED",
        timestamp,
        timestamp,
      );
      insertPassage(this.db, id, target.displayReference);
    });
    return {
      reflection: this.getReflection(id, user),
      message: moderation.message,
    };
  }
  updateReflection(user: User, id: string, input: unknown) {
    const row = this.requireReflection(id, user);
    if (row.author_id !== user.id)
      throw new DomainError(403, "Only the author can edit this reflection.");
    const patch = reflectionSchema.partial().parse(input);
    const data = reflectionSchema.parse({
      reference: row.reference,
      title: row.title,
      body: row.body,
      visibility: row.visibility,
      commentsEnabled: boolean(row.comments_enabled),
      reactionsEnabled: boolean(row.reactions_enabled),
      ...patch,
    });
    const target = this.parseTarget(data.reference);
    if (patch.reference && !getPassage(target).available)
      throw new DomainError(
        400,
        "This passage is not in the local Bible sample yet.",
      );
    const body = normalizeText(data.body);
    const title = normalizeText(data.title);
    if (!body) throw new DomainError(400, "Write a few words before saving.");
    const moderation = this.checkContent(
      user,
      "reflection",
      id,
      `${title}\n${body}`,
    );
    // Moderator-hidden content stays hidden on author edits until a moderator approves it.
    const status =
      row.moderation_status === "HIDDEN"
        ? "HIDDEN"
        : moderation.outcome === "REVIEW"
          ? "REVIEW"
          : "APPROVED";
    this.db.transaction(() => {
      this.db.run(
        "UPDATE reflections SET title=?,body=?,visibility=?,comments_enabled=?,reactions_enabled=?,moderation_status=?,updated_at=? WHERE id=?",
        title,
        body,
        data.visibility,
        Number(data.commentsEnabled),
        Number(data.reactionsEnabled),
        status,
        now(),
        id,
      );
      this.db.run("DELETE FROM reflection_passages WHERE reflection_id=?", id);
      insertPassage(this.db, id, target.displayReference);
    });
    return {
      reflection: this.getReflection(id, user),
      message: moderation.message,
    };
  }
  deleteReflection(user: User, id: string) {
    const row = this.requireReflection(id, user);
    if (row.author_id !== user.id)
      throw new DomainError(403, "Only the author can delete this reflection.");
    this.db.run(
      "UPDATE reflections SET deleted_at=?,updated_at=? WHERE id=?",
      now(),
      now(),
      id,
    );
  }
  serializeComment(row: Row): Comment {
    return {
      id: String(row.id),
      reflectionId: String(row.reflection_id),
      authorId: String(row.author_id),
      author: publicProfile(this.user(String(row.author_id))!),
      body: String(row.body),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      edited: row.created_at !== row.updated_at,
    };
  }
  listComments(id: string, viewer: User | null, page = 1): Page<Comment> {
    const row = this.requireReflection(id, viewer);
    const pageSize = 20;
    if (!boolean(row.comments_enabled))
      return { items: [], page, pageSize, hasMore: false };
    const values: (string | number)[] = [id];
    let blocked = "";
    if (viewer) {
      blocked =
        "AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=c.author_id) OR (b.blocked_id=? AND b.blocker_id=c.author_id))";
      values.push(viewer.id, viewer.id);
    }
    const rows = this.db.all(
      `SELECT c.* FROM comments c WHERE c.reflection_id=? AND c.deleted_at IS NULL AND c.moderation_status='APPROVED' ${blocked} ORDER BY c.created_at,c.id LIMIT ? OFFSET ?`,
      ...values,
      pageSize + 1,
      (page - 1) * pageSize,
    );
    return {
      items: rows.slice(0, pageSize).map((item) => this.serializeComment(item)),
      page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  }
  addComment(user: User, id: string, input: unknown) {
    const row = this.requireReflection(id, user);
    if (!boolean(row.comments_enabled))
      throw new DomainError(
        403,
        "Comments are turned off for this reflection.",
      );
    if (row.moderation_status !== "APPROVED")
      throw new DomainError(
        403,
        "Comments are unavailable while this reflection is under review.",
      );
    const data = commentSchema.parse(input);
    const body = normalizeText(data.body);
    const commentId = randomUUID();
    if (!body)
      throw new DomainError(400, "Write a few words before commenting.");
    const result = this.checkContent(user, "comment", commentId, body);
    this.repeatedContent(user, body);
    const timestamp = now();
    this.db.run(
      "INSERT INTO comments(id,reflection_id,author_id,body,moderation_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      commentId,
      id,
      user.id,
      body,
      result.outcome === "REVIEW" ? "REVIEW" : "APPROVED",
      timestamp,
      timestamp,
    );
    if (result.outcome !== "REVIEW")
      this.notify(String(row.author_id), user.id, "COMMENT", id);
    return {
      comment: this.serializeComment(
        this.db.one("SELECT * FROM comments WHERE id=?", commentId)!,
      ),
      message: result.outcome === "ALLOW" ? "Comment added." : result.message,
    };
  }
  updateComment(user: User, id: string, input: unknown) {
    const row = this.db.one(
      "SELECT * FROM comments WHERE id=? AND deleted_at IS NULL",
      id,
    );
    if (!row || row.author_id !== user.id)
      throw new DomainError(404, "This comment is unavailable.");
    const reflection = this.requireReflection(String(row.reflection_id), user);
    if (!boolean(reflection.comments_enabled))
      throw new DomainError(
        403,
        "Comments are turned off for this reflection.",
      );
    const body = normalizeText(commentSchema.parse(input).body);
    if (!body)
      throw new DomainError(400, "Write a few words before commenting.");
    const result = this.checkContent(user, "comment", id, body);
    this.db.run(
      "UPDATE comments SET body=?,moderation_status=?,updated_at=? WHERE id=?",
      body,
      row.moderation_status === "HIDDEN"
        ? "HIDDEN"
        : result.outcome === "REVIEW"
          ? "REVIEW"
          : "APPROVED",
      now(),
      id,
    );
    return {
      comment: this.serializeComment(
        this.db.one("SELECT * FROM comments WHERE id=?", id)!,
      ),
      message: "Comment updated.",
    };
  }
  deleteComment(user: User, id: string) {
    const row = this.db.one(
      "SELECT * FROM comments WHERE id=? AND deleted_at IS NULL",
      id,
    );
    if (!row) throw new DomainError(404, "This comment is unavailable.");
    const reflection = this.requireReflection(String(row.reflection_id), user);
    if (row.author_id !== user.id && reflection.author_id !== user.id)
      throw new DomainError(403, "You cannot remove this comment.");
    this.db.run(
      "UPDATE comments SET deleted_at=?,updated_at=? WHERE id=?",
      now(),
      now(),
      id,
    );
  }
  react(user: User, id: string, input: unknown) {
    const row = this.requireReflection(id, user);
    const { kind } = reactionSchema.parse(input);
    if (!boolean(row.reactions_enabled))
      throw new DomainError(
        403,
        "Reactions are turned off for this reflection.",
      );
    if (row.moderation_status !== "APPROVED")
      throw new DomainError(
        403,
        "Reactions are unavailable while this reflection is under review.",
      );
    if (kind === null)
      this.db.run(
        "DELETE FROM reactions WHERE reflection_id=? AND user_id=?",
        id,
        user.id,
      );
    else {
      const previous = this.db.one(
        "SELECT kind FROM reactions WHERE reflection_id=? AND user_id=?",
        id,
        user.id,
      );
      this.db.run(
        "INSERT INTO reactions VALUES(?,?,?,?) ON CONFLICT(reflection_id,user_id) DO UPDATE SET kind=excluded.kind",
        id,
        user.id,
        kind,
        now(),
      );
      if (!previous)
        this.notify(String(row.author_id), user.id, "REACTION", id);
    }
    return this.getReflection(id, user);
  }
  relationship(
    viewer: User | null,
    targetId: string,
  ): RelationshipUser["relationship"] {
    if (!viewer || viewer.id === targetId) return "NONE";
    if (isBlocked(this.db, viewer.id, targetId)) return "BLOCKED";
    const [low, high] = pair(viewer.id, targetId);
    const relation = this.db.one(
      "SELECT * FROM friendships WHERE user_low=? AND user_high=?",
      low,
      high,
    );
    return relation?.status === "ACCEPTED"
      ? "FRIEND"
      : relation
        ? relation.requested_by === viewer.id
          ? "OUTGOING"
          : "INCOMING"
        : "NONE";
  }
  friends(user: User): FriendsResult {
    const result: FriendsResult = {
      friends: [],
      incoming: [],
      outgoing: [],
      blocked: [],
    };
    for (const row of this.db.all(
      "SELECT * FROM friendships WHERE user_low=? OR user_high=? ORDER BY updated_at DESC LIMIT 500",
      user.id,
      user.id,
    )) {
      const targetId = String(
        row.user_low === user.id ? row.user_high : row.user_low,
      );
      const target = this.user(targetId)!;
      const relationship = this.relationship(user, targetId);
      const item = { ...publicProfile(target), relationship };
      if (relationship === "FRIEND") result.friends.push(item);
      else if (relationship === "INCOMING") result.incoming.push(item);
      else if (relationship === "OUTGOING") result.outgoing.push(item);
    }
    for (const row of this.db.all(
      "SELECT blocked_id FROM blocks WHERE blocker_id=? LIMIT 500",
      user.id,
    ))
      result.blocked.push({
        ...publicProfile(this.user(String(row.blocked_id))!),
        relationship: "BLOCKED",
      });
    return result;
  }
  changeFriendship(user: User, input: unknown) {
    const { userId, action } = friendshipSchema.parse(input);
    if (user.id === userId)
      throw new DomainError(400, "Choose another person.");
    if (!this.user(userId))
      throw new DomainError(404, "This person is unavailable.");
    const [low, high] = pair(user.id, userId);
    const timestamp = now();
    this.db.transaction(() => {
      const existing = this.db.one(
        "SELECT * FROM friendships WHERE user_low=? AND user_high=?",
        low,
        high,
      );
      if (action === "block") {
        this.db.run(
          "INSERT OR IGNORE INTO blocks VALUES(?,?,?)",
          user.id,
          userId,
          timestamp,
        );
        this.db.run(
          "DELETE FROM friendships WHERE user_low=? AND user_high=?",
          low,
          high,
        );
        return;
      }
      if (action === "unblock") {
        this.db.run(
          "DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?",
          user.id,
          userId,
        );
        return;
      }
      if (isBlocked(this.db, user.id, userId))
        throw new DomainError(404, "This person is unavailable.");
      if (action === "request") {
        if (existing)
          throw new DomainError(409, "A connection or request already exists.");
        this.db.run(
          "INSERT INTO friendships VALUES(?,?,?,'PENDING',?,?)",
          low,
          high,
          user.id,
          timestamp,
          timestamp,
        );
        this.notify(userId, user.id, "FRIEND_REQUEST");
        return;
      }
      if (!existing)
        throw new DomainError(404, "This connection is no longer available.");
      if (action === "accept" || action === "decline") {
        if (existing.status !== "PENDING" || existing.requested_by === user.id)
          throw new DomainError(
            403,
            "Only the recipient can respond to this request.",
          );
        if (action === "accept") {
          this.db.run(
            "UPDATE friendships SET status='ACCEPTED',updated_at=? WHERE user_low=? AND user_high=?",
            timestamp,
            low,
            high,
          );
          this.notify(userId, user.id, "FRIEND_ACCEPTED");
          return;
        }
      }
      if (
        action === "cancel" &&
        (existing.status !== "PENDING" || existing.requested_by !== user.id)
      )
        throw new DomainError(
          403,
          "Only the sender can cancel a pending request.",
        );
      if (action === "remove" && existing.status !== "ACCEPTED")
        throw new DomainError(
          400,
          "This connection is not an accepted friendship.",
        );
      this.db.run(
        "DELETE FROM friendships WHERE user_low=? AND user_high=?",
        low,
        high,
      );
    });
    return this.friends(user);
  }
  people(viewer: User, params: URLSearchParams): Page<RelationshipUser> {
    const page = pageNumber(params.get("page"));
    const pageSize = 20;
    const q = `%${(params.get("q") || "").slice(0, 100).replace(/[\\%_]/g, "\\$&")}%`;
    const rows = this.db.all(
      "SELECT u.id FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id<>? AND (u.username LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\') AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocked_id=? AND b.blocker_id=u.id)) ORDER BY p.display_name LIMIT ? OFFSET ?",
      viewer.id,
      q,
      q,
      viewer.id,
      viewer.id,
      pageSize + 1,
      (page - 1) * pageSize,
    );
    return {
      items: rows.slice(0, pageSize).map((row) => ({
        ...publicProfile(this.user(String(row.id))!),
        relationship: this.relationship(viewer, String(row.id)),
      })),
      page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  }
  profile(
    username: string,
    viewer: User | null,
    params = new URLSearchParams(),
  ) {
    const row = this.db.one(
      "SELECT id FROM users WHERE username=? COLLATE NOCASE",
      username,
    );
    if (!row || isBlocked(this.db, viewer?.id, String(row.id)))
      throw new DomainError(404, "This profile is unavailable.");
    const target = this.user(String(row.id))!;
    params.set("scope", "profile");
    params.set("authorId", target.id);
    return {
      profile: publicProfile(target),
      relationship: this.relationship(viewer, target.id),
      reflections: this.listReflections(viewer, params),
    };
  }
  updateSettings(user: User, input: unknown) {
    const data = settingsSchema.parse(input);
    if (
      data.displayName !== undefined &&
      normalizeText(data.displayName).length < 2
    )
      throw new DomainError(
        400,
        "Use at least two characters for your display name.",
      );
    if (data.username || data.displayName || data.bio) {
      const result = this.checkContent(
        user,
        "profile",
        user.id,
        [
          data.username || user.username,
          data.displayName || user.displayName,
          data.bio ?? user.bio,
        ].join("\n"),
      );
      if (result.outcome === "REVIEW")
        throw new DomainError(
          422,
          "Please revise this profile wording before saving.",
        );
    }
    if (
      data.username &&
      this.db.one(
        "SELECT id FROM users WHERE username=? COLLATE NOCASE AND id<>?",
        data.username,
        user.id,
      )
    )
      throw new DomainError(409, "That username is already in use.");
    const merged = { ...user, ...data };
    this.db.transaction(() => {
      this.db.run(
        "UPDATE users SET username=?,default_visibility=?,default_comments=?,default_reactions=?,theme=?,notify_friends=?,notify_comments=?,notify_reactions=? WHERE id=?",
        merged.username,
        merged.defaultVisibility,
        Number(merged.defaultComments),
        Number(merged.defaultReactions),
        merged.theme,
        Number(merged.notifyFriends),
        Number(merged.notifyComments),
        Number(merged.notifyReactions),
        user.id,
      );
      this.db.run(
        "UPDATE profiles SET display_name=?,bio=? WHERE user_id=?",
        normalizeText(merged.displayName),
        normalizeText(merged.bio),
        user.id,
      );
    });
    return this.user(user.id)!;
  }
  notify(
    recipientId: string,
    actorId: string,
    kind: string,
    reflectionId: string | null = null,
  ) {
    if (recipientId === actorId || isBlocked(this.db, recipientId, actorId))
      return;
    const recipient = this.user(recipientId)!;
    if (
      (kind.startsWith("FRIEND") && !recipient.notifyFriends) ||
      (kind === "COMMENT" && !recipient.notifyComments) ||
      (kind === "REACTION" && !recipient.notifyReactions)
    )
      return;
    if (
      reflectionId &&
      !this.permitted(this.rawReflection(reflectionId), recipient)
    )
      return;
    this.db.run(
      "INSERT INTO notifications VALUES(?,?,?,?,?,?,?)",
      randomUUID(),
      recipientId,
      actorId,
      kind,
      reflectionId,
      null,
      now(),
    );
  }
  notifications(user: User): Notification[] {
    const result: Notification[] = [];
    for (const row of this.db.all(
      "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
      user.id,
    )) {
      if (isBlocked(this.db, user.id, String(row.actor_id))) continue;
      if (
        row.reflection_id &&
        !this.permitted(this.rawReflection(String(row.reflection_id)), user)
      )
        continue;
      const actor = this.user(String(row.actor_id));
      const text: Record<string, string> = {
        FRIEND_REQUEST: "sent you a friend request.",
        FRIEND_ACCEPTED: "accepted your friend request.",
        COMMENT: "left a comment on your reflection.",
        REACTION: "responded to your reflection.",
        MODERATION:
          "reviewed your reflection. You can contact support about this decision.",
      };
      result.push({
        id: String(row.id),
        kind: String(row.kind),
        message: `${actor?.displayName || "A community steward"} ${text[String(row.kind)] || "shared an update."}`,
        href: row.reflection_id
          ? `/reflections/${row.reflection_id}`
          : "/friends",
        read: Boolean(row.read_at),
        createdAt: String(row.created_at),
      });
    }
    return result.slice(0, 30);
  }
  readNotifications(user: User, input: unknown) {
    const { id } = z
      .object({ id: z.string().max(100).optional() })
      .strict()
      .parse(input);
    if (id)
      this.db.run(
        "UPDATE notifications SET read_at=? WHERE id=? AND user_id=?",
        now(),
        id,
        user.id,
      );
    else
      this.db.run(
        "UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL",
        now(),
        user.id,
      );
  }
  report(user: User, input: unknown) {
    const data = reportSchema.parse(input);
    let reflectionId = data.reflectionId;
    if (data.commentId) {
      const comment = this.db.one(
        "SELECT * FROM comments WHERE id=? AND deleted_at IS NULL AND moderation_status='APPROVED'",
        data.commentId,
      );
      if (!comment || isBlocked(this.db, user.id, String(comment.author_id)))
        throw new DomainError(404, "This comment is unavailable.");
      reflectionId = String(comment.reflection_id);
      const parent = this.requireReflection(reflectionId, user);
      if (!boolean(parent.comments_enabled))
        throw new DomainError(404, "This comment is unavailable.");
    }
    this.requireReflection(reflectionId!, user);
    if (
      this.db.one(
        "SELECT id FROM reports WHERE reporter_id=? AND status='OPEN' AND (reflection_id=? OR comment_id=?)",
        user.id,
        data.reflectionId || null,
        data.commentId || null,
      )
    )
      throw new DomainError(
        409,
        "You already reported this item. A steward will review it.",
      );
    const timestamp = now();
    this.db.run(
      "INSERT INTO reports VALUES(?,?,?,?,?,?, 'OPEN',?,?)",
      randomUUID(),
      user.id,
      data.reflectionId || null,
      data.commentId || null,
      data.reason,
      normalizeText(data.details),
      timestamp,
      timestamp,
    );
  }
  requireModerator(user: User) {
    if (user.role !== "MODERATOR")
      throw new DomainError(403, "This area is for community stewards.");
  }
  moderationQueue(user: User, page = 1) {
    this.requireModerator(user);
    const pageSize = 20;
    const rows = this.db.all(
      `SELECT r.id,'reflection' AS type,r.body,r.author_id,r.moderation_status AS status,r.created_at,p.reference,
      COALESCE((SELECT reason FROM reports t WHERE t.reflection_id=r.id AND t.status='OPEN' LIMIT 1),'automatic review') AS reason
      FROM reflections r JOIN reflection_passages p ON p.reflection_id=r.id AND p.position=0 WHERE r.deleted_at IS NULL AND (r.moderation_status='REVIEW' OR EXISTS(SELECT 1 FROM reports t WHERE t.reflection_id=r.id AND t.status='OPEN'))
      UNION ALL SELECT c.id,'comment',c.body,c.author_id,c.moderation_status,c.created_at,p.reference,
      COALESCE((SELECT reason FROM reports t WHERE t.comment_id=c.id AND t.status='OPEN' LIMIT 1),'automatic review')
      FROM comments c JOIN reflections r ON r.id=c.reflection_id JOIN reflection_passages p ON p.reflection_id=r.id AND p.position=0 WHERE c.deleted_at IS NULL AND r.deleted_at IS NULL AND (c.moderation_status='REVIEW' OR EXISTS(SELECT 1 FROM reports t WHERE t.comment_id=c.id AND t.status='OPEN')) ORDER BY created_at ASC LIMIT ? OFFSET ?`,
      pageSize + 1,
      (page - 1) * pageSize,
    );
    const items = rows.slice(0, pageSize).map((row) => {
      // Every content read in privileged tools is auditable, including private content submitted by its author.
      this.audit(
        user.id,
        String(row.type),
        String(row.id),
        "VIEW",
        "moderator-content-access",
      );
      return {
        id: row.id,
        type: row.type,
        body: row.body,
        author: publicProfile(this.user(String(row.author_id))!),
        reference: row.reference,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
      };
    });
    return { items, page, hasMore: rows.length > pageSize };
  }
  moderate(user: User, input: unknown) {
    this.requireModerator(user);
    const data = moderationSchema.parse(input);
    const table = data.type === "reflection" ? "reflections" : "comments";
    const row = this.db.one(
      `SELECT * FROM ${table} WHERE id=? AND deleted_at IS NULL`,
      data.id,
    );
    if (!row) throw new DomainError(404, "This item is unavailable.");
    this.db.transaction(() => {
      this.audit(
        user.id,
        data.type,
        data.id,
        data.action.toUpperCase(),
        "manual-decision",
        data.note,
      );
      if (data.action !== "dismiss")
        this.db.run(
          `UPDATE ${table} SET moderation_status=?,updated_at=? WHERE id=?`,
          data.action === "hide" ? "HIDDEN" : "APPROVED",
          now(),
          data.id,
        );
      this.db.run(
        `UPDATE reports SET status=?,updated_at=? WHERE ${data.type === "reflection" ? "reflection_id" : "comment_id"}=? AND status='OPEN'`,
        data.action === "dismiss" ? "DISMISSED" : "RESOLVED",
        now(),
        data.id,
      );
      const reflectionId =
        data.type === "reflection" ? data.id : String(row.reflection_id);
      this.notify(String(row.author_id), user.id, "MODERATION", reflectionId);
    });
  }
  rateLimit(user: User | null, ip: string, action: string) {
    const limits: Record<string, number> = {
      reflection: 12,
      comment: 24,
      reaction: 80,
      friendship: 20,
      report: 8,
      auth: 20,
      settings: 30,
      moderation: 60,
      notification: 60,
      preview: 120,
    };
    const limit = limits[action] || 30;
    const windowMs = 60000;
    const timestamp = Date.now();
    // IPs are hashed; raw addresses and content never enter the limiter table.
    const keys = [
      `ip:${createHash("sha256").update(ip).digest("hex")}:${action}`,
    ];
    if (user) keys.push(`user:${user.id}:${action}`);
    this.db.transaction(() => {
      this.db.run("DELETE FROM rate_limits WHERE reset_at<?", timestamp);
      for (const key of keys) {
        const row = this.db.one(
          "SELECT count,reset_at FROM rate_limits WHERE key=?",
          key,
        );
        const allowed = key.startsWith("ip:") ? limit * 3 : limit;
        if (row && Number(row.count) >= allowed)
          throw new DomainError(
            429,
            "Please take a short pause and try again in a minute.",
          );
      }
      for (const key of keys)
        this.db.run(
          "INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
          key,
          timestamp + windowMs,
        );
    });
  }
}
