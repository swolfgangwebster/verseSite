import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getBooks, getPassage } from "@/lib/bible";
import { getDatabase } from "@/lib/server/db";
import { CommunityService, DomainError } from "@/lib/server/domain";
import { getEnv } from "@/lib/server/env";
import { moderateText } from "@/lib/server/moderation";
import type { User } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookieName = "stillword_session";
type Context = { params: Promise<{ path: string[] }> };
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
const signedIn = (user: User | null) => {
  if (!user) throw new DomainError(401, "Sign in to continue.");
  return user;
};
function verifyOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const configured = new URL(getEnv().APP_ORIGIN).origin;
  // APP_ORIGIN is explicit deployment configuration; untrusted Host headers never grant access.
  if (!origin || origin !== configured)
    throw new DomainError(
      403,
      "This request could not be verified. Refresh the page and try again.",
    );
  const contentType = request.headers.get("content-type") || "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new DomainError(415, "Send this request as JSON.");
}
async function readBody(request: NextRequest) {
  if (Number(request.headers.get("content-length") || "0") > 65536)
    throw new DomainError(413, "This submission is too large.");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) {
        await reader.cancel();
        throw new DomainError(413, "This submission is too large.");
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new DomainError(400, "This request contains invalid JSON.");
  }
}

async function handle(request: NextRequest, context: Context) {
  try {
    const { path } = await context.params;
    const [resource, id, subresource] = path;
    const service = new CommunityService(getDatabase());
    const token = request.cookies.get(cookieName)?.value;
    const user = service.currentUser(token);
    const params = request.nextUrl.searchParams;
    const method = request.method;
    if (method === "GET") {
      if (resource === "bootstrap")
        return json({
          user,
          users: service.developmentUsers(),
          daily: service.daily(),
          books: getBooks(),
          notifications: user ? service.notifications(user) : [],
          developmentAuth: getEnv().developmentAuth,
        });
      if (resource === "bible") {
        const reference = params.get("reference") || "Psalms 46";
        const passage = getPassage(service.parseTarget(reference));
        const offset = Math.max(
          0,
          Math.min(
            50000,
            Number.parseInt(params.get("offset") || "", 10) ||
              ((Number.parseInt(params.get("page") || "1", 10) || 1) - 1) * 100,
          ),
        );
        return json({
          ...passage,
          verses: passage.verses.slice(offset, offset + 100),
          total: passage.verses.length,
          offset,
          hasMore: passage.verses.length > offset + 100,
        });
      }
      if (resource === "daily")
        return json({
          ...service.daily(params.get("date") || undefined),
          history: service.dailyHistory(),
        });
      if (resource === "reflections" && id) {
        if (subresource === "comments")
          return json(
            service.listComments(
              id,
              user,
              Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1),
            ),
          );
        return json({
          reflection: service.getReflection(id, user),
          comments: service.listComments(
            id,
            user,
            Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1),
          ),
        });
      }
      if (resource === "reflections")
        return json(service.listReflections(user, params));
      if (resource === "friends") return json(service.friends(signedIn(user)));
      if (resource === "people")
        return json(service.people(signedIn(user), params));
      if (resource === "profiles" && id)
        return json(service.profile(id, user, params));
      if (resource === "settings") return json({ user: signedIn(user) });
      if (resource === "notifications")
        return json({ items: service.notifications(signedIn(user)) });
      if (resource === "moderation")
        return json(
          service.moderationQueue(
            signedIn(user),
            Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1),
          ),
        );
      throw new DomainError(404, "This page is unavailable.");
    }
    verifyOrigin(request);
    const input = await readBody(request);
    const env = getEnv();
    // Without a configured trusted reverse proxy, one conservative shared IP bucket is intentional.
    const ip =
      env.TRUST_PROXY === "true"
        ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown"
        : "direct";
    if (resource === "auth" && method === "POST") {
      service.rateLimit(user, ip, "auth");
      if (id === "login") {
        const data = z
          .object({ userId: z.string().min(1).max(100) })
          .strict()
          .parse(input);
        const result = service.signIn(data.userId);
        service.signOut(token);
        const response = json({ user: result.user });
        response.cookies.set(cookieName, result.token, {
          httpOnly: true,
          sameSite: "lax",
          secure:
            env.APP_ENV === "production" ||
            new URL(env.APP_ORIGIN).protocol === "https:",
          path: "/",
          maxAge: 7 * 86400,
        });
        return response;
      }
      if (id === "logout") {
        z.object({}).strict().parse(input);
        service.signOut(token);
        const response = json({ ok: true });
        response.cookies.set(cookieName, "", {
          maxAge: 0,
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
        return response;
      }
    }
    const actor = signedIn(user);
    if (resource === "moderation" && id === "check" && method === "POST") {
      service.rateLimit(actor, ip, "preview");
      const { body } = z
        .object({ body: z.string().max(12120) })
        .strict()
        .parse(input);
      const result = moderateText(body);
      return json({ outcome: result.outcome, message: result.message });
    }
    if (resource === "reflections") {
      if (id && subresource === "comments" && method === "POST") {
        service.rateLimit(actor, ip, "comment");
        return json(service.addComment(actor, id, input), 201);
      }
      if (id && subresource === "reactions" && method === "POST") {
        service.rateLimit(actor, ip, "reaction");
        return json({ reflection: service.react(actor, id, input) });
      }
      service.rateLimit(actor, ip, "reflection");
      if (!id && method === "POST")
        return json(service.createReflection(actor, input), 201);
      if (id && !subresource && method === "PATCH")
        return json(service.updateReflection(actor, id, input));
      if (id && !subresource && method === "DELETE") {
        z.object({}).strict().parse(input);
        service.deleteReflection(actor, id);
        return json({ ok: true });
      }
    }
    if (resource === "comments" && id) {
      service.rateLimit(actor, ip, "comment");
      if (method === "PATCH")
        return json(service.updateComment(actor, id, input));
      if (method === "DELETE") {
        z.object({}).strict().parse(input);
        service.deleteComment(actor, id);
        return json({ ok: true });
      }
    }
    if (resource === "friends" && method === "POST") {
      service.rateLimit(actor, ip, "friendship");
      return json(service.changeFriendship(actor, input));
    }
    if (resource === "reports" && method === "POST") {
      service.rateLimit(actor, ip, "report");
      service.report(actor, input);
      return json({ ok: true }, 201);
    }
    if (resource === "settings" && method === "PATCH") {
      service.rateLimit(actor, ip, "settings");
      return json({ user: service.updateSettings(actor, input) });
    }
    if (resource === "notifications" && method === "POST") {
      service.rateLimit(actor, ip, "notification");
      service.readNotifications(actor, input);
      return json({ ok: true });
    }
    if (resource === "moderation" && method === "POST") {
      service.rateLimit(actor, ip, "moderation");
      service.moderate(actor, input);
      return json({ ok: true });
    }
    throw new DomainError(404, "This action is unavailable.");
  } catch (error) {
    if (error instanceof DomainError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues.map((issue) => issue.message).join(" ") },
        400,
      );
    // Never log request bodies, query text, session tokens, or database errors containing private content.
    console.error("Community API operation failed.");
    return json(
      { error: "Something went wrong. Please try again shortly." },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
