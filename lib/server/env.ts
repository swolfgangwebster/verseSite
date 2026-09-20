import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("production"),
  DEV_AUTH: z.enum(["true", "false"]).default("false"),
  DB_PATH: z.string().min(1).default(".data/verse.sqlite"),
  SITE_TIMEZONE: z.string().default("America/New_York"),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  SHOPIFY_STORE_DOMAIN: z.string().optional(),
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default("2026-07"),
  SHOPIFY_CHECKOUT_DOMAIN: z.string().optional(),
});

export function getEnv() {
  const env = schema.parse(process.env);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: env.SITE_TIMEZONE }).format();
  } catch {
    throw new Error("SITE_TIMEZONE must be a valid IANA timezone.");
  }
  return {
    ...env,
    developmentAuth: env.APP_ENV === "development" && env.DEV_AUTH === "true",
  };
}
