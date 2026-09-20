import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Database, seedDatabase } from "../lib/server/db";
import { CommunityService, DomainError } from "../lib/server/domain";
import { moderateText } from "../lib/server/moderation";
import { getSiteDate } from "../lib/bible";

process.env.APP_ENV = "development";
process.env.DEV_AUTH = "true";
const databases: Database[] = [];
function setup() {
  const db = new Database(":memory:");
  databases.push(db);
  seedDatabase(db);
  const service = new CommunityService(db);
  return {
    db,
    service,
    ruth: service.user("ruth")!,
    jonah: service.user("jonah")!,
    maya: service.user("maya")!,
    admin: service.user("admin")!,
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const errorStatus = (status: number) => (error: unknown) =>
  error instanceof DomainError && error.status === status;

test("development seed contains all minimum community examples and is idempotent", () => {
  const { db, service, ruth } = setup();
  seedDatabase(db);
  assert.equal(db.one("SELECT COUNT(*) AS count FROM users")!.count, 4);
  assert.equal(
    service.listReflections(null, new URLSearchParams()).items.length,
    3,
  );
  assert.equal(service.friends(ruth).friends.length, 1);
  assert.equal(service.friends(ruth).incoming.length, 1);
  assert.ok(
    service.notifications(ruth).some((item) => item.kind === "FRIEND_REQUEST"),
  );
});

test("multiple reflections may target one passage while keeping independent visibility", () => {
  const { service, ruth } = setup();
  const first = service.createReflection(ruth, {
    reference: "John 3:16",
    body: "A first thought about generous love.",
    visibility: "FRIENDS",
  }).reflection;
  const second = service.createReflection(ruth, {
    reference: "John 3:16",
    body: "A second, different question for my journal.",
    visibility: "PRIVATE",
  }).reflection;
  assert.notEqual(first.id, second.id);
  assert.equal(first.reference, second.reference);
  assert.equal(first.visibility, "FRIENDS");
  assert.equal(second.visibility, "PRIVATE");
});

test("new reflections default to private and saved user preferences are honored", () => {
  const { service, ruth } = setup();
  const first = service.createReflection(ruth, {
    reference: "John 3:16",
    body: "An unshared thought about this passage.",
  }).reflection;
  assert.equal(first.visibility, "PRIVATE");
  const updated = service.updateSettings(ruth, {
    defaultVisibility: "FRIENDS",
    defaultComments: false,
    defaultReactions: false,
  });
  const second = service.createReflection(updated, {
    reference: "John 3:16",
    body: "A thought using my saved reflection preferences.",
  }).reflection;
  assert.equal(second.visibility, "FRIENDS");
  assert.equal(second.commentsEnabled, false);
  assert.equal(second.reactionsEnabled, false);
});

test("body-only updates never silently change privacy, title, or interaction settings", () => {
  const { service, ruth } = setup();
  const created = service.createReflection(ruth, {
    reference: "John 3:16",
    title: "A saved title",
    body: "My original words.",
    visibility: "FRIENDS",
    commentsEnabled: false,
    reactionsEnabled: false,
  }).reflection;
  const updated = service.updateReflection(ruth, created.id, {
    body: "My revised words.",
  }).reflection;
  assert.equal(updated.title, "A saved title");
  assert.equal(updated.visibility, "FRIENDS");
  assert.equal(updated.commentsEnabled, false);
  assert.equal(updated.reactionsEnabled, false);
});

test("friend lifecycle supports accept, remove, request, cancel, and decline", () => {
  const { service, ruth, maya } = setup();
  service.changeFriendship(ruth, { userId: maya.id, action: "accept" });
  assert.equal(service.relationship(ruth, maya.id), "FRIEND");
  service.changeFriendship(maya, { userId: ruth.id, action: "remove" });
  assert.equal(service.relationship(ruth, maya.id), "NONE");
  service.changeFriendship(ruth, { userId: maya.id, action: "request" });
  assert.equal(service.relationship(ruth, maya.id), "OUTGOING");
  assert.equal(service.relationship(maya, ruth.id), "INCOMING");
  service.changeFriendship(ruth, { userId: maya.id, action: "cancel" });
  assert.equal(service.relationship(ruth, maya.id), "NONE");
  service.changeFriendship(ruth, { userId: maya.id, action: "request" });
  service.changeFriendship(maya, { userId: ruth.id, action: "decline" });
  assert.equal(service.relationship(ruth, maya.id), "NONE");
});

test("canonical friendship pairs prevent reverse duplicates and self requests", () => {
  const { service, ruth, maya } = setup();
  assert.throws(
    () =>
      service.changeFriendship(ruth, { userId: ruth.id, action: "request" }),
    errorStatus(400),
  );
  assert.throws(
    () =>
      service.changeFriendship(ruth, { userId: maya.id, action: "request" }),
    errorStatus(409),
  );
  assert.throws(
    () =>
      service.changeFriendship(maya, { userId: ruth.id, action: "request" }),
    errorStatus(409),
  );
  assert.throws(
    () => service.changeFriendship(maya, { userId: ruth.id, action: "accept" }),
    errorStatus(403),
  );
  assert.throws(
    () => service.changeFriendship(ruth, { userId: maya.id, action: "cancel" }),
    errorStatus(403),
  );
});

test("block clears accepted and pending friendships and unblock does not restore them", () => {
  const { service, ruth, jonah, maya } = setup();
  service.changeFriendship(ruth, { userId: jonah.id, action: "block" });
  service.changeFriendship(ruth, { userId: maya.id, action: "block" });
  assert.equal(service.friends(ruth).friends.length, 0);
  assert.equal(service.friends(ruth).incoming.length, 0);
  assert.equal(service.friends(ruth).blocked.length, 2);
  assert.throws(
    () =>
      service.changeFriendship(jonah, { userId: ruth.id, action: "request" }),
    errorStatus(404),
  );
  service.changeFriendship(ruth, { userId: jonah.id, action: "unblock" });
  assert.equal(service.relationship(ruth, jonah.id), "NONE");
});

test("disabled interactions retain records but hide them and reject writes until enabled", () => {
  const { db, service, ruth, jonah } = setup();
  service.updateReflection(ruth, "quiet-moments", {
    commentsEnabled: false,
    reactionsEnabled: false,
  });
  const reflection = service.getReflection("quiet-moments", jonah);
  assert.equal(reflection.commentCount, 0);
  assert.deepEqual(reflection.reactions, {
    Amen: 0,
    Thoughtful: 0,
    Encouraging: 0,
    Helpful: 0,
  });
  assert.equal(service.listComments("quiet-moments", jonah).items.length, 0);
  assert.throws(
    () =>
      service.addComment(jonah, "quiet-moments", {
        body: "A comment that must be rejected.",
      }),
    errorStatus(403),
  );
  assert.throws(
    () => service.react(jonah, "quiet-moments", { kind: "Amen" }),
    errorStatus(403),
  );
  assert.throws(
    () =>
      service.updateComment(jonah, "seed-comment", {
        body: "Cannot edit while disabled.",
      }),
    errorStatus(403),
  );
  assert.equal(
    db.one(
      "SELECT COUNT(*) AS count FROM comments WHERE reflection_id='quiet-moments'",
    )!.count,
    1,
  );
  service.updateReflection(ruth, "quiet-moments", {
    commentsEnabled: true,
    reactionsEnabled: true,
  });
  assert.equal(service.listComments("quiet-moments", jonah).items.length, 1);
  assert.equal(
    service.getReflection("quiet-moments", jonah).reactions.Thoughtful,
    1,
  );
});

test("one active reaction per person supports replace and remove", () => {
  const { db, service, jonah } = setup();
  service.react(jonah, "quiet-moments", { kind: "Amen" });
  service.react(jonah, "quiet-moments", { kind: "Helpful" });
  assert.equal(
    db.one(
      "SELECT COUNT(*) AS count FROM reactions WHERE reflection_id=? AND user_id=?",
      "quiet-moments",
      jonah.id,
    )!.count,
    1,
  );
  assert.equal(
    service.getReflection("quiet-moments", jonah).myReaction,
    "Helpful",
  );
  service.react(jonah, "quiet-moments", { kind: null });
  assert.equal(service.getReflection("quiet-moments", jonah).myReaction, null);
});

test("comment author can edit while reflection author can remove", () => {
  const { service, ruth, jonah, maya } = setup();
  const { comment } = service.addComment(jonah, "quiet-moments", {
    body: "A question I can bring to this passage.",
  });
  service.updateComment(jonah, comment.id, {
    body: "A revised question for this passage.",
  });
  assert.throws(
    () =>
      service.updateComment(ruth, comment.id, {
        body: "Cannot rewrite somebody else's words.",
      }),
    errorStatus(404),
  );
  assert.throws(
    () => service.deleteComment(maya, comment.id),
    errorStatus(403),
  );
  service.deleteComment(ruth, comment.id);
  assert.ok(
    !service
      .listComments("quiet-moments", jonah)
      .items.some((item) => item.id === comment.id),
  );
});

test("moderation yields allow, warning, review, and block without policing disagreement", () => {
  assert.equal(
    moderateText(
      "I understand this passage differently, and I appreciate your perspective.",
    ).outcome,
    "ALLOW",
  );
  assert.equal(
    moderateText("I felt like an idiot for forgetting.").outcome,
    "WARN",
  );
  assert.equal(
    moderateText("I have a question about suicide prevention.").outcome,
    "REVIEW",
  );
  assert.equal(moderateText("k.i.l.l y.o.u.r.s.e.l.f").outcome, "BLOCK");
  assert.equal(moderateText("Ｉ ｗｉｌｌ ｋｉｌｌ ｙｏｕ").outcome, "BLOCK");
  assert.equal(
    moderateText("A snigger distracted me from the reading.").outcome,
    "ALLOW",
  );
});

test("reviewed content stays unshared until audited approval and hidden edits stay hidden", () => {
  const { db, service, ruth, admin } = setup();
  const { reflection } = service.createReflection(ruth, {
    reference: "John 3:16",
    body: "I hope we can have a careful conversation about suicide prevention.",
    visibility: "PUBLIC",
  });
  assert.equal(reflection.moderationStatus, "REVIEW");
  assert.throws(
    () => service.getReflection(reflection.id, null),
    errorStatus(404),
  );
  service.moderate(admin, {
    id: reflection.id,
    type: "reflection",
    action: "approve",
    note: "Supportive context reviewed.",
  });
  assert.equal(
    service.getReflection(reflection.id, null).moderationStatus,
    "APPROVED",
  );
  service.moderate(admin, {
    id: reflection.id,
    type: "reflection",
    action: "hide",
  });
  assert.equal(
    service.updateReflection(ruth, reflection.id, {
      body: "New text that still requires a steward's decision.",
    }).reflection.moderationStatus,
    "HIDDEN",
  );
  assert.ok(
    db.one(
      "SELECT id FROM moderation_events WHERE content_id=? AND outcome='HIDE'",
      reflection.id,
    ),
  );
});

test("server repeats moderation on comments, edits and profiles", () => {
  const { service, ruth, jonah } = setup();
  const abusive = "k.i.l.l y.o.u.r.s.e.l.f";
  assert.throws(
    () =>
      service.createReflection(ruth, { reference: "John 3:16", body: abusive }),
    errorStatus(422),
  );
  assert.throws(
    () => service.updateReflection(ruth, "quiet-moments", { body: abusive }),
    errorStatus(422),
  );
  assert.throws(
    () => service.addComment(jonah, "quiet-moments", { body: abusive }),
    errorStatus(422),
  );
  assert.throws(
    () => service.updateComment(jonah, "seed-comment", { body: abusive }),
    errorStatus(422),
  );
  assert.throws(
    () => service.updateSettings(ruth, { bio: abusive }),
    errorStatus(422),
  );
});

test("repeated-content anti-spam rejects an immediate duplicate", () => {
  const { service, ruth } = setup();
  const body = "A specific reflection that I should not send twice.";
  service.createReflection(ruth, { reference: "John 3:16", body });
  assert.throws(
    () =>
      service.createReflection(ruth, {
        reference: "John 3:16",
        body: body.toUpperCase(),
      }),
    errorStatus(429),
  );
});

test("theme and notification preferences persist and public profiles contain no preferences", () => {
  const { service, ruth } = setup();
  service.updateSettings(ruth, {
    theme: "dark",
    notifyFriends: false,
    notifyReactions: false,
  });
  assert.equal(service.user(ruth.id)!.theme, "dark");
  assert.equal(service.user(ruth.id)!.notifyFriends, false);
  const profile = service.profile(ruth.username, null).profile;
  assert.ok(!("theme" in profile));
  assert.ok(!("defaultVisibility" in profile));
  assert.ok(!("email" in profile));
});

test("daily curated verse is stable and fallback respects requested date", () => {
  const { service } = setup();
  assert.equal(
    service.daily().target.displayReference,
    service.daily().target.displayReference,
  );
  assert.equal(
    service.daily("2040-02-02").target.displayReference,
    service.daily("2040-02-02").target.displayReference,
  );
  assert.equal(service.daily("2040-02-02").date, "2040-02-02");
  assert.equal(
    getSiteDate(new Date("2026-09-10T02:00:00Z"), "America/New_York"),
    "2026-09-09",
  );
});

test("journal supports reference, title search, book, date, and biblical sorting", () => {
  const { service, ruth } = setup();
  const result = service.listReflections(
    ruth,
    new URLSearchParams({
      scope: "mine",
      reference: "John 3",
      q: "page just",
      sort: "biblical",
      from: "2020-01-01",
      to: "2099-12-31",
    }),
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "private-reflection");
  assert.equal(
    service.listReflections(null, new URLSearchParams({ q: "page just" })).items
      .length,
    0,
  );
});
