import { getEnv } from "./server/env";

/** Commerce receives catalog/cart data only. Never pass journal, profile, or reflection data here. */
export interface Product {
  id: string;
  variantId?: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  image: string;
  imageAlt: string;
  available: boolean;
}

export interface CommerceCatalog {
  mode: "demo" | "shopify";
  products: Product[];
  notice: string;
}

export interface CartItem {
  variantId: string;
  quantity: number;
}

export interface CommerceProvider {
  getCatalog(): Promise<CommerceCatalog>;
  createCheckout(items: CartItem[]): Promise<{ checkoutUrl: string }>;
}

export interface CommerceConfig {
  domain?: string;
  token?: string;
  apiVersion?: string;
  checkoutDomain?: string;
}

export class CommerceError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "CommerceError";
  }
}

export const demoProducts: readonly Product[] = [
  {
    id: "stillness-journal",
    title: "The Stillness Journal",
    description:
      "A little room for scripture, questions, and the things taking root.",
    price: 24,
    currency: "USD",
    category: "Journals",
    image: "/products/journal.svg",
    imageAlt:
      "Terracotta linen reflection journal with a small botanical cover design",
    available: true,
  },
  {
    id: "prayer-notebook",
    title: "One Quiet Page",
    description:
      "An everyday prayer notebook for gratitude, hope, and honest words.",
    price: 16,
    currency: "USD",
    category: "Journals",
    image: "/products/notebook.svg",
    imageAlt:
      "Sage green spiral notebook with a simple golden sun on the cover",
    available: true,
  },
  {
    id: "be-still-print",
    title: "Be Still, Art Print",
    description:
      "A warm, minimal reminder to make space for stillness. Unframed, 8 × 10 in.",
    price: 18,
    currency: "USD",
    category: "For your space",
    image: "/products/print.svg",
    imageAlt:
      "Cream art print featuring a sun, rolling hills, and the words be still",
    available: true,
  },
  {
    id: "morning-mug",
    title: "Slow Morning Mug",
    description:
      "A softly speckled ceramic companion for a passage and a warm drink.",
    price: 22,
    currency: "USD",
    category: "Everyday",
    image: "/products/mug.svg",
    imageAlt: "Warm ivory ceramic mug with a terracotta sun design",
    available: true,
  },
  {
    id: "rooted-tote",
    title: "Carry a Little Hope",
    description:
      "A natural cotton tote for your books, journal, and everyday wandering.",
    price: 20,
    currency: "USD",
    category: "Everyday",
    image: "/products/tote.svg",
    imageAlt: "Natural canvas tote bag with a sage botanical illustration",
    available: true,
  },
  {
    id: "grace-crewneck",
    title: "Room for Grace Crewneck",
    description:
      "An easy, soft sage layer with a small embroidered reminder of grace.",
    price: 42,
    currency: "USD",
    category: "Everyday",
    image: "/products/crewneck.svg",
    imageAlt: "Sage green crewneck sweatshirt with the word grace on the chest",
    available: true,
  },
  {
    id: "encouragement-cards",
    title: "Words to Keep & Give",
    description:
      "Twelve thoughtful encouragement cards for a friend or your own desk.",
    price: 14,
    currency: "USD",
    category: "Little encouragements",
    image: "/products/cards.svg",
    imageAlt:
      "A set of cream and terracotta encouragement cards with botanical designs",
    available: true,
  },
  {
    id: "quiet-stickers",
    title: "Small Reminders",
    description:
      "A sheet of gentle words and botanical stickers to brighten a journal page.",
    price: 8,
    currency: "USD",
    category: "Little encouragements",
    image: "/products/stickers.svg",
    imageAlt: "Sticker sheet with a sun, leaves, a heart, and gentle reminders",
    available: true,
  },
];

export class DemoCommerceProvider implements CommerceProvider {
  async getCatalog(): Promise<CommerceCatalog> {
    return {
      mode: "demo",
      products: demoProducts.map((product) => ({ ...product })),
      notice:
        "A collection in the making. These are sample products; checkout is not available yet.",
    };
  }

  async createCheckout(items: CartItem[]): Promise<{ checkoutUrl: string }> {
    void items;
    throw new CommerceError(
      "This is a sample collection. Checkout is not available yet.",
      409,
    );
  }
}

function validHostname(hostname: string): boolean {
  return (
    hostname.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      hostname,
    ) &&
    !/^\d+(?:\.\d+){3}$/.test(hostname)
  );
}

export function validateShopifyConfig(
  config: CommerceConfig,
): Required<Pick<CommerceConfig, "domain" | "token" | "apiVersion">> &
  Pick<CommerceConfig, "checkoutDomain"> {
  const domain = config.domain?.trim().toLowerCase() ?? "";
  const token = config.token?.trim() ?? "";
  const apiVersion = config.apiVersion ?? "2026-07";
  const checkoutDomain =
    config.checkoutDomain?.trim().toLowerCase() || undefined;
  if (
    !validHostname(domain) ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)
  ) {
    throw new CommerceError(
      "Configure SHOPIFY_STORE_DOMAIN as your store's example.myshopify.com hostname.",
      503,
    );
  }
  if (!token || /[\r\n]/.test(token))
    throw new CommerceError(
      "The Shopify storefront token is missing or invalid.",
      503,
    );
  if (!/^20\d{2}-(01|04|07|10)$/.test(apiVersion))
    throw new CommerceError(
      "Configure a stable Shopify API version in YYYY-MM form.",
      503,
    );
  if (checkoutDomain && !validHostname(checkoutDomain))
    throw new CommerceError(
      "The configured Shopify checkout hostname is invalid.",
      503,
    );
  return { domain, token, apiVersion, checkoutDomain };
}

export function validateCheckoutUrl(
  rawUrl: string,
  config: Pick<CommerceConfig, "domain" | "checkoutDomain">,
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CommerceError(
      "The shop returned an invalid checkout address.",
      502,
    );
  }
  const allowed = [
    config.domain,
    config.checkoutDomain,
    "checkout.shopify.com",
  ].filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !allowed.includes(url.hostname)
  ) {
    throw new CommerceError(
      "The shop returned an unrecognized checkout address.",
      502,
    );
  }
  return url.toString();
}

export function parseCartItems(input: unknown): CartItem[] {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray((input as { items?: unknown }).items)
  )
    throw new CommerceError("Choose an item before continuing to checkout.");
  const items = (input as { items: unknown[] }).items;
  if (!items.length || items.length > 20)
    throw new CommerceError("A checkout can contain between 1 and 20 items.");
  return items.map((item) => {
    if (!item || typeof item !== "object")
      throw new CommerceError("This cart item is invalid.");
    const { variantId, quantity } = item as Record<string, unknown>;
    if (
      typeof variantId !== "string" ||
      !/^gid:\/\/shopify\/ProductVariant\/\d{1,30}$/.test(variantId)
    )
      throw new CommerceError("Select an available product option.");
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10
    )
      throw new CommerceError("Choose a quantity between 1 and 10.");
    return { variantId, quantity };
  });
}

interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  productType: string;
  featuredImage: { url: string; altText?: string | null } | null;
  variants: {
    nodes: {
      id: string;
      availableForSale: boolean;
      price: { amount: string; currencyCode: string };
    }[];
  };
}

const CATALOG_QUERY = `query ReflectionShop { products(first: 24, sortKey: CREATED_AT, reverse: true) { nodes { id title description productType featuredImage { url altText } variants(first: 1) { nodes { id availableForSale price { amount currencyCode } } } } } }`;
const CHECKOUT_MUTATION = `mutation ReflectionCheckout($input: CartInput!) { cartCreate(input: $input) { cart { checkoutUrl } userErrors { code field message } } }`;

export class ShopifyCommerceProvider implements CommerceProvider {
  private readonly config: ReturnType<typeof validateShopifyConfig>;
  constructor(
    config: CommerceConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.config = validateShopifyConfig(config);
  }

  private async request<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.fetcher(
      `https://${this.config.domain}/api/${this.config.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": this.config.token,
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new CommerceError(
        "The shop is temporarily unavailable. Please try again later.",
        502,
      );
    const payload = (await response.json()) as { data?: T; errors?: unknown[] };
    if (!payload.data || payload.errors?.length)
      throw new CommerceError(
        "The shop could not complete this request. Please try again later.",
        502,
      );
    return payload.data;
  }

  async getCatalog(): Promise<CommerceCatalog> {
    const data = await this.request<{ products: { nodes: ShopifyProduct[] } }>(
      CATALOG_QUERY,
    );
    const products = data.products.nodes.flatMap((product): Product[] => {
      const variant = product.variants.nodes[0];
      if (!variant) return [];
      const price = Number(variant.price.amount);
      if (!Number.isFinite(price) || price < 0) return [];
      let image = "/products/journal.svg";
      if (product.featuredImage?.url) {
        try {
          const url = new URL(product.featuredImage.url);
          if (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.port &&
            [
              "cdn.shopify.com",
              this.config.domain,
              this.config.checkoutDomain,
            ].includes(url.hostname)
          )
            image = url.toString();
        } catch {
          /* The original illustration is a safe fallback. */
        }
      }
      return [
        {
          id: product.id,
          variantId: variant.id,
          title: product.title,
          description: product.description,
          price,
          currency: variant.price.currencyCode,
          category: product.productType || "For reflection",
          image,
          imageAlt: product.featuredImage?.altText || product.title,
          available: variant.availableForSale,
        },
      ];
    });
    return {
      mode: "shopify",
      products,
      notice:
        "Payments are completed securely through the shop's hosted Shopify checkout.",
    };
  }

  async createCheckout(input: CartItem[]): Promise<{ checkoutUrl: string }> {
    const items = parseCartItems({ items: input });
    const data = await this.request<{
      cartCreate: {
        cart: { checkoutUrl: string } | null;
        userErrors: unknown[];
      };
    }>(CHECKOUT_MUTATION, {
      input: {
        lines: items.map((item) => ({
          merchandiseId: item.variantId,
          quantity: item.quantity,
        })),
      },
    });
    if (data.cartCreate.userErrors.length || !data.cartCreate.cart)
      throw new CommerceError(
        "An item is unavailable or could not be added. Please refresh the shop and try again.",
        409,
      );
    return {
      checkoutUrl: validateCheckoutUrl(
        data.cartCreate.cart.checkoutUrl,
        this.config,
      ),
    };
  }
}

export function createCommerceProvider(
  config: CommerceConfig,
  fetcher: typeof fetch = fetch,
): CommerceProvider {
  if (!config.domain && !config.token) return new DemoCommerceProvider();
  return new ShopifyCommerceProvider(config, fetcher);
}

export function getCommerceProvider(): CommerceProvider {
  const env = getEnv();
  return createCommerceProvider({
    domain: env.SHOPIFY_STORE_DOMAIN,
    token: env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    apiVersion: env.SHOPIFY_API_VERSION,
    checkoutDomain: env.SHOPIFY_CHECKOUT_DOMAIN,
  });
}
