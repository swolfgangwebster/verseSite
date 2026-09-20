"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Fragment,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Feather,
  Globe2,
  Heart,
  LockKeyhole,
  MessageCircle,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Users,
  Pencil,
  Trash2,
  Flag,
  Leaf,
} from "lucide-react";
import type { Passage } from "@/lib/bible";
import type {
  Reflection,
  Page,
  Visibility,
  Comment,
  ReactionKind,
} from "@/lib/types";
import { api, initials, readableDate, useApp, useResource } from "./client";

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          <span />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Empty({
  title = "A little space, waiting for your words.",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Feather size={27} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{children || "Take your time. There’s no right way to begin."}</p>
    </div>
  );
}
export function AuthInvitation() {
  return (
    <div className="signin-invitation">
      <span className="invitation-icon">
        <Feather size={23} />
      </span>
      <div>
        <h3>Your words have a place here.</h3>
        <p>
          Sign in to keep a private journal or share a little of your journey.
        </p>
      </div>
      <Link className="button primary" href="/signin">
        Begin reflecting <ArrowRight size={16} />
      </Link>
    </div>
  );
}
export function ErrorNotice({ message }: { message?: string }) {
  return message ? (
    <div className="error-notice" role="alert">
      {message}
    </div>
  ) : null;
}
export function Privacy({ visibility }: { visibility: Visibility }) {
  const Icon =
    visibility === "PRIVATE"
      ? LockKeyhole
      : visibility === "FRIENDS"
        ? Users
        : Globe2;
  return (
    <span className={`privacy ${visibility.toLowerCase()}`}>
      <Icon size={12} />
      {visibility === "PRIVATE"
        ? "Only me"
        : visibility === "FRIENDS"
          ? "Friends"
          : "Public"}
    </span>
  );
}

export function HomeScreen() {
  const { boot } = useApp();
  const [scope, setScope] = useState("public");
  const date = new Date(`${boot.daily.date}T12:00:00`).toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  );
  return (
    <>
      <PageHeading
        eyebrow="A MOMENT IN THE WORD"
        title="A little space for the Word."
        description="Read slowly. Reflect honestly. Grow together."
      >
        <div className="today-date">
          <span className="date-dot" />
          {date}
        </div>
      </PageHeading>
      <div className="home-grid">
        <div className="home-primary">
          <PassageCard passage={boot.daily} featured />
          <Link href="/daily" className="text-link daily-history-link">
            Browse earlier daily passages <ArrowRight size={13} />
          </Link>
          {boot.user ? (
            <div className="quick-composer">
              <span className="avatar">{initials(boot.user.displayName)}</span>
              <Link
                href={`/write?reference=${encodeURIComponent(boot.daily.target.displayReference)}`}
              >
                What is this passage stirring in you?
              </Link>
              <Feather size={19} />
            </div>
          ) : (
            <AuthInvitation />
          )}
          <section className="community-section">
            <div className="section-title">
              <div>
                <div className="eyebrow">ROOM FOR EVERY VOICE</div>
                <h2>Reflections along the way</h2>
              </div>
              <span className="quiet-label">
                <Leaf size={14} /> Gently, together
              </span>
            </div>
            <div className="feed-toolbar">
              <div
                className="tabs"
                role="group"
                aria-label="Reflection audience"
              >
                {[
                  ["public", "Public reflections"],
                  ["friends", "Friends"],
                  ["mine", "Mine"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={scope === id}
                    disabled={id !== "public" && !boot.user}
                    className={scope === id ? "active" : ""}
                    onClick={() => setScope(id)}
                  >
                    {label}
                    {id === "mine" && <LockKeyhole size={12} />}
                  </button>
                ))}
              </div>
              <span className="sort-caption">Most recent</span>
            </div>
            <ReflectionFeed
              scope={scope}
              reference={boot.daily.target.displayReference}
            />
            <p className="community-footnote">
              Different journeys. Shared curiosity. Let’s meet each other with
              grace.
            </p>
          </section>
        </div>
        <aside className="context-column">
          <div className="practice-card">
            <div className="eyebrow">
              <Sparkles size={14} /> A GENTLE INVITATION
            </div>
            <h2>
              Be here.
              <br />
              Just for a moment.
            </h2>
            <p>You don’t need the perfect words. Only a little openness.</p>
            <div className="practice-step">
              <span>01</span>
              <div>
                <strong>Read</strong>
                <p>Slow down. Let a word find you.</p>
              </div>
            </div>
            <div className="practice-step">
              <span>02</span>
              <div>
                <strong>Reflect</strong>
                <p>Notice what rises to the surface.</p>
              </div>
            </div>
            <div className="practice-step">
              <span>03</span>
              <div>
                <strong>Respond</strong>
                <p>Carry something into your day.</p>
              </div>
            </div>
            <div className="practice-decoration">
              <Leaf size={28} strokeWidth={1} />
              <span>There is room for you here.</span>
            </div>
          </div>
          <div className="side-section">
            <div className="eyebrow">A QUESTION TO SIT WITH</div>
            <h3>
              What might change if you gave yourself permission to be still?
            </h3>
            <Link
              href={`/write?reference=${encodeURIComponent(boot.daily.target.displayReference)}`}
              className="text-link"
            >
              Take this to your journal <ArrowRight size={15} />
            </Link>
          </div>
          <div className="side-section passage-links">
            <div className="eyebrow">KEEP WANDERING</div>
            {[
              ["Psalms 23", "A reminder of care"],
              ["Matthew 6:25-34", "Room to breathe"],
              ["John 15:1-8", "Rooted in something good"],
            ].map(([ref, label]) => (
              <Link href={`/bible/${encodeURIComponent(ref)}`} key={ref}>
                <span>
                  <strong>{ref}</strong>
                  <small>{label}</small>
                </span>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
          <Link className="mini-shop" href="/shop">
            <div className="mini-shop-art">
              <BookOpen size={37} strokeWidth={1.1} />
              <span>
                small things,
                <br />
                meaningful moments.
              </span>
            </div>
            <div>
              <span className="eyebrow">THE STILLWORD SHOP</span>
              <p>A little inspiration for your everyday.</p>
              <span className="text-link">
                Explore the collection <ArrowUpRightIcon />
              </span>
            </div>
          </Link>
        </aside>
      </div>
    </>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={15} style={{ transform: "rotate(-35deg)" }} />;
}

export function PassageCard({
  passage,
  featured = false,
}: {
  passage: Passage;
  featured?: boolean;
}) {
  const { announce } = useApp();
  const target = passage.target;
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `${passage.verses.map((v) => v.text).join(" ")} — ${target.displayReference} (WEB)`,
      );
      announce("Passage copied.");
    } catch {
      announce(
        "Copy isn’t available in this browser. You can select the passage text.",
      );
    }
  }
  async function share() {
    const url = `${location.origin}/bible/${encodeURIComponent(target.displayReference)}`;
    try {
      if (navigator.share)
        await navigator.share({ title: target.displayReference, url });
      else {
        await navigator.clipboard.writeText(url);
        announce("Passage link copied.");
      }
    } catch {
      /* Dismissing the native share sheet is harmless. */
    }
  }
  return (
    <section
      className={`passage-card ${featured ? "featured" : ""}`}
      aria-label={featured ? "Today’s passage" : "Bible passage"}
    >
      <div className="passage-top">
        <span className="eyebrow">
          <BookOpen size={15} />
          {featured ? "TODAY’S PASSAGE" : "THE WORD, AT YOUR PACE"}
        </span>
        <span className="translation-label">WEB</span>
      </div>
      <div className="passage-ornament" aria-hidden="true">
        <span />
        <Leaf size={20} strokeWidth={1.1} />
        <span />
      </div>
      <div className="passage-text">
        {passage.verses.map((v, index) => (
          <Fragment key={`${v.chapter}:${v.verse}`}>
            {target.startChapter !== target.endChapter &&
              (index === 0 ||
                passage.verses[index - 1].chapter !== v.chapter) && (
                <h3 className="reading-chapter">Chapter {v.chapter}</h3>
              )}
            <p>
              <sup>{v.verse}</sup>
              {v.text || (
                <span className="publisher-note">
                  This verse number is unprinted in the publisher’s edition.
                </span>
              )}
            </p>
          </Fragment>
        ))}
      </div>
      {!passage.available && (
        <p className="sample-notice">
          This reference is valid, but its text isn’t in the local sample yet.
          Import the full World English Bible to read it here.
        </p>
      )}
      <Link
        href={`/bible/${encodeURIComponent(target.displayReference)}`}
        className="passage-reference"
      >
        {target.displayReference}
        <ArrowUpRightIcon />
      </Link>
      <p className="translation-attribution">
        World English Bible · Public domain
      </p>
      <div className="passage-actions">
        <Link
          href={`/write?reference=${encodeURIComponent(target.displayReference)}`}
          className="button primary"
        >
          <Feather size={16} />
          Reflect on this
        </Link>
        <Link
          href={`/bible/${encodeURIComponent(`${target.displayReference.replace(/\s\d.*$/, "")} ${target.startChapter || 1}`)}`}
          className="text-button chapter-link"
        >
          Read full chapter <ArrowRight size={15} />
        </Link>
        <div className="passage-tools">
          <button
            className="icon-button"
            aria-label="Copy passage"
            onClick={copy}
          >
            <Copy size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Share passage"
            onClick={share}
          >
            <Share2 size={17} />
          </button>
        </div>
      </div>
      {featured && (
        <svg
          className="hero-botanical"
          viewBox="0 0 210 330"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M165 345C149 257 97 175 126 53M139 244C94 222 64 192 48 150M124 178C159 152 177 117 181 79M117 113C86 94 67 66 66 22"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M130 66C103 54 106 27 128 9C152 25 154 48 130 66ZM117 112C78 118 48 73 66 22C92 34 120 63 117 112ZM121 174C124 131 149 96 181 79C193 121 166 166 121 174ZM118 220C70 233 35 195 48 150C82 157 112 187 118 220ZM142 269C145 231 174 203 204 202C213 246 190 274 142 269Z"
            fill="currentColor"
            opacity=".17"
          />
        </svg>
      )}
    </section>
  );
}

export function ReflectionFeed({
  scope = "public",
  reference,
  query = "",
  author,
}: {
  scope?: string;
  reference?: string;
  query?: string;
  author?: string;
}) {
  const { revision } = useApp();
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ scope, page: String(page) });
  if (reference) params.set("reference", reference);
  if (author) params.set("author", author);
  const { data, error, loading } = useResource<Page<Reflection>>(
    `reflections?${params}${query ? `&${query}` : ""}`,
    revision,
  );
  return (
    <>
      <ErrorNotice message={error} />
      {loading ? (
        <div className="loading-inline" role="status">
          Gathering reflections…
        </div>
      ) : !data?.items.length ? (
        <Empty
          title={
            scope === "mine"
              ? "Your journal begins with a single thought."
              : "Be the first to leave a reflection."
          }
        >
          {scope === "friends"
            ? "Reflections from accepted friends will find a home here."
            : "A question, a connection, a word you want to carry with you."}
        </Empty>
      ) : (
        data.items.map((r) => <ReflectionCard key={r.id} reflection={r} />)
      )}
      <Pagination
        page={page}
        hasMore={Boolean(data?.hasMore)}
        onChange={setPage}
      />
    </>
  );
}
export function Pagination({
  page,
  hasMore,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  onChange: (page: number) => void;
}) {
  return page > 1 || hasMore ? (
    <div className="pagination">
      <button
        className="button subtle"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        <ArrowLeft size={15} /> Previous
      </button>
      <span>Page {page}</span>
      <button
        className="button subtle"
        disabled={!hasMore}
        onClick={() => onChange(page + 1)}
      >
        Next <ArrowRight size={15} />
      </button>
    </div>
  ) : null;
}
export function ReflectionCard({
  reflection: r,
  detail = false,
}: {
  reflection: Reflection;
  detail?: boolean;
}) {
  const { boot, announce, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  async function react(kind: ReactionKind) {
    setBusy(true);
    try {
      await api(`reflections/${r.id}/reactions`, "POST", {
        kind: r.myReaction === kind ? null : kind,
      });
      announce("Your reaction was updated.");
      refresh();
    } catch (e) {
      announce((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="reflection-card">
      <div className="reflection-author">
        <Link
          href={`/profile/${r.author.username}`}
          className="avatar"
          aria-label={`${r.author.displayName}’s profile`}
        >
          {initials(r.author.displayName)}
        </Link>
        <div>
          <Link href={`/profile/${r.author.username}`} className="author-name">
            {r.author.displayName}
          </Link>
          <span className="reflection-meta">
            {readableDate(r.createdAt)}
            {r.edited && " · Edited"}
          </span>
        </div>
        <Privacy visibility={r.visibility} />
      </div>
      <Link
        href={`/bible/${encodeURIComponent(r.reference)}`}
        className="reference-chip"
      >
        <BookOpen size={12} />
        {r.reference}
      </Link>
      {r.title && (
        <h3>
          {detail ? (
            r.title
          ) : (
            <Link href={`/reflections/${r.id}`}>{r.title}</Link>
          )}
        </h3>
      )}
      <p className={`reflection-body ${detail ? "full" : ""}`}>{r.body}</p>
      {!detail && (
        <Link href={`/reflections/${r.id}`} className="read-reflection">
          Read reflection <ArrowRight size={13} />
        </Link>
      )}
      {r.moderationStatus !== "APPROVED" && (
        <p className="status-note">
          {r.moderationStatus === "REVIEW"
            ? "Awaiting a thoughtful review. Only you can see this until it’s approved."
            : "Hidden by moderation. Contact the site steward to request a review."}
        </p>
      )}
      <div className="reflection-footer">
        {r.reactionsEnabled ? (
          <div className="reactions">
            {(detail
              ? ["Amen", "Thoughtful", "Encouraging", "Helpful"]
              : ["Amen", "Thoughtful"]
            ).map((kind) => (
              <button
                key={kind}
                aria-pressed={r.myReaction === kind}
                disabled={!boot.user || busy}
                className={`reaction ${r.myReaction === kind ? "selected" : ""}`}
                onClick={() => react(kind as ReactionKind)}
              >
                {kind === "Amen" ? <Heart size={14} /> : <Sparkles size={14} />}
                {kind}
                <span>{r.reactions[kind as ReactionKind] || 0}</span>
              </button>
            ))}
          </div>
        ) : (
          <span className="quiet-label">Reactions off</span>
        )}
        {r.commentsEnabled ? (
          <Link
            className="comment-count"
            href={`/reflections/${r.id}#comments`}
          >
            <MessageCircle size={14} />
            {r.commentCount} <span>comments</span>
          </Link>
        ) : (
          <span className="quiet-label">Comments off</span>
        )}
      </div>
    </article>
  );
}

export function BibleScreen({ reference }: { reference?: string }) {
  const { boot, revision } = useApp();
  const router = useRouter();
  const [search, setSearch] = useState(reference || "");
  const [book, setBook] = useState("JHN");
  const selected = boot.books.find((b) => b.id === book) || boot.books[0];
  const [chapter, setChapter] = useState("1");
  const [verse, setVerse] = useState("");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const result = useResource<Passage & { hasMore?: boolean }>(
    reference
      ? `bible?reference=${encodeURIComponent(reference)}&page=${page}`
      : null,
    revision,
  );
  function find(e: FormEvent) {
    e.preventDefault();
    if (search.trim())
      router.push(`/bible/${encodeURIComponent(search.trim())}`);
  }
  return (
    <>
      <PageHeading
        eyebrow="READ WITH CURIOSITY"
        title="There is always more to discover."
        description="A familiar passage. A new perspective. Begin wherever you are."
      />
      <form className="bible-search panel" onSubmit={find}>
        <label htmlFor="reference-search">Find a passage</label>
        <div className="search-row">
          <div className="search-field">
            <Search size={18} />
            <input
              id="reference-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Try John 3:16, Romans 8, or Psalms"
              required
            />
          </div>
          <button className="button primary">
            Open passage <ArrowRight size={16} />
          </button>
        </div>
        <p className="field-help">
          Verses, chapters, whole books, and ranges like John 3:16–4:2.
        </p>
        <div className="browse-controls">
          <label>
            Book
            <select
              value={selected?.id}
              onChange={(e) => {
                setBook(e.target.value);
                setChapter("1");
                setVerse("");
              }}
            >
              {boot.books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chapter
            <select
              value={chapter}
              onChange={(e) => {
                setChapter(e.target.value);
                setVerse("");
              }}
            >
              {Array.from({ length: selected?.chapterCount || 1 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            Verse (optional)
            <input
              type="number"
              min="1"
              max={selected?.chapters[Number(chapter) - 1] || 176}
              value={verse}
              onChange={(e) => setVerse(e.target.value)}
              placeholder="Whole chapter"
            />
          </label>
          <Link
            className="button subtle"
            href={`/bible/${encodeURIComponent(`${selected?.name} ${chapter}${verse ? `:${verse}` : ""}`)}`}
          >
            Browse <ArrowRight size={16} />
          </Link>
        </div>
      </form>
      {reference ? (
        <>
          <ErrorNotice message={result.error} />
          {result.loading ? (
            <p role="status">Opening the passage…</p>
          ) : (
            result.data && (
              <>
                <div className="chapter-navigation">
                  {result.data.previousChapter ? (
                    <Link
                      href={`/bible/${encodeURIComponent(result.data.previousChapter)}`}
                    >
                      <ArrowLeft size={16} />
                      {result.data.previousChapter}
                    </Link>
                  ) : (
                    <span />
                  )}
                  {result.data.nextChapter && (
                    <Link
                      href={`/bible/${encodeURIComponent(result.data.nextChapter)}`}
                    >
                      {result.data.nextChapter}
                      <ArrowRight size={16} />
                    </Link>
                  )}
                </div>
                <PassageCard passage={result.data} />
                <Pagination
                  page={page}
                  hasMore={Boolean(result.data.hasMore)}
                  onChange={setPage}
                />
                <div className="section-title">
                  <h2>Words around this passage</h2>
                </div>
                <ReflectionFeed
                  reference={result.data.target.displayReference}
                />
              </>
            )
          )}
        </>
      ) : (
        <>
          <div className="section-title">
            <h2>The library</h2>
            <div className="tabs">
              {["all", "old", "new"].map((t) => (
                <button
                  key={t}
                  className={filter === t ? "active" : ""}
                  onClick={() => setFilter(t)}
                >
                  {t === "all"
                    ? "All books"
                    : t === "old"
                      ? "Old Testament"
                      : "New Testament"}
                </button>
              ))}
            </div>
          </div>
          <div className="book-grid">
            {boot.books
              .filter(
                (b) =>
                  filter === "all" ||
                  (filter === "old" ? b.order <= 39 : b.order > 39),
              )
              .map((b) => (
                <Link key={b.id} href={`/bible/${encodeURIComponent(b.name)}`}>
                  <BookOpen size={21} strokeWidth={1.3} />
                  <strong>{b.name}</strong>
                  <small>{b.chapterCount} chapters</small>
                  <ArrowRight size={15} />
                </Link>
              ))}
          </div>
        </>
      )}
      <p className="data-attribution">
        Scripture from the World English Bible, a public-domain translation.{" "}
        <a href="https://worldenglish.bible/" target="_blank" rel="noreferrer">
          About this translation <ArrowUpRightIcon />
        </a>
      </p>
    </>
  );
}

export function DailyHistoryScreen() {
  const { boot } = useApp();
  const [date, setDate] = useState(boot.daily.date);
  const { data, error, loading } = useResource<
    Passage & { date: string; history: { date: string; reference: string }[] }
  >(`daily?date=${date}`);
  return (
    <>
      <PageHeading
        eyebrow="WORDS TO RETURN TO"
        title="A passage for every day."
        description="Revisit an earlier moment, or take a fresh look at a familiar verse."
      />
      <div className="panel history-controls">
        <label>
          Choose a date
          <input
            type="date"
            value={date}
            max={boot.daily.date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </label>
        {data && (
          <div className="history-links">
            {data.history.map((entry) => (
              <button
                key={entry.date}
                className={`button ${date === entry.date ? "primary" : "subtle"}`}
                onClick={() => setDate(entry.date)}
              >
                {readableDate(`${entry.date}T12:00:00`)} · {entry.reference}
              </button>
            ))}
          </div>
        )}
      </div>
      <ErrorNotice message={error} />
      {loading ? (
        <p role="status">Opening that day’s passage…</p>
      ) : (
        data && (
          <>
            <PassageCard passage={data} />
            <div className="section-title">
              <h2>Reflections around these words</h2>
            </div>
            <ReflectionFeed
              key={date}
              reference={data.target.displayReference}
            />
          </>
        )
      )}
    </>
  );
}

export function JournalScreen() {
  const { boot } = useApp();
  const [scope, setScope] = useState("mine");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(false);
  const [book, setBook] = useState("");
  const [visibility, setVisibility] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reference, setReference] = useState("");
  const [sort, setSort] = useState("newest");
  const params = new URLSearchParams({
    q: query,
    book,
    visibility,
    from,
    to,
    reference,
    sort,
  });
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORDS, YOUR JOURNEY"
        title="A place to return to."
        description="The questions, quiet discoveries, and small moments you’ve kept."
      >
        <Link href="/write" className="button primary">
          <Feather size={16} />
          New reflection
        </Link>
      </PageHeading>
      {!boot.user ? (
        <>
          <AuthInvitation />
          <div className="section-title">
            <h2>From the community</h2>
          </div>
          <ReflectionFeed />
        </>
      ) : (
        <>
          <div className="journal-toolbar">
            <div className="tabs">
              {[
                ["mine", "My journal"],
                ["friends", "Friends"],
                ["public", "Discover"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={scope === id ? "active" : ""}
                  onClick={() => setScope(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="journal-search">
              <div className="search-field">
                <Search size={17} />
                <input
                  aria-label={
                    scope === "mine"
                      ? "Search your journal"
                      : "Search authorized reflections"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    scope === "mine"
                      ? "Search your journal…"
                      : "Search reflections…"
                  }
                />
              </div>
              <button
                className="button subtle"
                aria-expanded={filters}
                onClick={() => setFilters(!filters)}
              >
                <SlidersHorizontal size={16} />
                Filters
              </button>
            </div>
          </div>
          {filters && (
            <div className="filter-panel panel">
              <label>
                Book
                <select value={book} onChange={(e) => setBook(e.target.value)}>
                  <option value="">Every book</option>
                  {boot.books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Passage
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. John 3:16"
                />
              </label>
              <label>
                Privacy
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                >
                  <option value="">Every visibility</option>
                  <option value="PRIVATE">Only me</option>
                  <option value="FRIENDS">Friends</option>
                  <option value="PUBLIC">Public</option>
                </select>
              </label>
              <label>
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Through
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <label>
                Order
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="biblical">Biblical order</option>
                </select>
              </label>
            </div>
          )}
          <div className="journal-list">
            <ReflectionFeed
              key={`${scope}:${params}`}
              scope={scope}
              query={params.toString()}
            />
          </div>
        </>
      )}
    </>
  );
}

export function WriteScreen() {
  const { boot } = useApp();
  const params = useSearchParams();
  const reference =
    params.get("reference") || boot.daily.target.displayReference;
  const edit = params.get("edit");
  const existing = useResource<{ reflection: Reflection }>(
    edit ? `reflections/${edit}` : null,
  );
  return (
    <>
      <PageHeading
        eyebrow="NO PERFECT WORDS NEEDED"
        title={edit ? "Return to your reflection." : "What’s on your heart?"}
        description="An observation, a question, a prayer. There is room for all of it."
      />
      {!boot.user ? (
        <AuthInvitation />
      ) : edit && !existing.data ? (
        <>
          <ErrorNotice message={existing.error} />
          {existing.loading && <p>Opening your reflection…</p>}
        </>
      ) : (
        <Composer
          key={`${boot.user.id}:${edit || reference}`}
          reference={reference}
          reflection={existing.data?.reflection}
        />
      )}
    </>
  );
}
function Composer({
  reference: initialReference,
  reflection,
}: {
  reference: string;
  reflection?: Reflection;
}) {
  const { boot, announce, refresh } = useApp();
  const router = useRouter();
  const draftKey = `stillword-draft:${boot.user!.id}:${reflection?.id || initialReference}`;
  const [draft] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || "null") as {
        title: string;
        body: string;
        reference: string;
        visibility: Visibility;
        commentsEnabled: boolean;
        reactionsEnabled: boolean;
      } | null;
    } catch {
      return null;
    }
  });
  const [reference, setReference] = useState(
    draft?.reference || reflection?.reference || initialReference,
  );
  const [title, setTitle] = useState(draft?.title ?? reflection?.title ?? "");
  const [body, setBody] = useState(draft?.body ?? reflection?.body ?? "");
  const [visibility, setVisibility] = useState<Visibility>(
    draft?.visibility ||
      reflection?.visibility ||
      boot.user!.defaultVisibility ||
      "PRIVATE",
  );
  const [commentsEnabled, setCommentsEnabled] = useState(
    draft?.commentsEnabled ??
      reflection?.commentsEnabled ??
      boot.user!.defaultComments,
  );
  const [reactionsEnabled, setReactionsEnabled] = useState(
    draft?.reactionsEnabled ??
      reflection?.reactionsEnabled ??
      boot.user!.defaultReactions,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passage = useResource<Passage>(
    `bible?reference=${encodeURIComponent(reference)}`,
  );
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          reference,
          title,
          body,
          visibility,
          commentsEnabled,
          reactionsEnabled,
        }),
      );
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
  }, [
    draftKey,
    reference,
    title,
    body,
    visibility,
    commentsEnabled,
    reactionsEnabled,
  ]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (body.trim().length > 2)
        api<{ message?: string; outcome: string }>("moderation/check", "POST", {
          body: `${title}\n${body}`,
        })
          .then((result) => {
            if (active)
              setFeedback(
                result.outcome === "ALLOW"
                  ? ""
                  : result.outcome === "REVIEW"
                    ? "This wording will need a thoughtful review before it is shared."
                    : "Please read through your words with care before saving.",
              );
          })
          .catch(() => {});
    }, 900);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [title, body]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!body.trim()) {
      setError("Add a few words to your reflection before saving.");
      return;
    }
    if (/\bkill\s+yourself\b/i.test(body.normalize("NFKC"))) {
      setError("Please revise language that could hurt someone before saving.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ reflection: Reflection; message: string }>(
        reflection ? `reflections/${reflection.id}` : "reflections",
        reflection ? "PATCH" : "POST",
        {
          reference,
          title,
          body,
          visibility,
          commentsEnabled,
          reactionsEnabled,
        },
      );
      localStorage.removeItem(draftKey);
      announce(result.message || "Your reflection is saved.");
      refresh();
      router.push(`/reflections/${result.reflection.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="composer-layout">
      <form className="composer panel" onSubmit={save}>
        <label htmlFor="reflection-reference">Your passage</label>
        <input
          id="reflection-reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          required
          maxLength={100}
        />
        <ErrorNotice message={passage.error} />
        {passage.data && (
          <div className="composer-passage">
            <BookOpen size={17} />
            <div>
              <strong>{passage.data.target.displayReference}</strong>
              <p>
                {passage.data.verses
                  .slice(0, 3)
                  .map((v) => v.text)
                  .join(" ") || "Passage text isn’t in the sample dataset yet."}
              </p>
            </div>
          </div>
        )}
        <label htmlFor="reflection-title">
          A title <span className="optional">(optional)</span>
        </label>
        <input
          id="reflection-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Give this moment a name…"
          maxLength={120}
        />
        <label htmlFor="reflection-body">Your reflection</label>
        <textarea
          id="reflection-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Today, these words make me think about…"
          maxLength={10000}
          rows={11}
          required
        />
        <div className="editor-meta">
          <span>
            <Check size={13} />
            Draft saved on this device
          </span>
          <span>{body.length.toLocaleString()} / 10,000</span>
        </div>
        <ErrorNotice message={error} />
        {feedback && (
          <p className="status-note" role="status">
            {feedback}
          </p>
        )}
        <fieldset className="visibility-options">
          <legend>Who is this reflection for?</legend>
          {(
            [
              {
                id: "PRIVATE",
                title: "Only me",
                help: "A quiet page in your private journal.",
                icon: LockKeyhole,
              },
              {
                id: "FRIENDS",
                title: "My friends",
                help: "Only you and your accepted friends.",
                icon: Users,
              },
              {
                id: "PUBLIC",
                title: "Everyone",
                help: "Anyone visiting Stillword can read it.",
                icon: Globe2,
              },
            ] as const
          ).map((option) => (
            <label
              key={option.id}
              className={visibility === option.id ? "selected" : ""}
            >
              <input
                type="radio"
                name="visibility"
                value={option.id}
                checked={visibility === option.id}
                onChange={() => setVisibility(option.id)}
              />
              <option.icon size={19} />
              <strong>{option.title}</strong>
              <span>{option.help}</span>
            </label>
          ))}
        </fieldset>
        <div className="interaction-options">
          <label>
            <input
              type="checkbox"
              checked={commentsEnabled}
              onChange={(e) => setCommentsEnabled(e.target.checked)}
            />
            <span>
              Allow comments
              <small>Make room for a thoughtful conversation.</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={reactionsEnabled}
              onChange={(e) => setReactionsEnabled(e.target.checked)}
            />
            <span>
              Allow reactions<small>A simple way to offer encouragement.</small>
            </span>
          </label>
        </div>
        <p className="field-help">
          Turning interactions off hides existing comments or reactions and
          pauses new ones. They return when you enable them again.
        </p>
        <div className="form-actions">
          <Link
            href={reflection ? `/reflections/${reflection.id}` : "/reflections"}
            className="button subtle"
          >
            Cancel
          </Link>
          <button
            className="button primary"
            disabled={busy || Boolean(passage.error)}
          >
            <Feather size={16} />
            {busy
              ? "Saving…"
              : reflection
                ? "Update reflection"
                : visibility === "PRIVATE"
                  ? "Save reflection"
                  : "Publish reflection"}
          </button>
        </div>
      </form>
      <aside className="writing-note">
        <Leaf size={31} strokeWidth={1} />
        <h2>
          Let it be
          <br />
          unfinished.
        </h2>
        <p>
          You don’t need to have it all figured out. Sometimes the most honest
          reflection begins with a question.
        </p>
        <div className="note-divider" />
        <LockKeyhole size={18} />
        <p>
          Your writing stays private unless you choose to share it. You can
          change your mind at any time.
        </p>
      </aside>
    </div>
  );
}

export function DetailScreen({ id }: { id: string }) {
  const { boot, revision, refresh, announce } = useApp();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, error, loading } = useResource<{
    reflection: Reflection;
    comments: Page<Comment>;
  }>(`reflections/${id}?page=${page}`, revision);
  const [body, setBody] = useState("");
  const [commentEdit, setCommentEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [report, setReport] = useState(false);
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  async function remove() {
    if (
      !confirm(
        "Delete this reflection? It will be removed from your journal and shared feeds.",
      )
    )
      return;
    try {
      await api(`reflections/${id}`, "DELETE");
      announce("Reflection deleted.");
      refresh();
      router.push("/reflections");
    } catch (e) {
      setActionError((e as Error).message);
    }
  }
  async function comment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      const result = await api<{ message: string }>(
        commentEdit ? `comments/${commentEdit}` : `reflections/${id}/comments`,
        commentEdit ? "PATCH" : "POST",
        { body },
      );
      setBody("");
      setCommentEdit(null);
      announce(result.message || "Comment saved.");
      refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <>
        <PageHeading
          eyebrow="A PRIVATE MOMENT"
          title="This reflection isn’t available."
          description="It may be private, removed, or outside your circle of friends."
        />
        <ErrorNotice message={error} />
        <Link className="button subtle" href="/reflections">
          Return to reflections
        </Link>
      </>
    );
  if (loading || !data) return <p role="status">Opening this reflection…</p>;
  const r = data.reflection;
  return (
    <div className="detail-column">
      <Link href="/reflections" className="back-link">
        <ArrowLeft size={16} />
        Back to reflections
      </Link>
      <div className="detail-toolbar">
        <span className="eyebrow">A MOMENT KEPT</span>
        {boot.user?.id === r.authorId ? (
          <div>
            <Link className="text-button" href={`/write?edit=${id}`}>
              <Pencil size={14} />
              Edit
            </Link>
            <button className="text-button danger-text" onClick={remove}>
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        ) : (
          boot.user && (
            <button className="text-button" onClick={() => setReport(!report)}>
              <Flag size={14} />
              Report
            </button>
          )
        )}
      </div>
      <ReflectionCard reflection={r} detail />
      <ErrorNotice message={actionError} />
      {report && (
        <form
          className="panel report-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("reports", "POST", {
                reflectionId: id,
                reason,
                details,
              });
              setReport(false);
              announce("Thank you. Your report has been sent for review.");
            } catch (e) {
              setActionError((e as Error).message);
            }
          }}
        >
          <h3>Help keep this a caring space.</h3>
          <label>
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {[
                ["harassment", "Harassment"],
                ["hate", "Hate or slur"],
                ["spam", "Spam"],
                ["sexual", "Sexual content"],
                ["threat", "Threat"],
                ["context", "Misinformation or context concern"],
                ["other", "Other"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Additional context (optional)
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button subtle"
              onClick={() => setReport(false)}
            >
              Cancel
            </button>
            <button className="button primary">Send report</button>
          </div>
        </form>
      )}
      <section id="comments" className="comments-section">
        <h2>A thoughtful conversation</h2>
        {!r.commentsEnabled ? (
          <Empty title="A reflection to simply sit with.">
            The author has turned comments off.
          </Empty>
        ) : (
          <>
            {data.comments.items.map((c) => (
              <article className="comment" key={c.id}>
                <span className="avatar small">
                  {initials(c.author.displayName)}
                </span>
                <div className="comment-content">
                  <strong>
                    <Link href={`/profile/${c.author.username}`}>
                      {c.author.displayName}
                    </Link>
                  </strong>
                  <small>
                    {readableDate(c.createdAt)}
                    {c.edited && " · Edited"}
                  </small>
                  <p>{c.body}</p>
                  <div className="comment-actions">
                    {boot.user?.id === c.authorId && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setCommentEdit(c.id);
                          setBody(c.body);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {(boot.user?.id === c.authorId ||
                      boot.user?.id === r.authorId) && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          if (!confirm("Remove this comment?")) return;
                          try {
                            await api(`comments/${c.id}`, "DELETE");
                            refresh();
                            announce("Comment removed.");
                          } catch (e) {
                            setActionError((e as Error).message);
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                    {boot.user && boot.user.id !== c.authorId && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          if (!confirm("Report this comment for review?"))
                            return;
                          try {
                            await api("reports", "POST", {
                              commentId: c.id,
                              reason: "other",
                            });
                            announce("Comment reported for review.");
                          } catch (e) {
                            setActionError((e as Error).message);
                          }
                        }}
                      >
                        Report
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            <Pagination
              page={page}
              hasMore={data.comments.hasMore}
              onChange={setPage}
            />
            {!data.comments.items.length && (
              <p className="muted">A kind word can open a conversation.</p>
            )}
            {boot.user ? (
              <form className="comment-form" onSubmit={comment}>
                <label htmlFor="comment-body">
                  {commentEdit
                    ? "Edit your comment"
                    : "Add a thoughtful comment"}
                </label>
                <textarea
                  id="comment-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Respond with curiosity and care…"
                  required
                  maxLength={2000}
                  rows={3}
                />
                <div className="form-actions">
                  {commentEdit && (
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() => {
                        setCommentEdit(null);
                        setBody("");
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                  <button className="button primary" disabled={busy}>
                    {busy
                      ? "Saving…"
                      : commentEdit
                        ? "Update comment"
                        : "Share comment"}
                  </button>
                </div>
              </form>
            ) : (
              <Link href="/signin" className="text-link">
                Sign in to join the conversation <ArrowRight size={15} />
              </Link>
            )}
          </>
        )}
      </section>
    </div>
  );
}
