import { parse as parseExif } from "exifr";
import "@fontsource/dm-mono/latin-300.css";
import "@fontsource/dm-mono/latin-400.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/cormorant-garamond/latin-400.css";
import "@fontsource/playfair-display/latin-400.css";
import "@fontsource/bodoni-moda/latin-400.css";
import "@fontsource/fraunces/latin-400.css";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/syne/latin-400.css";
import "@fontsource/libre-baskerville/latin-400.css";
import "@fontsource/manrope/latin-400.css";

interface Photo {
  id: string;
  beardDay: number;
  url: string;
  takenAt: string | null;
  originalName?: string;
  createdAt?: string;
}

interface GalleryData {
  photos: Photo[];
  maxDay: number;
  backgroundColor: string;
  logoFont: string;
  bodyFont: string;
}

interface VoteResult {
  beardDay: number;
  votes: number;
}

const app = document.querySelector<HTMLDivElement>("#app")!;
const placeholder = "/placeholder.svg";
const defaultBackgroundColor = "#f2df64";
const fontOptions = [
  { id: "instrument-serif", label: "Instrument Serif", family: '"Instrument Serif", serif' },
  { id: "dm-mono", label: "DM Mono", family: '"DM Mono", monospace' },
  { id: "cormorant-garamond", label: "Cormorant", family: '"Cormorant Garamond", serif' },
  { id: "playfair-display", label: "Playfair", family: '"Playfair Display", serif' },
  { id: "bodoni-moda", label: "Bodoni", family: '"Bodoni Moda", serif' },
  { id: "fraunces", label: "Fraunces", family: '"Fraunces", serif' },
  { id: "space-grotesk", label: "Space Grotesk", family: '"Space Grotesk", sans-serif' },
  { id: "syne", label: "Syne", family: '"Syne", sans-serif' },
  { id: "libre-baskerville", label: "Baskerville", family: '"Libre Baskerville", serif' },
  { id: "manrope", label: "Manrope", family: '"Manrope", sans-serif' },
] as const;
let gallery: GalleryData = {
  photos: [], maxDay: 0, backgroundColor: defaultBackgroundColor, logoFont: "instrument-serif", bodyFont: "dm-mono",
};
let voteStatus = { hasVoted: false, beardDay: null as number | null, isAdmin: false };
let voteSocket: WebSocket | null = null;
let activePhotoIndex: number | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

function formatDay(day: number): string {
  return `day ${day}`;
}

function formatTakenAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function applyBackgroundColor(color: string): void {
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : defaultBackgroundColor;
  document.documentElement.style.setProperty("--paper", safeColor);
  document.documentElement.style.backgroundColor = safeColor;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", safeColor);
}

function applyFontSettings(logoFont: string, bodyFont: string): void {
  const logo = fontOptions.find((option) => option.id === logoFont) ?? fontOptions[0];
  const body = fontOptions.find((option) => option.id === bodyFont) ?? fontOptions[1];
  document.documentElement.style.setProperty("--logo-font", logo.family);
  document.documentElement.style.setProperty("--body-font", body.family);
}

function applySiteAppearance(data: Pick<GalleryData, "backgroundColor" | "logoFont" | "bodyFont">): void {
  applyBackgroundColor(data.backgroundColor);
  applyFontSettings(data.logoFont, data.bodyFont);
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Something went wrong");
  return body;
}

function daysWithPhotos(): Array<{ day: number; photos: Photo[] }> {
  if (!gallery.maxDay && !gallery.photos.length) return [];
  const start = gallery.maxDay === 0 ? 0 : 1;
  const days: Array<{ day: number; photos: Photo[] }> = [];
  for (let day = start; day <= gallery.maxDay; day += 1) {
    days.push({ day, photos: gallery.photos.filter((photo) => photo.beardDay === day) });
  }
  return days;
}

function galleryItems(): Array<{ day: number; photo: Photo | null }> {
  const items: Array<{ day: number; photo: Photo | null }> = [];
  for (const { day, photos } of daysWithPhotos()) {
    if (photos.length) photos.forEach((photo) => items.push({ day, photo }));
    else items.push({ day, photo: null });
  }
  return items;
}

function voteDays(): Array<{ day: number; photos: Photo[] }> {
  return daysWithPhotos().filter(({ photos }) => photos.length > 0);
}

function renderGallery(): void {
  const items = galleryItems().map(({ day, photo }, index) => `<button class="photo-card ${photo ? "" : "is-placeholder"}" data-photo-index="${index}" aria-label="${photo ? "Open" : "No photo yet,"} ${formatDay(day)}">
    <img src="${photo?.url ?? placeholder}" alt="${photo ? `Beard ${formatDay(day)}` : ""}" draggable="false" loading="eager" /><span>${formatDay(day)}</span>
  </button>`).join("");

  app.innerHTML = `<main class="site-shell">
    <header class="site-header">
      <a class="wordmark" href="/" aria-label="Beard gallery">beard gallery</a>
      <nav class="header-actions" aria-label="Gallery actions">
        <button class="text-button" id="vote-button">vote</button>
        ${voteStatus.isAdmin ? `<a class="text-button" href="/admin">admin</a>` : ""}
      </nav>
    </header>
    <section class="gallery-wrap" aria-label="Beard days">
      ${items ? `<div class="gallery" id="gallery">${items}</div>` : `<div class="empty-mark"><img src="${placeholder}" alt="" /><span>soon.</span></div>`}
    </section>
    <div id="overlay-root"></div>
  </main>`;

  document.querySelector("#vote-button")?.addEventListener("click", openVote);
  document.querySelectorAll<HTMLButtonElement>(".photo-card").forEach((card) => {
    card.addEventListener("click", () => openPhoto(Number(card.dataset.photoIndex)));
  });
  setupGalleryMotion();
}

function setupGalleryMotion(): void {
  const track = document.querySelector<HTMLDivElement>("#gallery");
  if (!track) return;
  let pointerX = window.innerWidth / 2;
  let active = false;
  let frame = 0;

  const scaleCards = () => {
    const center = pointerX;
    track.querySelectorAll<HTMLElement>(".photo-card").forEach((card) => {
      const box = card.getBoundingClientRect();
      const distance = Math.abs(box.left + box.width / 2 - center);
      const influence = Math.max(0, 1 - distance / Math.min(window.innerWidth * 0.48, 520));
      card.style.setProperty("--scale", String(0.9 + influence * 0.14));
      card.style.setProperty("--lift", `${-influence * 9}px`);
    });
  };

  const drift = () => {
    if (!active) return;
    const edge = Math.max(0, Math.abs(pointerX / window.innerWidth * 2 - 1) - 0.42) / 0.58;
    const direction = pointerX < window.innerWidth / 2 ? -1 : 1;
    track.scrollLeft += direction * edge * edge * 5;
    scaleCards();
    frame = requestAnimationFrame(drift);
  };

  track.addEventListener("pointerenter", () => { active = true; cancelAnimationFrame(frame); drift(); });
  track.addEventListener("pointerleave", () => { active = false; cancelAnimationFrame(frame); });
  track.addEventListener("pointermove", (event) => { pointerX = event.clientX; scaleCards(); });
  track.addEventListener("scroll", scaleCards, { passive: true });
  track.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      track.scrollLeft += event.deltaY * 0.8;
    }
  }, { passive: false });
  scaleCards();
}

function closeOverlay(): void {
  document.querySelector("#overlay-root")!.innerHTML = "";
  document.body.classList.remove("overlay-open");
  voteSocket?.close();
  voteSocket = null;
  activePhotoIndex = null;
}

function mountOverlay(markup: string): HTMLElement {
  const root = document.querySelector<HTMLElement>("#overlay-root")!;
  root.innerHTML = markup;
  document.body.classList.add("overlay-open");
  root.querySelectorAll<HTMLElement>("[data-close]").forEach((button) => button.addEventListener("click", closeOverlay));
  root.querySelector(".overlay")?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).classList.contains("overlay")) closeOverlay();
  });
  return root;
}

function openPhoto(index: number): void {
  activePhotoIndex = index;
  mountOverlay(`<div class="overlay photo-overlay" role="dialog" aria-modal="true" aria-label="Photo viewer">
    <button class="close-button" data-close aria-label="Close">×</button>
    <button class="photo-nav photo-nav-prev" data-photo-prev aria-label="Previous photo">←</button>
    <figure class="photo-modal">
      <img data-modal-image src="" alt="" />
      <figcaption><strong data-modal-day></strong><time data-modal-date></time></figcaption>
    </figure>
    <button class="photo-nav photo-nav-next" data-photo-next aria-label="Next photo">→</button>
  </div>`);
  document.querySelector("[data-photo-prev]")?.addEventListener("click", () => stepPhoto(-1));
  document.querySelector("[data-photo-next]")?.addEventListener("click", () => stepPhoto(1));
  showActivePhoto();
}

function showActivePhoto(): void {
  if (activePhotoIndex === null) return;
  const items = galleryItems();
  const item = items[activePhotoIndex];
  if (!item) return;
  const src = item.photo?.url ?? placeholder;
  const date = formatTakenAt(item.photo?.takenAt ?? null);
  const figure = document.querySelector<HTMLElement>(".photo-modal")!;
  const image = figure.querySelector<HTMLImageElement>("[data-modal-image]")!;
  image.src = src;
  image.alt = `Beard ${formatDay(item.day)}`;
  figure.classList.toggle("is-placeholder", !item.photo);
  figure.querySelector<HTMLElement>("[data-modal-day]")!.textContent = formatDay(item.day);
  const time = figure.querySelector<HTMLTimeElement>("[data-modal-date]")!;
  time.textContent = date;
  time.dateTime = item.photo?.takenAt ?? "";
  document.querySelector<HTMLButtonElement>("[data-photo-prev]")!.disabled = findPhotoIndex(-1) === null;
  document.querySelector<HTMLButtonElement>("[data-photo-next]")!.disabled = findPhotoIndex(1) === null;
}

function findPhotoIndex(direction: -1 | 1): number | null {
  if (activePhotoIndex === null) return null;
  const items = galleryItems();
  for (let index = activePhotoIndex + direction; index >= 0 && index < items.length; index += direction) {
    if (items[index].photo) return index;
  }
  return null;
}

function stepPhoto(direction: -1 | 1): void {
  const next = findPhotoIndex(direction);
  if (next === null) return;
  activePhotoIndex = next;
  showActivePhoto();
}

function voteThumb(day: number, photos: Photo[], selectable = false): string {
  const photo = photos[0];
  return `<button class="vote-day" data-vote-day="${day}" ${selectable ? "" : "disabled"} aria-label="${selectable ? "Vote for" : "View"} ${formatDay(day)}">
    <img src="${photo?.url ?? placeholder}" alt="" /><span>${formatDay(day)}</span>
  </button>`;
}

function openVote(): void {
  if (!gallery.photos.length) return;
  if (voteStatus.hasVoted || voteStatus.isAdmin) {
    showResults();
    return;
  }
  const root = mountOverlay(`<div class="overlay vote-overlay" role="dialog" aria-modal="true" aria-label="Vote">
    <button class="close-button dark" data-close aria-label="Close">×</button>
    <div class="vote-panel review-panel">
      <div class="vote-grid review-grid">${gallery.photos.map((photo) => `<div class="vote-day review-photo">
        <img src="${photo.url}" alt="Beard ${formatDay(photo.beardDay)}" /><span>${formatDay(photo.beardDay)}</span>
      </div>`).join("")}</div>
      <button class="vote-now-button" id="vote-now-button">vote now</button>
    </div>
  </div>`);
  root.querySelector("#vote-now-button")?.addEventListener("click", showVotePicker);
}

function showVotePicker(): void {
  const days = voteDays();
  const root = mountOverlay(`<div class="overlay vote-overlay" role="dialog" aria-modal="true" aria-label="Pick your favorite beard day">
    <button class="close-button dark" data-close aria-label="Close">×</button>
    <div class="vote-panel"><p class="vote-prompt">pick one.</p>
      <div class="vote-grid pick-grid">${days.map(({ day, photos }) => voteThumb(day, photos, true)).join("")}</div>
    </div>
  </div>`);
  root.querySelectorAll<HTMLButtonElement>("[data-vote-day]").forEach((button) => {
    button.addEventListener("click", async () => {
      const day = Number(button.dataset.voteDay);
      button.classList.add("is-pending");
      try {
        await api("/api/votes", {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ beardDay: day }),
        });
        voteStatus.hasVoted = true;
        voteStatus.beardDay = day;
        await showResults();
      } catch (error) {
        button.classList.remove("is-pending");
        alert((error as Error).message);
      }
    });
  });
}

async function showResults(): Promise<void> {
  const root = mountOverlay(`<div class="overlay vote-overlay" role="dialog" aria-modal="true" aria-label="Vote results">
    <button class="close-button dark" data-close aria-label="Close">×</button>
    <div class="results-panel"><div class="results" id="results"><span class="loading-dot">·</span></div>
      <button class="change-vote" id="change-vote">${voteStatus.hasVoted ? "change my vote" : "vote"}</button>
    </div>
  </div>`);
  root.querySelector("#change-vote")?.addEventListener("click", showVotePicker);
  try {
    const data = await api<{ results: VoteResult[] }>("/api/votes/results");
    renderResults(data.results);
    connectVoteSocket();
  } catch (error) {
    if (!voteStatus.hasVoted && !voteStatus.isAdmin) showVotePicker();
    else document.querySelector("#results")!.textContent = (error as Error).message;
  }
}

function renderResults(results: VoteResult[]): void {
  const container = document.querySelector<HTMLElement>("#results");
  if (!container) return;
  const counts = new Map(results.map((result) => [result.beardDay, result.votes]));
  const total = results.reduce((sum, result) => sum + result.votes, 0);
  container.innerHTML = voteDays().map(({ day, photos }) => {
    const count = counts.get(day) ?? 0;
    const percentage = total ? Math.round(count / total * 100) : 0;
    return `<article class="result-card ${voteStatus.beardDay === day ? "is-mine" : ""}">
      <img src="${photos[0].url}" alt="Beard ${formatDay(day)}" />
      <div class="result-card-copy"><span>${formatDay(day)}</span><b>${count} ${count === 1 ? "vote" : "votes"} · ${percentage}%</b></div>
      <div class="result-bar" aria-label="${percentage}% of votes"><i style="width:${percentage}%"></i></div>
    </article>`;
  }).join("");
}

function connectVoteSocket(): void {
  voteSocket?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  voteSocket = new WebSocket(`${protocol}//${location.host}/api/votes/live`);
  voteSocket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data) as { type: string; results: VoteResult[] };
      if (data.type === "results") renderResults(data.results);
    } catch { /* Ignore malformed live messages. */ }
  });
}

async function initGallery(): Promise<void> {
  [gallery, voteStatus] = await Promise.all([
    api<GalleryData>("/api/gallery"),
    api<typeof voteStatus>("/api/vote/status"),
  ]);
  applySiteAppearance(gallery);
  renderGallery();
}

function renderAdminLogin(): void {
  app.innerHTML = `<main class="admin-login"><a class="wordmark" href="/">beard gallery</a>
    <form id="login-form"><label for="password">password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
      <button type="submit">enter</button><p class="form-message" id="login-message"></p></form>
  </main>`;
  document.querySelector<HTMLFormElement>("#login-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const message = document.querySelector<HTMLElement>("#login-message")!;
    try {
      await api("/api/admin/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: new FormData(form).get("password") }),
      });
      await initAdmin();
    } catch (error) { message.textContent = (error as Error).message; }
  });
}

async function readCaptureDate(file: File): Promise<string | null> {
  try {
    const exif = await parseExif(file, ["DateTimeOriginal", "CreateDate"]);
    const value = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (typeof value === "string") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  } catch { /* Some images do not contain readable EXIF data. */ }
  return null;
}

function readFilenameDate(filename: string): string | null {
  const match = filename.match(/(?:^|\D)(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
  return date.toISOString();
}

async function convertToWebp(file: File): Promise<File> {
  let source: ImageBitmap | HTMLImageElement;
  let objectUrl: string | null = null;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    objectUrl = URL.createObjectURL(file);
    source = new Image();
    source.decoding = "async";
    source.src = objectUrl;
    try {
      await source.decode();
    } catch {
      URL.revokeObjectURL(objectUrl);
      throw new Error(`${file.name} could not be read by this browser`);
    }
  }
  const maxDimension = 3200;
  const sourceWidth = source instanceof ImageBitmap ? source.width : source.naturalWidth;
  const sourceHeight = source instanceof ImageBitmap ? source.height : source.naturalHeight;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Image conversion is unavailable");
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  if (source instanceof ImageBitmap) source.close();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", .90));
  if (!blob || blob.type !== "image/webp") throw new Error("This browser could not convert the photo to WebP");
  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${baseName}.webp`, { type: "image/webp", lastModified: file.lastModified });
}

function adminPhotoRow(photo: Photo): string {
  return `<article class="admin-photo" data-photo-id="${photo.id}">
    <img src="${photo.url}" alt="" /><div class="admin-photo-fields">
      <span class="filename">${escapeHtml(photo.originalName ?? "photo")}</span>
      <label>day <input class="day-input" type="number" min="0" max="10000" value="${photo.beardDay}" /></label>
      <label>taken <input class="taken-input" type="datetime-local" value="${toLocalInput(photo.takenAt)}" /></label>
      <div><button class="delete-photo">delete</button><span class="row-message" aria-live="polite"></span></div>
    </div>
  </article>`;
}

function fontChoices(group: "logo" | "body", current: string): string {
  const sample = group === "logo" ? "beard gallery" : "day 24 · aug 11";
  return `<div class="font-options" data-font-group="${group}">${fontOptions.map((option) =>
    `<button type="button" class="font-option ${option.id === current ? "is-selected" : ""}" data-${group}-font="${option.id}" aria-pressed="${option.id === current}" style="--choice-font:${escapeHtml(option.family)}">
      <span>${sample}</span><small>${option.label}</small>
    </button>`).join("")}</div>`;
}

function appearanceSettings(data: GalleryData): string {
  const presets = ["#f2df64", "#eee9df", "#d7e5cf", "#cfdde8", "#edcfca", "#ded2ef"];
  return `<section class="settings-card" aria-labelledby="appearance-heading">
    <div class="settings-heading"><span id="appearance-heading">appearance</span><small>click to preview and publish</small></div>
    <div class="appearance-controls">
      <div class="setting-row"><span class="setting-label">background</span><div class="color-controls">
        <label class="color-picker-label" aria-label="Choose background color"><input id="background-color" type="color" value="${data.backgroundColor}" /></label>
        <label class="hex-label">hex <input id="background-hex" type="text" value="${data.backgroundColor}" maxlength="7" spellcheck="false" /></label>
        <div class="color-presets" aria-label="Background color presets">${presets.map((preset) =>
          `<button type="button" data-color="${preset}" style="--preset:${preset}" aria-label="Use ${preset}"></button>`).join("")}</div>
        <span class="setting-message" id="color-message" aria-live="polite"></span>
      </div></div>
      <div class="setting-row"><div class="setting-title"><span class="setting-label">logo font</span><span class="setting-message" id="logo-font-message" aria-live="polite"></span></div>${fontChoices("logo", data.logoFont)}</div>
      <div class="setting-row"><div class="setting-title"><span class="setting-label">site font</span><span class="setting-message" id="body-font-message" aria-live="polite"></span></div>${fontChoices("body", data.bodyFont)}</div>
    </div>
  </section>`;
}

async function initAdmin(): Promise<void> {
  const status = await api<{ authenticated: boolean }>("/api/admin/status");
  if (!status.authenticated) { renderAdminLogin(); return; }
  const data = await api<GalleryData>("/api/admin/photos");
  gallery = data;
  applySiteAppearance(data);
  app.innerHTML = `<main class="admin-shell">
    <header class="admin-header"><a class="wordmark" href="/">beard gallery</a><div><a href="/">gallery</a><button id="logout">log out</button></div></header>
    ${appearanceSettings(data)}
    <section class="upload-card"><form id="upload-form">
      <label>beard day <input name="beardDay" type="number" min="0" max="10000" required /></label>
      <label class="file-label">photos <input name="photos" type="file" accept="image/*" multiple required /></label>
      <button type="submit">upload</button><p class="form-message" id="upload-message"></p>
    </form></section>
    <section class="admin-list" id="admin-list">${data.photos.length ? data.photos.map(adminPhotoRow).join("") : `<p class="admin-empty">no photos yet.</p>`}</section>
  </main>`;

  document.querySelector("#logout")?.addEventListener("click", async () => { await api("/api/admin/logout", { method: "POST" }); renderAdminLogin(); });
  document.querySelector<HTMLFormElement>("#upload-form")!.addEventListener("submit", handleUpload);
  bindBackgroundSettings();
  bindAdminRows();
}

function bindBackgroundSettings(): void {
  const picker = document.querySelector<HTMLInputElement>("#background-color")!;
  const hex = document.querySelector<HTMLInputElement>("#background-hex")!;
  const message = document.querySelector<HTMLElement>("#color-message")!;
  let timer = 0;
  let version = 0;

  const save = (color: string, immediate = false) => {
    applyBackgroundColor(color);
    picker.value = color;
    hex.value = color;
    gallery.backgroundColor = color;
    window.clearTimeout(timer);
    const currentVersion = ++version;
    message.textContent = "saving…";
    timer = window.setTimeout(async () => {
      try {
        await api("/api/admin/settings", {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ backgroundColor: color }),
        });
        if (currentVersion === version) message.textContent = "saved";
      } catch (error) {
        if (currentVersion === version) message.textContent = (error as Error).message;
      }
    }, immediate ? 0 : 500);
  };

  picker.addEventListener("input", () => save(picker.value.toLowerCase()));
  hex.addEventListener("input", () => {
    const value = hex.value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(value)) save(value);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((button) => {
    button.addEventListener("click", () => save(button.dataset.color!, true));
  });

  const selectFont = (group: "logo" | "body", font: string) => {
    const key = group === "logo" ? "logoFont" : "bodyFont";
    const fontMessage = document.querySelector<HTMLElement>(`#${group}-font-message`)!;
    if (group === "logo") gallery.logoFont = font;
    else gallery.bodyFont = font;
    applyFontSettings(gallery.logoFont, gallery.bodyFont);
    document.querySelectorAll<HTMLButtonElement>(`[data-font-group="${group}"] .font-option`).forEach((button) => {
      const selected = button.dataset[`${group}Font`] === font;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    fontMessage.textContent = "saving…";
    void api("/api/admin/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [key]: font }),
    }).then(() => { fontMessage.textContent = "saved"; })
      .catch((error: Error) => { fontMessage.textContent = error.message; });
  };

  document.querySelectorAll<HTMLButtonElement>("[data-logo-font]").forEach((button) => {
    button.addEventListener("click", () => selectFont("logo", button.dataset.logoFont!));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-body-font]").forEach((button) => {
    button.addEventListener("click", () => selectFont("body", button.dataset.bodyFont!));
  });
}

async function handleUpload(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const message = document.querySelector<HTMLElement>("#upload-message")!;
  const data = new FormData(form);
  const sourceFiles = data.getAll("photos").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (!sourceFiles.length) return;
  button.disabled = true;
  message.textContent = "reading photo dates…";
  const captureDates = await Promise.all(sourceFiles.map(async (file) => readFilenameDate(file.name) ?? await readCaptureDate(file)));
  message.textContent = "converting to webp…";
  let convertedFiles: File[];
  try {
    convertedFiles = await Promise.all(sourceFiles.map(convertToWebp));
  } catch (error) {
    message.textContent = (error as Error).message;
    button.disabled = false;
    return;
  }
  const uploadData = new FormData();
  uploadData.set("beardDay", String(data.get("beardDay")));
  convertedFiles.forEach((file) => uploadData.append("photos", file));
  const metadata = convertedFiles.map((file, index) => ({
    name: file.name, lastModified: file.lastModified, takenAt: captureDates[index],
    originalName: sourceFiles[index].name,
  }));
  uploadData.set("metadata", JSON.stringify(metadata));
  message.textContent = "uploading…";
  try {
    await api("/api/admin/photos", { method: "POST", body: uploadData });
    form.reset();
    await initAdmin();
  } catch (error) {
    message.textContent = (error as Error).message;
    button.disabled = false;
  }
}

function bindAdminRows(): void {
  document.querySelectorAll<HTMLElement>(".admin-photo").forEach((row) => {
    const dayInput = row.querySelector<HTMLInputElement>(".day-input")!;
    const takenInput = row.querySelector<HTMLInputElement>(".taken-input")!;
    const message = row.querySelector<HTMLElement>(".row-message")!;
    let timer = 0;
    let version = 0;

    const save = () => {
      window.clearTimeout(timer);
      const currentVersion = ++version;
      message.textContent = "saving…";
      timer = window.setTimeout(async () => {
        const takenValue = takenInput.value;
        try {
          await api(`/api/admin/photos/${row.dataset.photoId}`, {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              beardDay: Number(dayInput.value),
              takenAt: takenValue ? new Date(takenValue).toISOString() : null,
            }),
          });
          if (currentVersion === version) message.textContent = "saved";
        } catch (error) {
          if (currentVersion === version) message.textContent = (error as Error).message;
        }
      }, 600);
    };

    dayInput.addEventListener("input", save);
    takenInput.addEventListener("input", save);
    row.querySelector(".delete-photo")?.addEventListener("click", async () => {
      if (!confirm("Delete this photo?")) return;
      await api(`/api/admin/photos/${row.dataset.photoId}`, { method: "DELETE" });
      row.remove();
    });
  });
}

async function boot(): Promise<void> {
  try {
    if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) await initAdmin();
    else await initGallery();
  } catch (error) {
    app.innerHTML = `<p class="fatal-error">${escapeHtml((error as Error).message)}</p>`;
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOverlay();
  else if (event.key === "ArrowLeft" && activePhotoIndex !== null) {
    event.preventDefault();
    stepPhoto(-1);
  } else if (event.key === "ArrowRight" && activePhotoIndex !== null) {
    event.preventDefault();
    stepPhoto(1);
  }
});
void boot();
