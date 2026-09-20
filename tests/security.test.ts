import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { GET as apiGet, POST as apiPost } from "../app/api/[...path]/route";
import { Database, seedDatabase } from "../lib/server/db";
import {
  canViewReflection,
  CommunityService,
  DomainError,
} from "../lib/server/domain";
import { moderateText, normalizeText } from "../lib/server/moderation";
import type { ModerationStatus, User, Visibility } from "../lib/types";

function fixture(t: TestContext) {
  const db = new Database(":memory:");
  seedDatabase(db);
  t.after(() => db.close());
  const service = new CommunityService(db);
  return {
    db,
    service,
    author: service.user("ruth")!,
    friend: service.user("jonah")!,
    stranger: service.user("maya")!,
    moderator: service.user("admin")!,
  };
}

function denied(action: () => unknown, status = 404) {
  assert.throws(
    action,
    (error: unknown) => error instanceof DomainError && error.status === status,
  );
}

test("complete privacy policy matrix covers authors, friends, strangers, guests, moderators, blocks, review and deletion", (t) => {
  const { db, author, friend, stranger, moderator } = fixture(t);
  const viewers: { label: string; user: User | null }[] = [
    { label: "author", user: author },
    { label: "friend", user: friend },
    { label: "stranger", user: stranger },
    { label: "guest", user: null },
    { label: "moderator", user: moderator },
  ];
  let checks = 0;
  for (const visibility of ["PRIVATE", "FRIENDS", "PUBLIC"] as Visibility[]) {
    for (const moderationStatus of [
      "APPROVED",
      "REVIEW",
      "HIDDEN",
    ] as ModerationStatus[]) {
      for (const deletedAt of [null, "2026-09-01T00:00:00Z"]) {
        for (const { label, user } of viewers) {
          for (const block of [
            "none",
            "author-blocks-viewer",
            "viewer-blocks-author",
          ]) {
            db.run("DELETE FROM blocks");
            const blocked =
              block !== "none" && user !== null && user.id !== author.id;
            if (blocked)
              db.run(
                "INSERT INTO blocks VALUES(?,?,?)",
                block === "author-blocks-viewer" ? author.id : user!.id,
                block === "author-blocks-viewer" ? user!.id : author.id,
                new Date().toISOString(),
              );
            const expected =
              !deletedAt &&
              !blocked &&
              (label === "author" ||
                (moderationStatus === "APPROVED" &&
                  (visibility === "PUBLIC" ||
                    (visibility === "FRIENDS" && label === "friend"))));
            assert.equal(
              canViewReflection(db, user, {
                authorId: author.id,
                visibility,
                moderationStatus,
                deletedAt,
              }),
              expected,
              `${visibility}/${moderationStatus}/${deletedAt ? "deleted" : "active"}/${label}/${block}`,
            );
            checks++;
          }
        }
      }
    }
  }
  assert.equal(checks, 270);
});

test("visibility restriction revokes detail, search, feeds, profiles, interactions, reports and stale notifications immediately", (t) => {
  const { service, db, author, friend, stranger } = fixture(t);
  const id = "quiet-moments";
  const secret = "uniquely searchable revised journal phrase";
  service.updateReflection(author, id, { body: secret, visibility: "PUBLIC" });
  assert.equal(service.getReflection(id, null).body, secret);
  // A historical notification may remain in storage after privacy changes; current authorization must remove it from delivery.
  db.run(
    "INSERT INTO notifications VALUES('stale-view','maya','ruth','COMMENT',?,NULL,?)",
    id,
    new Date().toISOString(),
  );
  assert.ok(
    service
      .notifications(stranger)
      .some((item) => item.href === `/reflections/${id}`),
  );
  service.updateReflection(author, id, { visibility: "FRIENDS" });
  assert.equal(service.getReflection(id, friend).body, secret);
  for (const viewer of [null, stranger]) {
    denied(() => service.getReflection(id, viewer));
    denied(() => service.listComments(id, viewer));
    assert.ok(
      !service
        .listReflections(viewer, new URLSearchParams({ q: secret }))
        .items.some((item) => item.id === id),
    );
    assert.ok(
      !service
        .profile("ruth", viewer)
        .reflections.items.some((item) => item.id === id),
    );
  }
  denied(() => service.addComment(stranger, id, { body: "A new comment" }));
  denied(() => service.react(stranger, id, { kind: "Amen" }));
  denied(() => service.report(stranger, { reflectionId: id, reason: "other" }));
  assert.ok(
    !service
      .notifications(stranger)
      .some((item) => item.href === `/reflections/${id}`),
  );
  service.updateReflection(author, id, { visibility: "PRIVATE" });
  denied(() => service.getReflection(id, friend));
  assert.ok(
    !service
      .listReflections(friend, new URLSearchParams({ scope: "friends" }))
      .items.some((item) => item.id === id),
  );
  assert.equal(
    service.listReflections(
      author,
      new URLSearchParams({ scope: "mine", q: secret }),
    ).items[0]?.id,
    id,
  );
});

test("blocking revokes a reciprocal friendship, notifications, people and all content access in both directions", (t) => {
  const { service, author, friend } = fixture(t);
  service.react(friend, "friend-reflection", { kind: "Helpful" });
  service.changeFriendship(author, { userId: friend.id, action: "block" });
  assert.equal(service.friends(author).friends.length, 0);
  denied(() => service.getReflection("quiet-moments", friend));
  denied(() => service.getReflection("small-kindness", author));
  denied(() => service.getReflection("friend-reflection", friend));
  denied(() => service.profile("ruth", friend));
  denied(() => service.profile("jonah", author));
  assert.ok(
    !service
      .people(author, new URLSearchParams())
      .items.some((item) => item.id === friend.id),
  );
  assert.ok(
    !service.notifications(author).some((item) => /Jonah/.test(item.message)),
  );
  denied(() =>
    service.changeFriendship(friend, { userId: author.id, action: "request" }),
  );
  denied(() =>
    service.addComment(friend, "quiet-moments", {
      body: "Attempt through a known URL",
    }),
  );
  denied(() => service.react(friend, "quiet-moments", { kind: "Amen" }));
  service.changeFriendship(author, { userId: friend.id, action: "unblock" });
  assert.equal(service.relationship(author, friend.id), "NONE");
  denied(() => service.getReflection("friend-reflection", friend));
  assert.equal(
    service.getReflection("quiet-moments", friend).id,
    "quiet-moments",
  );
});

test("disabled comments and reactions are retained but hidden and reject all new writes", (t) => {
  const { service, db, author, friend } = fixture(t);
  service.updateReflection(author, "quiet-moments", {
    commentsEnabled: false,
    reactionsEnabled: false,
  });
  const result = service.getReflection("quiet-moments", friend);
  assert.equal(result.commentCount, 0);
  assert.deepEqual(result.reactions, {
    Amen: 0,
    Thoughtful: 0,
    Encouraging: 0,
    Helpful: 0,
  });
  assert.equal(result.myReaction, null);
  assert.equal(service.listComments("quiet-moments", friend).items.length, 0);
  denied(
    () =>
      service.addComment(friend, "quiet-moments", {
        body: "Bypassed interface",
      }),
    403,
  );
  denied(
    () =>
      service.updateComment(friend, "seed-comment", { body: "Bypassed edit" }),
    403,
  );
  denied(() => service.react(friend, "quiet-moments", { kind: "Amen" }), 403);
  denied(() =>
    service.report(friend, { commentId: "seed-comment", reason: "other" }),
  );
  assert.equal(
    db.one(
      "SELECT count(*) AS total FROM comments WHERE reflection_id='quiet-moments'",
    )?.total,
    1,
  );
  assert.equal(
    db.one(
      "SELECT count(*) AS total FROM reactions WHERE reflection_id='quiet-moments'",
    )?.total,
    2,
  );
  service.updateReflection(author, "quiet-moments", {
    commentsEnabled: true,
    reactionsEnabled: true,
  });
  assert.equal(service.listComments("quiet-moments", friend).items.length, 1);
  assert.equal(
    service.getReflection("quiet-moments", friend).reactions.Thoughtful,
    1,
  );
});

test("moderators read restricted content only through an audited tool and authors cannot undo hiding", (t) => {
  const { service, db, author, stranger, moderator } = fixture(t);
  denied(() => service.getReflection("private-reflection", moderator));
  denied(() => service.moderationQueue(stranger), 403);
  service.report(author, {
    reflectionId: "private-reflection",
    reason: "other",
  });
  const before = Number(
    db.one(
      "SELECT count(*) AS total FROM moderation_events WHERE rule_id='moderator-content-access'",
    )?.total,
  );
  const queue = service.moderationQueue(moderator);
  assert.ok(queue.items.some((item) => item.id === "private-reflection"));
  const after = Number(
    db.one(
      "SELECT count(*) AS total FROM moderation_events WHERE rule_id='moderator-content-access'",
    )?.total,
  );
  assert.equal(after - before, queue.items.length);
  service.moderate(moderator, {
    type: "reflection",
    id: "quiet-moments",
    action: "hide",
    note: "Development review decision",
  });
  service.updateReflection(author, "quiet-moments", {
    body: "A thoughtful revised body",
    visibility: "PUBLIC",
  });
  assert.equal(
    service.getReflection("quiet-moments", author).moderationStatus,
    "HIDDEN",
  );
  denied(() => service.getReflection("quiet-moments", null));
  service.moderate(moderator, {
    type: "reflection",
    id: "quiet-moments",
    action: "approve",
  });
  assert.equal(
    service.getReflection("quiet-moments", null).moderationStatus,
    "APPROVED",
  );
});

test("deletion revokes content and attached interaction endpoints without exposing record existence", (t) => {
  const { service, author, friend } = fixture(t);
  service.deleteReflection(author, "quiet-moments");
  for (const viewer of [author, friend, null]) {
    denied(() => service.getReflection("quiet-moments", viewer));
    denied(() => service.getReflection("missing-reflection", viewer));
    denied(() => service.listComments("quiet-moments", viewer));
    assert.ok(
      !service
        .listReflections(viewer, new URLSearchParams())
        .items.some((item) => item.id === "quiet-moments"),
    );
  }
  denied(() => service.react(friend, "quiet-moments", { kind: "Amen" }));
  denied(() =>
    service.addComment(friend, "quiet-moments", { body: "A comment" }),
  );
  denied(() =>
    service.report(friend, { commentId: "seed-comment", reason: "other" }),
  );
});

test("user text remains plain text and React escapes HTML, scripts and attributes", () => {
  const input =
    '<img src=x onerror="alert(1)"><script>alert(2)</script> **A thought**';
  const html = renderToStaticMarkup(
    createElement("p", null, normalizeText(input)),
  );
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /\*\*A thought\*\*/);
});

test("moderation normalizes obscured abuse and records rules without content copies when the client is bypassed", (t) => {
  const { service, db, author, friend } = fixture(t);
  const blocked = ["kill", "yourself"].join(" . ");
  assert.equal(
    moderateText("Thank you for a thoughtful question.").outcome,
    "ALLOW",
  );
  assert.equal(moderateText("That was an idiot remark.").outcome, "WARN");
  assert.equal(
    moderateText("A question about suicide prevention.").outcome,
    "REVIEW",
  );
  assert.equal(moderateText(blocked).outcome, "BLOCK");
  denied(
    () =>
      service.createReflection(author, {
        reference: "John 3:16",
        body: blocked,
        visibility: "PUBLIC",
      }),
    422,
  );
  denied(
    () => service.updateReflection(author, "quiet-moments", { body: blocked }),
    422,
  );
  denied(
    () => service.addComment(friend, "quiet-moments", { body: blocked }),
    422,
  );
  denied(() => service.updateSettings(author, { displayName: blocked }), 422);
  const events = db.all(
    "SELECT * FROM moderation_events WHERE outcome='BLOCK'",
  );
  assert.equal(events.length, 4);
  assert.ok(
    events.every(
      (event) => event.rule_id === "targeted-harm" && event.note === "",
    ),
  );
  assert.ok(!JSON.stringify(events).includes(blocked));
  assert.throws(() =>
    service.createReflection(author, {
      reference: "John 3:16",
      body: "\u0000",
    }),
  );
  assert.throws(() =>
    service.addComment(friend, "quiet-moments", { body: "\u0000" }),
  );
});

test("per-user and per-IP rate limits apply independently and IP addresses are hashed at rest", (t) => {
  const { service, db, author, friend } = fixture(t);
  for (let index = 0; index < 12; index++)
    service.rateLimit(author, `198.51.100.${index}`, "reflection");
  denied(() => service.rateLimit(author, "203.0.113.8", "reflection"), 429);
  service.rateLimit(friend, "203.0.113.8", "reflection");
  for (let index = 0; index < 60; index++)
    service.rateLimit(null, "203.0.113.100", "auth");
  denied(() => service.rateLimit(null, "203.0.113.100", "auth"), 429);
  assert.ok(
    !JSON.stringify(db.all("SELECT * FROM rate_limits")).includes("203.0.113"),
  );
});

test("development sessions use random hashed tokens, enforce expiry, and honor explicit production app mode", (t) => {
  const { service, db } = fixture(t);
  const previous = { app: process.env.APP_ENV, auth: process.env.DEV_AUTH };
  t.after(() => {
    if (previous.app === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous.app;
    if (previous.auth === undefined) delete process.env.DEV_AUTH;
    else process.env.DEV_AUTH = previous.auth;
  });
  process.env.APP_ENV = "development";
  process.env.DEV_AUTH = "true";
  const first = service.signIn("ruth");
  const second = service.signIn("ruth");
  assert.notEqual(first.token, second.token);
  assert.equal(first.token.length, 64);
  assert.equal(service.currentUser(first.token)?.id, "ruth");
  const tokenHash = createHash("sha256").update(first.token).digest("hex");
  assert.equal(
    db.one("SELECT token_hash FROM sessions WHERE token_hash=?", tokenHash)
      ?.token_hash,
    tokenHash,
  );
  assert.ok(
    !JSON.stringify(db.all("SELECT * FROM sessions")).includes(first.token),
  );
  db.run(
    "UPDATE sessions SET expires_at='2000-01-01T00:00:00Z' WHERE token_hash=?",
    tokenHash,
  );
  assert.equal(service.currentUser(first.token), null);
  service.signOut(second.token);
  assert.equal(service.currentUser(second.token), null);
  process.env.APP_ENV = "production";
  denied(() => service.signIn("ruth"), 403);
  assert.deepEqual(service.developmentUsers(), []);
});

test("API happy path signs in, finds a passage, writes for friends, accepts a friend reaction and excludes guests and strangers", async (t) => {
  const keys = ["APP_ENV", "DEV_AUTH", "APP_ORIGIN", "DB_PATH"] as const;
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.APP_ENV = "development";
  process.env.DEV_AUTH = "true";
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.DB_PATH = ":memory:";

  async function request(
    method: "GET" | "POST",
    pathname: string,
    body?: unknown,
    token?: string,
    origin = "http://localhost:3000",
  ) {
    const url = new URL(pathname, "http://localhost:3000");
    const headers: Record<string, string> = {
      origin,
      "content-type": "application/json",
    };
    if (token) headers.cookie = `stillword_session=${token}`;
    const req = new NextRequest(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const response = await (method === "GET" ? apiGet : apiPost)(req, {
      params: Promise.resolve({
        path: url.pathname.split("/").filter(Boolean).slice(1),
      }),
    });
    assert.equal(
      response.headers.get("cache-control"),
      "private, no-store, max-age=0",
    );
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    return { response, body: await response.json() };
  }

  async function login(userId: string) {
    const result = await request("POST", "/api/auth/login", { userId });
    assert.equal(result.response.status, 200);
    const cookie = result.response.headers.get("set-cookie") || "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    const token = /stillword_session=([a-f0-9]{64})/.exec(cookie)?.[1];
    assert.ok(token);
    return token;
  }

  const authorToken = await login("ruth");
  const found = await request(
    "GET",
    "/api/bible?reference=John%203%3A16",
    undefined,
    authorToken,
  );
  assert.equal(found.response.status, 200);
  assert.ok(found.body.available && found.body.verses.length);
  const created = await request(
    "POST",
    "/api/reflections",
    {
      reference: "John 3:16",
      body: "A new reflection shared with trusted friends during an API happy path.",
      visibility: "FRIENDS",
      commentsEnabled: true,
      reactionsEnabled: true,
    },
    authorToken,
  );
  assert.equal(created.response.status, 201);
  const id = created.body.reflection.id as string;
  assert.equal(created.body.reflection.visibility, "FRIENDS");
  const friendToken = await login("jonah");
  assert.equal(
    (await request("GET", `/api/reflections/${id}`, undefined, friendToken))
      .response.status,
    200,
  );
  const reaction = await request(
    "POST",
    `/api/reflections/${id}/reactions`,
    { kind: "Thoughtful" },
    friendToken,
  );
  assert.equal(reaction.response.status, 200);
  assert.equal(reaction.body.reflection.reactions.Thoughtful, 1);
  const strangerToken = await login("maya");
  for (const token of [strangerToken, undefined]) {
    const inaccessible = await request(
      "GET",
      `/api/reflections/${id}`,
      undefined,
      token,
    );
    assert.equal(inaccessible.response.status, 404);
    assert.deepEqual(inaccessible.body, {
      error: "This reflection is unavailable.",
    });
    const feed = await request(
      "GET",
      "/api/reflections?scope=public",
      undefined,
      token,
    );
    assert.ok(!feed.body.items.some((item: { id: string }) => item.id === id));
  }
  const csrf = await request(
    "POST",
    "/api/reflections",
    { reference: "John 3:16", body: "Cross origin writing should fail." },
    authorToken,
    "https://untrusted.example",
  );
  assert.equal(csrf.response.status, 403);
  const unauthenticated = await request("POST", "/api/reflections", {
    reference: "John 3:16",
    body: "Anonymous writing should fail.",
  });
  assert.equal(unauthenticated.response.status, 401);
});
