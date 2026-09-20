import {
  CommerceError,
  getCommerceProvider,
  parseCartItems,
} from "@/lib/commerce";
import { getEnv } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readCart(request: Request): Promise<unknown> {
  const maximumBytes = 8_192;
  if (Number(request.headers.get("content-length")) > maximumBytes)
    throw new CommerceError("This cart is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CommerceError("This cart is invalid.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new CommerceError("This cart is too large.", 413);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw new CommerceError("This cart is invalid.");
  }
}

function fail(error: unknown): Response {
  return Response.json(
    {
      error:
        error instanceof CommerceError
          ? error.message
          : "The shop is temporarily unavailable. Please try again later.",
    },
    {
      status: error instanceof CommerceError ? error.status : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getCommerceProvider().getCatalog(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(getEnv().APP_ORIGIN).origin)
      throw new CommerceError(
        "Please start checkout from this site's shop.",
        403,
      );
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      throw new CommerceError("Send the cart as JSON.", 415);
    const payload = await readCart(request);
    return Response.json(
      await getCommerceProvider().createCheckout(parseCartItems(payload)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
