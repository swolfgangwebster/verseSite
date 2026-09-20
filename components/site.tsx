"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BookOpen,
  House,
  NotebookPen,
  Users,
  ShoppingBag,
  Moon,
  Sun,
  Settings,
  ArrowUpRight,
  Feather,
  Bell,
  ShieldCheck,
  X,
  Menu,
  LogOut,
} from "lucide-react";
import { api, AppContext, Bootstrap, initials, useResource } from "./client";
import {
  HomeScreen,
  BibleScreen,
  DailyHistoryScreen,
  JournalScreen,
  WriteScreen,
  DetailScreen,
} from "./reading";
import {
  FriendsScreen,
  ProfileScreen,
  SettingsScreen,
  LoginScreen,
  ModerationScreen,
  NotificationsScreen,
  ShopScreen,
} from "./community";

const navigation = [
  { label: "Home", href: "/", icon: House },
  { label: "Bible", href: "/bible", icon: BookOpen },
  { label: "Reflections", href: "/reflections", icon: NotebookPen },
  { label: "Friends", href: "/friends", icon: Users },
  { label: "Shop", href: "/shop", icon: ShoppingBag },
];

export function Site({ path }: { path: string[] }) {
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState("system");
  const state = useResource<Bootstrap>("bootstrap", revision);
  const boot = state.data;
  const route = path[0] || "home";
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    const drawer = document.querySelector<HTMLElement>(".sidebar");
    drawer?.querySelector<HTMLButtonElement>(".mobile-close")?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenu(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const controls = Array.from(
        drawer.querySelectorAll<HTMLElement>("a[href],button:not([disabled])"),
      ).filter((el) => el.getClientRects().length > 0);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [menu]);
  useEffect(() => {
    const preference =
      boot?.user?.theme || localStorage.getItem("stillword-theme") || "system";
    localStorage.setItem("stillword-theme", preference);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        preference === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preference;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [boot?.user?.theme, theme]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const refresh = () => setRevision((n) => n + 1);
  async function toggleTheme() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("stillword-theme", next);
    document.documentElement.dataset.theme = next;
    setTheme(next);
    if (boot?.user) {
      try {
        await api("settings", "PATCH", { theme: next });
        refresh();
      } catch (e) {
        setNotice((e as Error).message);
      }
    }
  }
  const title =
    navigation.find((item) => item.href === `/${route}`)?.label ||
    (route === "home"
      ? "Your daily pause"
      : route === "write"
        ? "A moment to reflect"
        : route === "profile"
          ? "Community"
          : route[0]?.toUpperCase() + route.slice(1));
  function content() {
    if (route === "home") return <HomeScreen />;
    if (route === "bible")
      return (
        <BibleScreen key={path.join("/")} reference={path.slice(1).join("/")} />
      );
    if (route === "daily") return <DailyHistoryScreen />;
    if (route === "reflections")
      return path[1] ? <DetailScreen id={path[1]} /> : <JournalScreen />;
    if (route === "write") return <WriteScreen />;
    if (route === "friends") return <FriendsScreen />;
    if (route === "profile")
      return <ProfileScreen username={path[1] || boot?.user?.username || ""} />;
    if (route === "settings") return <SettingsScreen />;
    if (route === "signin" || route === "auth") return <LoginScreen />;
    if (route === "moderation") return <ModerationScreen />;
    if (route === "notifications") return <NotificationsScreen />;
    if (route === "shop") return <ShopScreen />;
    return (
      <div className="empty-state">
        <BookOpen />
        <h1>This page is still unwritten.</h1>
        <p>Let’s find your way back to a familiar place.</p>
        <Link className="button primary" href="/">
          Return home
        </Link>
      </div>
    );
  }
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        className={`sidebar ${menu ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <Link href="/" className="wordmark" aria-label="Stillword home">
          stillword<span>✦</span>
        </Link>
        <div className="brand-caption">READ. REFLECT. GROW.</div>
        <button
          className="mobile-close icon-button"
          aria-label="Close menu"
          onClick={() => setMenu(false)}
        >
          <X size={20} />
        </button>
        <nav>
          {navigation.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                (route === "home" ? href === "/" : href === `/${route}`)
                  ? "page"
                  : undefined
              }
              onClick={() => setMenu(false)}
            >
              <Icon size={20} strokeWidth={1.65} />
              <span>{label}</span>
              {label === "Shop" && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <Link
          href="/write"
          className="button primary nav-write"
          onClick={() => setMenu(false)}
        >
          <Feather size={18} /> Write a reflection
        </Link>
        <div className="sidebar-note">
          <Sprig />
          <p>
            Let the words settle.
            <br />
            Let your heart respond.
          </p>
          <span>A LITTLE ROOM FOR WHAT MATTERS</span>
        </div>
        <div className="sidebar-bottom">
          <button className="theme-toggle" onClick={toggleTheme}>
            <Moon size={19} className="moon-icon" />
            <Sun size={19} className="sun-icon" />
            <span>Change theme</span>
            <span className="theme-switch" />
          </button>
          {boot?.user ? (
            <>
              <Link href="/settings" className="account">
                <span className="avatar">
                  {initials(boot.user.displayName)}
                </span>
                <span>
                  <strong>{boot.user.displayName}</strong>
                  <small>Your quiet corner</small>
                </span>
                <Settings size={17} />
              </Link>
              <button
                className="text-button signout"
                onClick={async () => {
                  try {
                    await api("auth/logout", "POST", {});
                    refresh();
                    setNotice("You’re signed out.");
                  } catch (e) {
                    setNotice((e as Error).message);
                  }
                }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </>
          ) : (
            <Link href="/signin" className="account">
              <span className="avatar">
                <Users size={18} />
              </span>
              <span>
                <strong>Make yourself at home</strong>
                <small>Sign in to begin</small>
              </span>
              <ArrowUpRight size={18} />
            </Link>
          )}
        </div>
      </aside>
      {menu && (
        <button
          className="menu-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="workspace" inert={menu}>
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu"
              aria-label="Open menu"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Stillword <span>/</span>
            </span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="welcome-line">
              A slower moment. A deeper meaning.
            </span>
            {boot?.user?.role === "MODERATOR" && (
              <Link
                className="icon-button"
                href="/moderation"
                aria-label="Moderation queue"
              >
                <ShieldCheck size={20} />
              </Link>
            )}
            <Link
              href={boot?.user ? "/notifications" : "/signin"}
              className="icon-button notification-link"
              aria-label="Notifications"
            >
              <Bell size={20} />
              {boot?.notifications.some((n) => !n.read) && <i />}
            </Link>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label="Toggle light and dark theme"
            >
              <Moon size={19} className="moon-icon" />
              <Sun size={19} className="sun-icon" />
            </button>
          </div>
        </header>
        <main id="main" className={`main-content route-${route}`}>
          {state.error ? (
            <div className="empty-state" role="alert">
              <h1>We couldn’t open your quiet corner.</h1>
              <p>{state.error}</p>
              <button className="button primary" onClick={refresh}>
                Try again
              </button>
            </div>
          ) : boot ? (
            <AppContext.Provider
              value={{ boot, revision, refresh, announce: setNotice }}
            >
              {content()}
            </AppContext.Provider>
          ) : (
            <div className="loading-state" role="status">
              <span className="loading-leaf">✦</span>
              <p>Making room for reflection…</p>
            </div>
          )}
        </main>
        <footer className="site-footer">
          <span className="footer-brand">
            stillword<span>✦</span>
          </span>
          <span>
            A little space for the Word. A little grace for the journey.
          </span>
          <Link href="/bible">World English Bible · Public domain</Link>
        </footer>
      </div>
      <div
        className={`toast ${notice ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {notice}
      </div>
    </>
  );
}

export function Sprig() {
  return (
    <svg viewBox="0 0 140 110" fill="none" aria-hidden="true" className="sprig">
      <path
        d="M22 101C55 76 67 44 113 12M52 75C40 67 30 58 28 43M73 48C61 39 57 24 60 12M82 39C98 42 119 38 128 28M62 62C80 68 101 63 111 52"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M42 65C23 66 21 51 28 43C40 45 46 54 42 65ZM67 35C49 32 51 17 60 12C70 17 74 27 67 35ZM85 39C94 21 114 21 128 28C117 43 101 49 85 39ZM67 63C79 47 99 44 111 52C100 68 83 75 67 63ZM96 25C91 10 99 1 113 4C116 16 111 25 96 25Z"
        fill="currentColor"
        opacity=".16"
      />
    </svg>
  );
}
