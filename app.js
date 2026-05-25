const $ = (selector) => document.querySelector(selector);

const api = (path, options = {}) => fetch(path, {
  credentials: "same-origin",
  headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  ...options
}).then(async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
});

let currentDailyVerse = null;
let currentUser = null;
let reflectionNextBeforeId = null;
let profileNextBeforeId = null;
let activeProfileUsername = "";
let activePostSlug = "";

function initChrome() {
  const root = document.documentElement;
  if (localStorage.getItem("theme") === "dark") root.classList.add("dark");
  $("#themeToggle")?.addEventListener("click", () => {
    root.classList.toggle("dark");
    localStorage.setItem("theme", root.classList.contains("dark") ? "dark" : "light");
  });
  document.addEventListener("pointermove", (event) => {
    const glow = $(".cursor-glow");
    if (glow) {
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    }
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function profileUrl(username) {
  return `/profile.html?username=${encodeURIComponent(username || "")}`;
}

function renderAccountLink() {
  const link = $("#accountLink");
  if (!link) return;
  if (currentUser) {
    link.href = "/account.html";
    link.textContent = currentUser.display_name || currentUser.username;
  } else {
    link.href = "/account.html";
    link.textContent = "Account";
  }
}

async function loadCurrentUser() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
  } catch {
    currentUser = null;
  }
  renderAccountLink();
}

function getVoterKey() {
  let key = localStorage.getItem("verse_voter_key");
  if (!key) {
    key = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem("verse_voter_key", key);
  }
  return key;
}

async function initHome() {
  if (!$("#dailyVerseText")) return;
  renderComposerAccount();
  const daily = await api("/api/daily");
  currentDailyVerse = daily.verse;
  $("#dailyVerseText").textContent = `"${daily.verse.text}"`;
  $("#dailyVerseReference").textContent = daily.verse.reference;
  loadReflections(daily.verse.id);

  $("#shareButton")?.addEventListener("click", async () => {
    const shareText = `${daily.verse.text} - ${daily.verse.reference}`;
    if (navigator.share) await navigator.share({ title: "Daily KJV Verse", text: shareText, url: location.href });
    else await navigator.clipboard.writeText(shareText);
  });
  $("#copyButton")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(location.href);
    $("#reflectionNotice").textContent = "Link copied.";
  });
  $("#reflectionForm")?.addEventListener("submit", submitReflection);
  $("#loadMoreReflections")?.addEventListener("click", () => loadReflections(currentDailyVerse.id, true));
}

function renderComposerAccount() {
  const account = $("#composerAccount");
  const displayName = $("#displayName");
  if (!account || !displayName) return;
  if (currentUser) {
    displayName.value = currentUser.display_name || currentUser.username;
    displayName.disabled = true;
    account.innerHTML = `Posting as <a href="${profileUrl(currentUser.username)}">${escapeHtml(currentUser.display_name || currentUser.username)}</a>.`;
  } else {
    displayName.disabled = false;
    account.innerHTML = `Posting as a guest. <a href="/account.html">Sign in</a> to save reflections to your profile.`;
  }
}

async function loadReflections(verseId, append = false) {
  const feed = $("#reflectionFeed");
  if (!feed) return;
  const before = append && reflectionNextBeforeId ? `&before_id=${encodeURIComponent(reflectionNextBeforeId)}` : "";
  const data = await api(`/api/reflections?verse_id=${verseId}&limit=10${before}`);
  const html = data.reflections.length ? data.reflections.map(renderReflection).join("") :
    `<p class="meta">No public reflections yet. Yours can be the first.</p>`;
  if (append && feed.querySelector(".feed-card")) feed.insertAdjacentHTML("beforeend", html);
  else feed.innerHTML = html;
  reflectionNextBeforeId = data.next_before_id;
  const loadMore = $("#loadMoreReflections");
  if (loadMore) loadMore.hidden = !reflectionNextBeforeId;
}

function renderReflection(item, options = {}) {
  const author = item.username
    ? `<a href="${profileUrl(item.username)}">${escapeHtml(item.display_name)}</a>`
    : escapeHtml(item.display_name);
  const openLink = options.showOpen === false || item.visibility === "private"
    ? ""
    : ` - <a href="${escapeHtml(item.url)}">Open</a>`;
  return `<article class="feed-card">
    <p>${escapeHtml(item.text)}</p>
    <p class="meta">${author} - ${new Date(item.created_at).toLocaleString()} - ${escapeHtml(item.reference)}${openLink}</p>
  </article>`;
}

async function submitReflection(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const visibility = $("#postVisibility")?.value || "public";
  const payload = {
    verse_id: currentDailyVerse.id,
    display_name: $("#displayName").value.trim(),
    anonymous: $("#anonymous").checked,
    visibility,
    text: $("#reflectionText").value.trim()
  };
  const result = await api("/api/reflections", { method: "POST", body: JSON.stringify(payload) });
  form.reset();
  renderComposerAccount();
  const sharePath = visibility === "private" || result.status !== "approved" ? result.private_url : result.url;
  const link = `${location.origin}${sharePath}`;
  $("#reflectionNotice").innerHTML = result.status === "approved"
    ? `Saved. Share link: <a href="${link}">${link}</a>`
    : `Saved for review. Private link: <a href="${link}">${link}</a>`;
  loadReflections(currentDailyVerse.id);
}

async function initPrivateReflection() {
  if (!$("#privateReflection")) return;
  const token = new URLSearchParams(location.search).get("token");
  if (!token) {
    $("#privateTitle").textContent = "No token provided.";
    return;
  }
  const data = await api(`/api/reflections/private?token=${encodeURIComponent(token)}`);
  $("#privateTitle").textContent = data.reflection.reference;
  $("#privateReflection").innerHTML = `${renderReflection(data.reflection, { showOpen: false })}<p class="meta">Status: ${escapeHtml(data.reflection.status)}</p>`;
}

async function initPost() {
  if (!$("#publicPost")) return;
  activePostSlug = new URLSearchParams(location.search).get("slug") || "";
  if (!activePostSlug) {
    $("#postTitle").textContent = "Post not found.";
    return;
  }
  const data = await api(`/api/posts/by-slug?slug=${encodeURIComponent(activePostSlug)}`);
  $("#postTitle").textContent = data.post.reference;
  $("#publicPost").innerHTML = renderReflection(data.post, { showOpen: false });
  $("#copyPostLink")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(location.href);
    $("#postNotice").textContent = "Link copied.";
  });
  $("#reportPost")?.addEventListener("click", async () => {
    await api("/api/posts/report", { method: "POST", body: JSON.stringify({ slug: activePostSlug, reason: "User report" }) });
    $("#postNotice").textContent = "Report sent.";
  });
}

async function initAccount() {
  if (!$("#signedOutPanel")) return;
  renderAccountPage();
  $("#loginForm")?.addEventListener("submit", submitLogin);
  $("#registerForm")?.addEventListener("submit", submitRegister);
  $("#profileForm")?.addEventListener("submit", submitProfile);
  $("#logoutButton")?.addEventListener("click", logout);
}

function renderAccountPage() {
  const signedOut = $("#signedOutPanel");
  const profilePanel = $("#profilePanel");
  if (!signedOut || !profilePanel) return;
  signedOut.hidden = !!currentUser;
  profilePanel.hidden = !currentUser;
  if (!currentUser) return;
  $("#profileName").textContent = currentUser.display_name || currentUser.username;
  $("#profileLinkLine").innerHTML = `<a href="${profileUrl(currentUser.username)}">${location.origin}${profileUrl(currentUser.username)}</a>`;
  const form = $("#profileForm");
  form.elements.display_name.value = currentUser.display_name || "";
  form.elements.avatar_url.value = currentUser.avatar_url || "";
  form.elements.bio.value = currentUser.bio || "";
}

async function submitLogin(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(data) });
    currentUser = result.user;
    renderAccountLink();
    renderAccountPage();
  } catch (error) {
    $("#loginNotice").textContent = error.message;
  }
}

async function submitRegister(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const result = await api("/api/auth/register", { method: "POST", body: JSON.stringify(data) });
    currentUser = result.user;
    renderAccountLink();
    renderAccountPage();
  } catch (error) {
    $("#registerNotice").textContent = error.message;
  }
}

async function submitProfile(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const result = await api("/api/users/me", { method: "POST", body: JSON.stringify(data) });
  currentUser = result.user;
  renderAccountLink();
  renderAccountPage();
  $("#profileNotice").textContent = "Profile saved.";
}

async function logout() {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  currentUser = null;
  renderAccountLink();
  renderAccountPage();
}

async function initProfile() {
  if (!$("#publicProfile")) return;
  activeProfileUsername = new URLSearchParams(location.search).get("username") || currentUser?.username || "";
  if (!activeProfileUsername) {
    $("#publicProfileName").textContent = "Profile not found.";
    return;
  }
  $("#loadMoreProfilePosts")?.addEventListener("click", () => loadProfile(activeProfileUsername, true));
  loadProfile(activeProfileUsername);
}

async function loadProfile(username, append = false) {
  const before = append && profileNextBeforeId ? `&before_id=${encodeURIComponent(profileNextBeforeId)}` : "";
  const data = await api(`/api/profile?username=${encodeURIComponent(username)}&limit=10${before}`);
  $("#publicProfileName").textContent = data.user.display_name || data.user.username;
  $("#publicProfileBio").textContent = data.user.bio || `@${data.user.username}`;
  const feed = $("#profilePosts");
  const html = data.posts.length ? data.posts.map(renderReflection).join("") : `<p class="meta">No public reflections yet.</p>`;
  if (append && feed.querySelector(".feed-card")) feed.insertAdjacentHTML("beforeend", html);
  else feed.innerHTML = html;
  profileNextBeforeId = data.next_before_id;
  const loadMore = $("#loadMoreProfilePosts");
  if (loadMore) loadMore.hidden = !profileNextBeforeId;
}

async function initVersus() {
  if (!$("#versusGrid")) return;
  $("#nextMatchup")?.addEventListener("click", loadVersus);
  loadVersus();
}

async function loadVersus() {
  const data = await api(`/api/versus/current?voter_key=${encodeURIComponent(getVoterKey())}`);
  const grid = $("#versusGrid");
  grid.innerHTML = [data.matchup.verse_a, data.matchup.verse_b].map((verse) => `
    <button class="reflection-panel verse-choice" data-verse-id="${verse.id}" type="button">
      <blockquote>"${escapeHtml(verse.text)}"</blockquote>
      <span class="reference">${escapeHtml(verse.reference)}</span>
    </button>`).join("");
  grid.querySelectorAll("button").forEach((button) => {
    button.disabled = data.voted;
    button.addEventListener("click", () => voteVersus(data.matchup.id, button.dataset.verseId));
  });
  renderVersusResults(data);
}

async function voteVersus(matchupId, verseId) {
  const data = await api("/api/versus/vote", {
    method: "POST",
    body: JSON.stringify({ matchup_id: Number(matchupId), verse_id: Number(verseId), voter_key: getVoterKey() })
  });
  renderVersusResults(data);
  $("#versusGrid").querySelectorAll("button").forEach((button) => button.disabled = true);
}

function renderVersusResults(data) {
  const results = $("#versusResults");
  if (!results) return;
  const total = Math.max(1, data.totals.total || 0);
  results.innerHTML = data.voted ? data.totals.items.map((item) => {
    const pct = Math.round((item.votes / total) * 100);
    return `<p><strong>${escapeHtml(item.reference)}</strong>: ${item.votes} vote${item.votes === 1 ? "" : "s"} (${pct}%)</p>`;
  }).join("") : "<p>Choose one verse to see the results.</p>";
}

const triviaScore = { blank: { right: 0, total: 0 }, reference: { right: 0, total: 0 } };
let triviaMode = "blank";
let currentQuestion = null;

async function initTrivia() {
  if (!$("#triviaForm")) return;
  $("#blankMode").addEventListener("click", () => switchTrivia("blank"));
  $("#referenceMode").addEventListener("click", () => switchTrivia("reference"));
  $("#nextQuestion").addEventListener("click", loadQuestion);
  $("#triviaForm").addEventListener("submit", submitTrivia);
  loadQuestion();
}

function switchTrivia(mode) {
  triviaMode = mode;
  $("#blankMode").classList.toggle("active", mode === "blank");
  $("#referenceMode").classList.toggle("active", mode === "reference");
  loadQuestion();
}

async function loadQuestion() {
  currentQuestion = await api(`/api/trivia/next?mode=${triviaMode}`);
  $("#triviaNotice").textContent = "";
  $("#triviaQuestion").textContent = triviaMode === "blank" ? currentQuestion.blanked_text : currentQuestion.text;
  $("#triviaForm").innerHTML = triviaMode === "blank"
    ? `<label class="wide">Missing word or phrase <input name="answer" autocomplete="off" required></label><button class="button primary" type="submit">Check answer</button>`
    : currentQuestion.choices.map((choice, index) => `<label class="check-row wide"><input name="answer" type="radio" value="${escapeHtml(choice)}" ${index === 0 ? "required" : ""}> ${escapeHtml(choice)}</label>`).join("") + `<button class="button primary" type="submit">Check answer</button>`;
  updateScore();
}

async function submitTrivia(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const answer = form.get("answer");
  const result = await api("/api/trivia/check", {
    method: "POST",
    body: JSON.stringify({ id: currentQuestion.id, answer })
  });
  triviaScore[triviaMode].total += 1;
  if (result.correct) triviaScore[triviaMode].right += 1;
  $("#triviaNotice").textContent = result.correct ? "Correct." : `Not quite. Correct answer: ${result.answer}`;
  updateScore();
}

function updateScore() {
  const score = triviaScore[triviaMode];
  $("#scoreLine").textContent = `Score: ${score.right} / ${score.total}`;
}

async function initAdmin() {
  if (!$("#adminLogin")) return;
  $("#adminLogin").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      loadAdmin();
    } catch (error) {
      $("#adminLoginNotice").textContent = error.message;
    }
  });
  $("#dailyVerseForm").addEventListener("submit", saveDailyVerse);
  $("#verseForm").addEventListener("submit", saveVerse);
  $("#clearVerseForm").addEventListener("click", () => $("#verseForm").reset());
  try { await loadAdmin(); } catch {}
}

async function loadAdmin() {
  const data = await api("/api/admin/dashboard");
  $("#adminLoginPanel").hidden = true;
  $("#adminPanel").hidden = false;
  renderAdminStats(data);
  $("#dailyVerseSelect").innerHTML = data.verses.map((verse) => `<option value="${verse.id}">${escapeHtml(verse.reference)}</option>`).join("");
  $("#adminReflections").innerHTML = data.reflections.map((item) => `
    <article class="feed-card">
      <p>${escapeHtml(item.text)}</p><p class="meta">${escapeHtml(item.display_name)} - ${escapeHtml(item.status)} - ${escapeHtml(item.reference)}</p>
      <button class="button" data-action="approve" data-id="${item.id}">Approve</button>
      <button class="button ghost" data-action="reject" data-id="${item.id}">Reject</button>
      <button class="button ghost" data-action="delete" data-id="${item.id}">Delete</button>
    </article>`).join("") || `<p class="meta">No queued reflections.</p>`;
  $("#adminReflections").querySelectorAll("button").forEach((button) => button.addEventListener("click", moderateReflection));
  $("#adminVerses").innerHTML = data.verses.map((verse) => `
    <article class="feed-card"><p><strong>${escapeHtml(verse.reference)}</strong></p><p class="meta">${escapeHtml(verse.text)}</p>
    <button class="button ghost" data-action="edit" data-id="${verse.id}">Edit</button>
    <button class="button ghost" data-action="delete" data-id="${verse.id}">Delete</button></article>`).join("");
  $("#adminVerses").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.action === "edit") editVerse(data.verses.find((v) => v.id == button.dataset.id));
      if (button.dataset.action === "delete") deleteVerse(button.dataset.id);
    });
  });
  $("#versusStats").innerHTML = data.versus_stats.map((row) => `<article class="feed-card"><p>${escapeHtml(row.reference)}</p><p class="meta">${row.votes} votes</p></article>`).join("") || `<p class="meta">No votes yet.</p>`;
}

function renderAdminStats(data) {
  const stats = $("#adminStats");
  if (!stats) return;
  const postCounts = data.post_counts.map((row) => `<span><strong>${row.count}</strong>${escapeHtml(row.status)}</span>`).join("");
  const jobCounts = data.job_counts.map((row) => `<span><strong>${row.count}</strong>${escapeHtml(row.status)} jobs</span>`).join("");
  stats.innerHTML = `${postCounts || "<span><strong>0</strong>posts</span>"}${jobCounts}${data.reports.length ? `<span><strong>${data.reports.length}</strong>open reports</span>` : ""}`;
}

async function moderateReflection(event) {
  const { action, id } = event.currentTarget.dataset;
  await api(`/api/admin/reflections/${id}`, { method: "POST", body: JSON.stringify({ action }) });
  loadAdmin();
}

async function saveDailyVerse(event) {
  event.preventDefault();
  await api("/api/admin/daily", { method: "POST", body: JSON.stringify({ verse_id: Number($("#dailyVerseSelect").value) }) });
  loadAdmin();
}

function editVerse(verse) {
  const form = $("#verseForm");
  for (const key of ["id", "reference", "book", "chapter", "verse_start", "verse_end", "text"]) {
    form.elements[key].value = verse[key] || "";
  }
}

async function saveVerse(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  await api("/api/admin/verses", { method: "POST", body: JSON.stringify(data) });
  event.currentTarget.reset();
  loadAdmin();
}

async function deleteVerse(id) {
  await api("/api/admin/verses/delete", { method: "POST", body: JSON.stringify({ id: Number(id) }) });
  loadAdmin();
}

async function boot() {
  initChrome();
  await loadCurrentUser();
  initHome().catch(console.error);
  initPrivateReflection().catch(console.error);
  initPost().catch(console.error);
  initAccount().catch(console.error);
  initProfile().catch(console.error);
  initVersus().catch(console.error);
  initTrivia().catch(console.error);
  initAdmin().catch(console.error);
}

boot();
