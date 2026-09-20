import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CommerceError,
  createCommerceProvider,
  DemoCommerceProvider,
  parseCartItems,
  ShopifyCommerceProvider,
  validateCheckoutUrl,
  validateShopifyConfig,
} from "../lib/commerce";
import { POST } from "../app/api/shop/route";

const config = {
  domain: "quiet-example.myshopify.com",
  token: "test-storefront-token",
  apiVersion: "2026-07",
};
const variantId = "gid://shopify/ProductVariant/123456";

test("shop without credentials supplies eight honest demo products and no checkout", async () => {
  const provider = createCommerceProvider({});
  assert.ok(provider instanceof DemoCommerceProvider);
  const catalog = await provider.getCatalog();
  assert.equal(catalog.mode, "demo");
  assert.equal(catalog.products.length, 8);
  assert.match(catalog.notice, /sample products.*checkout is not available/i);
  assert.equal(new Set(catalog.products.map((product) => product.id)).size, 8);
  for (const product of catalog.products) {
    assert.ok(
      product.title &&
        product.description &&
        product.category &&
        product.imageAlt,
    );
    assert.ok(product.price > 0);
    assert.ok(existsSync(path.join(process.cwd(), "public", product.image)));
  }
  await assert.rejects(
    provider.createCheckout([{ variantId, quantity: 1 }]),
    (error: unknown) => error instanceof CommerceError && error.status === 409,
  );
  catalog.products[0].title = "Changed by a caller";
  assert.notEqual(
    (await provider.getCatalog()).products[0].title,
    "Changed by a caller",
  );
});

test("incomplete Shopify configuration fails clearly instead of silently enabling demo checkout", () => {
  assert.throws(
    () => createCommerceProvider({ domain: config.domain }),
    CommerceError,
  );
  assert.throws(
    () => createCommerceProvider({ token: config.token }),
    CommerceError,
  );
});

test("Shopify configuration pins a trusted API hostname and stable version", () => {
  assert.deepEqual(
    validateShopifyConfig({
      ...config,
      domain: " QUIET-EXAMPLE.MYSHOPIFY.COM ",
    }),
    { ...config, checkoutDomain: undefined },
  );
  for (const domain of [
    "localhost",
    "127.0.0.1",
    "https://quiet-example.myshopify.com",
    "quiet-example.myshopify.com.evil.test",
    "user@quiet-example.myshopify.com",
    "quiet-example.myshopify.com/path",
  ]) {
    assert.throws(
      () => validateShopifyConfig({ ...config, domain }),
      CommerceError,
    );
  }
  assert.throws(
    () => validateShopifyConfig({ ...config, apiVersion: "unstable" }),
    CommerceError,
  );
  assert.throws(
    () => validateShopifyConfig({ ...config, token: "token\nheader" }),
    CommerceError,
  );
  assert.throws(
    () => validateShopifyConfig({ ...config, checkoutDomain: "127.0.0.1" }),
    CommerceError,
  );
});

test("cart schema admits only bounded Shopify variants and quantities", () => {
  assert.deepEqual(
    parseCartItems({
      items: [{ variantId, quantity: 2, reflection: "never forwarded" }],
      body: "never forwarded",
    }),
    [{ variantId, quantity: 2 }],
  );
  for (const input of [
    null,
    {},
    { items: [] },
    { items: [{ variantId: "demo", quantity: 1 }] },
    { items: [{ variantId, quantity: 0 }] },
    { items: [{ variantId, quantity: 11 }] },
    { items: [{ variantId, quantity: 1.5 }] },
    { items: [{ variantId, quantity: "1" }] },
    { items: Array(21).fill({ variantId, quantity: 1 }) },
  ]) {
    assert.throws(() => parseCartItems(input), CommerceError);
  }
});

test("checkout URL must use HTTPS on a configured hosted checkout hostname", () => {
  assert.equal(
    validateCheckoutUrl(`https://${config.domain}/cart/c/example`, config),
    `https://${config.domain}/cart/c/example`,
  );
  assert.equal(
    validateCheckoutUrl("https://shop.example.test/checkouts/example", {
      ...config,
      checkoutDomain: "shop.example.test",
    }),
    "https://shop.example.test/checkouts/example",
  );
  for (const url of [
    "javascript:alert(1)",
    "http://quiet-example.myshopify.com/checkout",
    "https://quiet-example.myshopify.com.evil.test/checkout",
    "https://other-store.myshopify.com/checkout",
    "https://user:password@quiet-example.myshopify.com/checkout",
    "https://quiet-example.myshopify.com:8443/checkout",
  ]) {
    assert.throws(() => validateCheckoutUrl(url, config), CommerceError);
  }
});

test("Shopify catalog maps actual variant pricing and rejects unsafe imagery", async () => {
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    assert.equal(input, `https://${config.domain}/api/2026-07/graphql.json`);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.equal(
      (init?.headers as Record<string, string>)[
        "X-Shopify-Storefront-Access-Token"
      ],
      config.token,
    );
    return Response.json({
      data: {
        products: {
          nodes: [
            {
              id: "product1",
              title: "Journal",
              description: "Room to reflect",
              productType: "Journals",
              featuredImage: { url: "javascript:alert(1)", altText: "Journal" },
              variants: {
                nodes: [
                  {
                    id: variantId,
                    availableForSale: true,
                    price: { amount: "24.00", currencyCode: "USD" },
                  },
                ],
              },
            },
          ],
        },
      },
    });
  }) as typeof fetch;
  const catalog = await new ShopifyCommerceProvider(
    config,
    fetcher,
  ).getCatalog();
  assert.equal(catalog.mode, "shopify");
  assert.equal(catalog.products[0].price, 24);
  assert.equal(catalog.products[0].variantId, variantId);
  assert.equal(catalog.products[0].image, "/products/journal.svg");
});

test("Shopify hosted checkout forwards only cart lines, never sensitive content", async () => {
  const fetcher = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const sent = JSON.parse(String(init?.body));
    assert.deepEqual(sent.variables, {
      input: { lines: [{ merchandiseId: variantId, quantity: 1 }] },
    });
    assert.match(sent.query, /cartCreate/);
    return Response.json({
      data: {
        cartCreate: {
          cart: { checkoutUrl: `https://${config.domain}/cart/c/test` },
          userErrors: [],
        },
      },
    });
  }) as typeof fetch;
  const provider = new ShopifyCommerceProvider(config, fetcher);
  const checkout = await provider.createCheckout([{ variantId, quantity: 1 }]);
  assert.equal(checkout.checkoutUrl, `https://${config.domain}/cart/c/test`);
});

test("provider errors do not echo vendor details or credentials", async () => {
  const fetcher = (async () =>
    Response.json({
      errors: [{ message: "sensitive vendor detail" }],
    })) as typeof fetch;
  await assert.rejects(
    new ShopifyCommerceProvider(config, fetcher).getCatalog(),
    (error: unknown) =>
      error instanceof CommerceError && !error.message.includes("sensitive"),
  );
});

test("shop endpoint rejects cross-origin mutations before reading a cart", async () => {
  const response = await POST(
    new Request("http://localhost:3000/api/shop", {
      method: "POST",
      headers: {
        origin: "https://other.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ items: [{ variantId, quantity: 1 }] }),
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("shop endpoint validates JSON and payload size server-side", async () => {
  const headers = {
    origin: "http://localhost:3000",
    "content-type": "application/json",
  };
  assert.equal(
    (
      await POST(
        new Request("http://localhost:3000/api/shop", {
          method: "POST",
          headers,
          body: "{",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost:3000/api/shop", {
          method: "POST",
          headers,
          body: " ".repeat(8193),
        }),
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost:3000/api/shop", {
          method: "POST",
          headers,
          body: JSON.stringify({ items: [{ variantId, quantity: -1 }] }),
        }),
      )
    ).status,
    400,
  );
});
