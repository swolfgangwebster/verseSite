"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { BibleBook, Passage } from "@/lib/bible";
import type { Notification, User } from "@/lib/types";

export interface Bootstrap {
  user: User | null;
  users: User[];
  daily: Passage & { date: string; source: string };
  books: BibleBook[];
  notifications: Notification[];
  developmentAuth: boolean;
}
export const AppContext = createContext<{
  boot: Bootstrap;
  revision: number;
  refresh: () => void;
  announce: (message: string) => void;
} | null>(null);
export function useApp() {
  const app = useContext(AppContext);
  if (!app) throw new Error("App context required");
  return app;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (method !== "GET" && body === undefined) body = {};
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Something went wrong. Please try again.");
  return result as T;
}
export function useResource<T>(url: string | null, revision = 0) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    key?: string;
    loading: boolean;
  }>({ loading: true });
  const key = `${url}:${revision}`;
  useEffect(() => {
    if (!url) return;
    let active = true;
    api<T>(url).then(
      (data) => {
        if (active) setState({ data, key, loading: false });
      },
      (error) => {
        if (active) setState({ error: error.message, key, loading: false });
      },
    );
    return () => {
      active = false;
    };
  }, [url, revision, key]);
  return state.key === key
    ? state
    : { loading: Boolean(url), data: undefined, error: undefined };
}
export function readableDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
export function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
}
