"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  Globe2,
  Heart,
  LockKeyhole,
  Search,
  ShieldCheck,
  ShoppingBag,
  UserPlus,
  Users,
  X,
  Leaf,
} from "lucide-react";
import type {
  FriendsResult,
  Page,
  PublicProfile,
  Reflection,
  RelationshipUser,
  User,
} from "@/lib/types";
import type { CommerceCatalog, Product } from "@/lib/commerce";
import { api, initials, readableDate, useApp, useResource } from "./client";
import {
  AuthInvitation,
  Empty,
  ErrorNotice,
  PageHeading,
  Pagination,
  ReflectionCard,
} from "./reading";

export function LoginScreen() {
  const { boot, refresh, announce } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login(userId: string) {
    setBusy(true);
    try {
      await api("auth/login", "POST", { userId });
      refresh();
      announce("Welcome. Make yourself at home.");
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="COME AS YOU ARE"
        title="Your quiet corner is waiting."
        description="Keep your thoughts close, and share when you feel ready."
      />
      <div className="auth-panel panel">
        <div className="auth-symbol">
          <Leaf size={37} strokeWidth={1.2} />
        </div>
        <h2>A little space to begin.</h2>
        <p>Read, reflect, and find a thoughtful community.</p>
        <ErrorNotice message={error} />
        {boot.developmentAuth ? (
          <>
            <div className="demo-notice">
              <ShieldCheck size={18} />
              <div>
                <strong>Local development sign-in</strong>
                <p>
                  These are fictional demo accounts. Choose one to explore the
                  site. This sign-in method must be replaced before public
                  launch.
                </p>
              </div>
            </div>
            <div className="demo-accounts">
              {boot.users.map((user) => (
                <button
                  disabled={busy}
                  key={user.id}
                  onClick={() => login(user.id)}
                >
                  <span className="avatar">{initials(user.displayName)}</span>
                  <span>
                    <strong>{user.displayName}</strong>
                    <small>
                      @{user.username}
                      {user.role === "MODERATOR" ? " · Site steward" : ""}
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <Empty title="Sign-in is not configured yet.">
            You can still read Scripture and public reflections. The site owner
            needs to connect a production authentication provider.
          </Empty>
        )}
        <Link href="/" className="text-link">
          Continue as a guest <ArrowRight size={15} />
        </Link>
      </div>
    </>
  );
}

function PersonCard({ person }: { person: RelationshipUser }) {
  const { refresh, announce } = useApp();
  const [busy, setBusy] = useState(false);
  async function action(action: string) {
    if (
      (action === "block" || action === "remove") &&
      !confirm(
        action === "block"
          ? `Block ${person.displayName}? This removes your friendship and hides your content from each other.`
          : `Remove ${person.displayName} from your friends? They will lose access to your friends-only reflections.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api("friends", "POST", { action, userId: person.id });
      announce(
        action === "request"
          ? "Friend request sent."
          : "Your connection has been updated.",
      );
      refresh();
    } catch (e) {
      announce((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="person-card">
      <Link href={`/profile/${person.username}`} className="avatar large">
        {initials(person.displayName)}
      </Link>
      <h3>
        <Link href={`/profile/${person.username}`}>{person.displayName}</Link>
      </h3>
      <span className="person-handle">@{person.username}</span>
      <p>{person.bio || "Finding meaning, one passage at a time."}</p>
      <div className="person-actions">
        {person.relationship === "NONE" && (
          <button
            className="button subtle"
            disabled={busy}
            onClick={() => action("request")}
          >
            <UserPlus size={15} />
            Add friend
          </button>
        )}
        {person.relationship === "INCOMING" && (
          <>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => action("accept")}
            >
              <Check size={15} />
              Accept
            </button>
            <button
              className="icon-button"
              aria-label={`Decline ${person.displayName}’s request`}
              disabled={busy}
              onClick={() => action("decline")}
            >
              <X size={17} />
            </button>
          </>
        )}
        {person.relationship === "OUTGOING" && (
          <button
            className="button subtle"
            disabled={busy}
            onClick={() => action("cancel")}
          >
            Cancel request
          </button>
        )}
        {person.relationship === "FRIEND" && (
          <button
            className="button subtle"
            disabled={busy}
            onClick={() => action("remove")}
          >
            <CheckCheck size={15} />
            Friends · Remove
          </button>
        )}
        {person.relationship === "BLOCKED" ? (
          <button
            className="button subtle"
            disabled={busy}
            onClick={() => action("unblock")}
          >
            Unblock
          </button>
        ) : (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action("block")}
          >
            Block
          </button>
        )}
      </div>
    </article>
  );
}
export function FriendsScreen() {
  const { boot, revision } = useApp();
  const [tab, setTab] = useState<keyof FriendsResult | "discover">("friends");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const relations = useResource<FriendsResult>(
    boot.user ? "friends" : null,
    revision,
  );
  const people = useResource<Page<RelationshipUser>>(
    boot.user && tab === "discover"
      ? `people?q=${encodeURIComponent(query)}&page=${page}`
      : null,
    revision,
  );
  const persons =
    tab === "discover" ? people.data?.items : relations.data?.[tab];
  return (
    <>
      <PageHeading
        eyebrow="WALK A LITTLE WAY TOGETHER"
        title="Good company for the journey."
        description="Thoughtful connections, shared reflections, and room to be yourself."
      />
      {!boot.user ? (
        <AuthInvitation />
      ) : (
        <>
          <div className="friends-banner">
            <Users size={24} strokeWidth={1.3} />
            <p>
              Friendship goes both ways. When a request is accepted, you can
              read each other’s friends-only reflections.
            </p>
          </div>
          <div className="friends-toolbar">
            <div className="tabs">
              {(
                [
                  ["friends", "My friends"],
                  ["incoming", "Incoming"],
                  ["outgoing", "Sent"],
                  ["discover", "Find people"],
                  ["blocked", "Blocked"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? "active" : ""}
                  onClick={() => setTab(id)}
                >
                  {label}
                  {id === "incoming" &&
                    Boolean(relations.data?.incoming.length) && (
                      <span className="count-pill">
                        {relations.data?.incoming.length}
                      </span>
                    )}
                </button>
              ))}
            </div>
            {tab === "discover" && (
              <div className="search-field">
                <Search size={18} />
                <input
                  aria-label="Search people"
                  placeholder="Name or username…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            )}
          </div>
          <ErrorNotice message={relations.error || people.error} />
          {!persons ? (
            <p role="status">Finding your people…</p>
          ) : persons.length ? (
            <div className="people-grid">
              {persons.map((person) => (
                <PersonCard key={person.id} person={person} />
              ))}
            </div>
          ) : (
            <Empty
              title={
                tab === "friends"
                  ? "There’s room in your circle."
                  : tab === "blocked"
                    ? "No blocked people."
                    : "Nothing here just yet."
              }
            >
              {tab === "friends"
                ? "Find someone you know, or let a thoughtful reflection introduce you."
                : "You’re all caught up."}
            </Empty>
          )}
          {tab === "discover" && (
            <Pagination
              page={page}
              hasMore={Boolean(people.data?.hasMore)}
              onChange={setPage}
            />
          )}
        </>
      )}
    </>
  );
}
export function ProfileScreen({ username }: { username: string }) {
  const { boot, revision } = useApp();
  const [page, setPage] = useState(1);
  const { data, error, loading } = useResource<{
    profile: PublicProfile;
    relationship: RelationshipUser["relationship"];
    reflections: Page<Reflection>;
  }>(`profiles/${encodeURIComponent(username)}?page=${page}`, revision);
  if (error)
    return (
      <>
        <PageHeading
          eyebrow="COMMUNITY"
          title="This profile isn’t available."
          description="Return to your circle or discover a new passage."
        />
        <ErrorNotice message={error} />
      </>
    );
  if (loading || !data) return <p role="status">Opening this profile…</p>;
  return (
    <>
      <PageHeading
        eyebrow="A FELLOW TRAVELER"
        title={data.profile.displayName}
        description={`@${data.profile.username} · Here since ${readableDate(data.profile.createdAt)}`}
      />
      <div className="profile-layout">
        <aside>
          {boot.user && boot.user.id !== data.profile.id ? (
            <PersonCard
              person={{ ...data.profile, relationship: data.relationship }}
            />
          ) : (
            <div className="person-card">
              <span className="avatar large">
                {initials(data.profile.displayName)}
              </span>
              <h2>{data.profile.displayName}</h2>
              <p>{data.profile.bio}</p>
              {boot.user?.id === data.profile.id && (
                <Link href="/settings" className="button subtle">
                  Edit profile
                </Link>
              )}
            </div>
          )}
        </aside>
        <section>
          <div className="section-title">
            <h2>Reflections along the way</h2>
            <LockKeyhole size={16} />
          </div>
          {data.reflections.items.length ? (
            data.reflections.items.map((r) => (
              <ReflectionCard key={r.id} reflection={r} />
            ))
          ) : (
            <Empty title="A quiet page, for now.">
              Reflections shared with you will appear here.
            </Empty>
          )}
          <Pagination
            page={page}
            hasMore={data.reflections.hasMore}
            onChange={setPage}
          />
        </section>
      </div>
    </>
  );
}

export function SettingsScreen() {
  const { boot } = useApp();
  return (
    <>
      <PageHeading
        eyebrow="MAKE THIS SPACE YOURS"
        title="A few things, just for you."
        description="Your profile, your preferences, your pace."
      />
      {boot.user ? (
        <SettingsForm key={boot.user.id} user={boot.user} />
      ) : (
        <AuthInvitation />
      )}
    </>
  );
}
function SettingsForm({ user }: { user: User }) {
  const { announce, refresh } = useApp();
  const [form, setForm] = useState({
    displayName: user.displayName,
    username: user.username,
    bio: user.bio,
    defaultVisibility: user.defaultVisibility,
    defaultComments: user.defaultComments,
    defaultReactions: user.defaultReactions,
    theme: user.theme,
    notifyFriends: user.notifyFriends,
    notifyComments: user.notifyComments,
    notifyReactions: user.notifyReactions,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("settings", "PATCH", form);
      localStorage.setItem("stillword-theme", form.theme);
      announce("Your preferences are saved.");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="settings-form" onSubmit={save}>
      <section className="panel">
        <h2>Your profile</h2>
        <p className="muted">
          A small introduction. No email address is shared publicly.
        </p>
        <div className="form-grid">
          <label>
            Display name
            <input
              required
              value={form.displayName}
              onChange={(e) =>
                setForm({ ...form, displayName: e.target.value })
              }
              minLength={2}
              maxLength={60}
            />
          </label>
          <label>
            Username
            <input
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              pattern="[a-zA-Z0-9_]{3,24}"
            />
          </label>
        </div>
        <label>
          A little about you
          <textarea
            rows={3}
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            maxLength={300}
          />
        </label>
      </section>
      <section className="panel">
        <h2>Privacy & interactions</h2>
        <p className="muted">
          Defaults for new reflections. Existing reflections keep their own
          settings.
        </p>
        <label>
          Default visibility
          <select
            value={form.defaultVisibility}
            onChange={(e) =>
              setForm({
                ...form,
                defaultVisibility: e.target.value as User["defaultVisibility"],
              })
            }
          >
            <option value="PRIVATE">Only me — a private journal</option>
            <option value="FRIENDS">My accepted friends</option>
            <option value="PUBLIC">Everyone — public</option>
          </select>
        </label>
        <div className="settings-checks">
          <label>
            <input
              type="checkbox"
              checked={form.defaultComments}
              onChange={(e) =>
                setForm({ ...form, defaultComments: e.target.checked })
              }
            />
            Allow comments on new reflections
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.defaultReactions}
              onChange={(e) =>
                setForm({ ...form, defaultReactions: e.target.checked })
              }
            />
            Allow reactions on new reflections
          </label>
        </div>
      </section>
      <section className="panel">
        <h2>The light in your space</h2>
        <p className="muted">
          Warm daylight, a quiet night sky, or follow your device.
        </p>
        <fieldset className="theme-options">
          <legend className="sr-only">Theme</legend>
          {(["light", "dark", "system"] as const).map((theme) => (
            <label
              key={theme}
              className={form.theme === theme ? "selected" : ""}
            >
              <input
                type="radio"
                name="theme"
                checked={form.theme === theme}
                onChange={() => setForm({ ...form, theme })}
              />
              <span className={`theme-preview ${theme}`} />
              <strong>
                {theme === "system"
                  ? "Follow system"
                  : theme === "light"
                    ? "Warm daylight"
                    : "Quiet night"}
              </strong>
            </label>
          ))}
        </fieldset>
      </section>
      <section className="panel">
        <h2>A gentle heads-up</h2>
        <p className="muted">
          In-app notifications only. No email or push messages are sent.
        </p>
        <div className="settings-checks">
          <label>
            <input
              type="checkbox"
              checked={form.notifyFriends}
              onChange={(e) =>
                setForm({ ...form, notifyFriends: e.target.checked })
              }
            />
            Friend requests and accepted invitations
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.notifyComments}
              onChange={(e) =>
                setForm({ ...form, notifyComments: e.target.checked })
              }
            />
            Comments on your reflections
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.notifyReactions}
              onChange={(e) =>
                setForm({ ...form, notifyReactions: e.target.checked })
              }
            />
            Reactions to your reflections
          </label>
        </div>
      </section>
      <ErrorNotice message={error} />
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          <Check size={16} />
          {busy ? "Saving…" : "Save preferences"}
        </button>
      </div>
      <p className="field-help">
        Account export and deletion are not available in this local development
        edition. Contact the site owner for help with local data.
      </p>
    </form>
  );
}
export function NotificationsScreen() {
  const { boot, refresh, announce } = useApp();
  return (
    <>
      <PageHeading
        eyebrow="FROM YOUR CORNER OF THE WORLD"
        title="A few gentle updates."
        description="Connections and conversations, whenever you’re ready."
      >
        {boot.user && (
          <button
            className="button subtle"
            onClick={async () => {
              try {
                await api("notifications", "POST", {});
                refresh();
                announce("Notifications marked as read.");
              } catch (e) {
                announce((e as Error).message);
              }
            }}
          >
            <CheckCheck size={16} />
            Mark all read
          </button>
        )}
      </PageHeading>
      {!boot.user ? (
        <AuthInvitation />
      ) : boot.notifications.length ? (
        <div className="notification-list">
          {boot.notifications.map((n) => (
            <Link
              href={n.href}
              key={n.id}
              className={`notification-card ${n.read ? "read" : ""}`}
              onClick={() => {
                void api("notifications", "POST", { id: n.id })
                  .then(refresh)
                  .catch(() => {});
              }}
            >
              <span className="notification-symbol">
                <Bell size={19} />
              </span>
              <div>
                <p>{n.message}</p>
                <small>{readableDate(n.createdAt)}</small>
              </div>
              {!n.read && <span className="unread-dot" />}
              <ArrowRight size={16} />
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="All is quiet here.">
          New invitations and responses will appear here.
        </Empty>
      )}
    </>
  );
}

interface ModerationItem {
  id: string;
  type: "reflection" | "comment";
  reference?: string;
  body: string;
  author: PublicProfile | string;
  reason: string;
  status: string;
  createdAt: string;
}
export function ModerationScreen() {
  const { boot, revision, refresh, announce } = useApp();
  const [page, setPage] = useState(1);
  const result = useResource<{
    items: ModerationItem[];
    page: number;
    hasMore: boolean;
  }>(
    boot.user?.role === "MODERATOR" ? `moderation?page=${page}` : null,
    revision,
  );
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function action(item: ModerationItem, action: string) {
    setBusy(true);
    try {
      await api("moderation", "POST", {
        id: item.id,
        type: item.type,
        action,
        note: note[item.id] || "",
      });
      announce("Moderation decision recorded.");
      refresh();
    } catch (e) {
      announce((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="TEND THIS SPACE WITH CARE"
        title="Community stewardship."
        description="Review context carefully. Welcome different interpretations; address abuse."
      />
      {boot.user?.role !== "MODERATOR" ? (
        <Empty title="This area is for site stewards.">
          Moderation access is restricted and checked on the server.
        </Empty>
      ) : (
        <>
          <div className="demo-notice">
            <ShieldCheck size={20} />
            <p>
              Access to this queue and every decision are audited. Internal
              notes are never shared with the community.
            </p>
          </div>
          <ErrorNotice message={result.error} />
          {result.loading ? (
            <p>Opening the queue…</p>
          ) : !result.data?.items.length ? (
            <Empty title="The queue is clear.">
              Thank you for taking care of this community.
            </Empty>
          ) : (
            result.data.items.map((item) => (
              <article
                className="panel moderation-card"
                key={`${item.type}:${item.id}`}
              >
                <div className="section-title">
                  <span className="reference-chip">
                    {item.type} · {item.status}
                  </span>
                  <small>{readableDate(item.createdAt)}</small>
                </div>
                <h3>{item.reference || "Comment review"}</h3>
                <p className="reflection-body full">{item.body}</p>
                <p className="status-note">Reason: {item.reason}</p>
                <label>
                  Internal note
                  <textarea
                    value={note[item.id] || ""}
                    onChange={(e) =>
                      setNote({ ...note, [item.id]: e.target.value })
                    }
                    rows={2}
                    maxLength={1000}
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="button subtle"
                    disabled={busy}
                    onClick={() => action(item, "dismiss")}
                  >
                    Dismiss report
                  </button>
                  <button
                    className="button subtle danger-text"
                    disabled={busy}
                    onClick={() => action(item, "hide")}
                  >
                    Hide content
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => action(item, "approve")}
                  >
                    Approve content
                  </button>
                </div>
              </article>
            ))
          )}
          <Pagination
            page={page}
            hasMore={Boolean(result.data?.hasMore)}
            onChange={setPage}
          />
        </>
      )}
    </>
  );
}

export function ShopScreen() {
  const { announce } = useApp();
  const { data, error, loading } = useResource<CommerceCatalog>("shop");
  const [category, setCategory] = useState("All things");
  const [busy, setBusy] = useState<string | null>(null);
  async function checkout(product: Product) {
    if (!product.variantId) return;
    setBusy(product.id);
    try {
      const { checkoutUrl } = await api<{ checkoutUrl: string }>(
        "shop",
        "POST",
        { items: [{ variantId: product.variantId, quantity: 1 }] },
      );
      location.assign(checkoutUrl);
    } catch (e) {
      announce((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const categories = [
    "All things",
    ...new Set(data?.products.map((p) => p.category) || []),
  ];
  return (
    <>
      <PageHeading
        eyebrow="THE STILLWORD COLLECTION"
        title="Small things. Meaningful moments."
        description="Thoughtful companions for reading, writing, and the everyday."
      />
      <div className="shop-banner">
        <div>
          <span className="eyebrow">
            <Leaf size={14} /> MADE FOR A SLOWER MOMENT
          </span>
          <h2>
            A little intention,
            <br />
            in the things you keep.
          </h2>
          <p>Space for your words. Reminders for your day.</p>
        </div>
        <div className="shop-banner-art" aria-hidden="true">
          <div className="illustrated-journal">
            <span>stillword</span>
            <Leaf size={43} strokeWidth={0.8} />
            <strong>
              room
              <br />
              to grow.
            </strong>
            <small>A REFLECTION JOURNAL</small>
          </div>
          <div className="journal-shadow" />
        </div>
      </div>
      <ErrorNotice message={error} />
      {data && (
        <div className="catalog-notice">
          <ShoppingBag size={17} />
          <p>{data.notice}</p>
        </div>
      )}
      <div className="shop-filter">
        <div className="tabs">
          {categories.map((c) => (
            <button
              className={c === category ? "active" : ""}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <span className="quiet-label">Thoughtfully selected</span>
      </div>
      {loading ? (
        <p role="status">Opening the collection…</p>
      ) : (
        <div className="product-grid">
          {data?.products
            .filter((p) => category === "All things" || p.category === category)
            .map((p) => (
              <article className="product-card" key={p.id}>
                <div className="product-image">
                  {/* Provider images are validated at the commerce boundary. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.image}
                    alt={p.imageAlt}
                    width="600"
                    height="600"
                    loading="lazy"
                  />
                  <span className="product-category">{p.category}</span>
                </div>
                <div className="product-copy">
                  <div>
                    <h3>{p.title}</h3>
                    <span className="product-price">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: p.currency,
                      }).format(p.price)}
                    </span>
                  </div>
                  <p>{p.description}</p>
                  <button
                    className="button subtle"
                    disabled={
                      data.mode === "demo" || !p.available || busy !== null
                    }
                    onClick={() => checkout(p)}
                  >
                    {data.mode === "demo"
                      ? "Sample · checkout unavailable"
                      : !p.available
                        ? "Currently unavailable"
                        : busy === p.id
                          ? "Opening checkout…"
                          : "Continue to secure checkout"}
                    {data.mode !== "demo" && <ArrowRight size={15} />}
                  </button>
                </div>
              </article>
            ))}
        </div>
      )}
      <div className="shop-values">
        <span>
          <Heart size={19} />
          Made for meaningful moments
        </span>
        <span>
          <LockKeyhole size={19} />
          Your reflections stay separate
        </span>
        <span>
          <Globe2 size={19} />
          Room for every journey
        </span>
      </div>
    </>
  );
}
