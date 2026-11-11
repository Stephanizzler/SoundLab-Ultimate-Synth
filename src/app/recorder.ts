// Recording: press ● Rec to capture what the rack plays (from the sequencer,
// the on-screen keys, a MIDI keyboard) as audio (WAV), MIDI, or both. Takes
// are kept in this browser (IndexedDB), can be played back, renamed, shared
// (the share sheet on phones and tablets; a download elsewhere), downloaded,
// and their MIDI put on a sequencer track.
import { takeMidi, takeWav, type RecNote, type TakeParts } from "../engine/takes.ts";
import type { RecChunk, ToWorklet } from "./synthcore.ts";
import { h } from "./ui.ts";

export type Take = { id: string; name: string; created: number; seconds: number; bpm: number; wav: Blob | null; mid: Blob | null };
export type RecorderCtx = {
  send: (m: ToWorklet) => void;
  ensureAudio: () => Promise<boolean>;
  playing: () => boolean;
  setTransport: (on: boolean) => void; // start or stop the sequencer
  sessionName: () => string;
  bpm: () => number;
  slots: () => { name: string; drum: boolean }[];
  status: (s: string) => void;
  error: (s: string) => void;
  download: (name: string, bytes: Uint8Array, type: string) => Promise<void>;
  putOnTrack: (bytes: Uint8Array, name: string) => void;
};

const MAX_SECONDS = 20 * 60; // about 230 MB of 16-bit stereo at 48 kHz
const OPTS_KEY = "soundlab.synth.recopts";

/* ---------------- Storage ---------------- */
function db(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open("soundlab-synth", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("takes", { keyPath: "id" });
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch { res(null); }
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((res) => { try { const r = f(d.transaction("takes", mode).objectStore("takes")); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); } });
}
const loadTakes = async () => ((await tx("readonly", (s) => s.getAll() as IDBRequest<Take[]>)) ?? []).sort((a, b) => b.created - a.created);
const saveTake = (t: Take) => tx("readwrite", (s) => s.put(t));
const deleteTake = (id: string) => tx("readwrite", (s) => s.delete(id));

const safe = (s: string) => s.replace(/[^\w .()-]+/g, "").trim().slice(0, 80) || "Take";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function setupRecorder(ctx: RecorderCtx, recBtn: HTMLButtonElement, timer: HTMLElement, host: HTMLElement) {
  const opts = (() => { try { return { audio: true, midi: true, withSeq: true, ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? "{}") }; } catch { return { audio: true, midi: true, withSeq: true }; } })();
  const saveOpts = () => { try { localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch { /* fine */ } };
  let takes: Take[] = [], memoryOnly = false;
  let cur: (TakeParts & { audio: boolean; midi: boolean; startedSeq: boolean; t0: number; samples: number; bpm: number; slots: { name: string; drum: boolean }[] }) | null = null;
  let timerId = 0;
  const urls = new Map<string, string>();

  // Audio thread → page.
  function onChunk(r: RecChunk) {
    if (!cur) return;
    if (r.pcm?.length) { cur.pcm.push(r.pcm); cur.samples += r.pcm.length / 2; }
    for (const n of r.notes) cur.notes.push(n as RecNote);
    cur.rate = r.rate; cur.start = r.start;
    if (cur.samples / r.rate > MAX_SECONDS) { ctx.status("Recording stopped at the 20-minute limit."); void stop(); }
    if (r.done) void finish();
  }

  async function start() {
    if (!opts.audio && !opts.midi) { ctx.error("Choose audio, MIDI or both to record."); return; }
    if (!(await ctx.ensureAudio())) return;
    cur = { rate: 48000, start: 0, end: 0, pcm: [], notes: [], audio: opts.audio, midi: opts.midi, startedSeq: false, t0: performance.now(), samples: 0, bpm: ctx.bpm(), slots: ctx.slots() };
    ctx.send({ type: "record", on: true, audio: opts.audio, midi: opts.midi });
    if (opts.withSeq && !ctx.playing()) { ctx.setTransport(true); cur.startedSeq = true; }
    recBtn.setAttribute("aria-pressed", "true"); recBtn.textContent = "■ Stop rec"; recBtn.classList.add("recording");
    timer.hidden = false;
    timerId = window.setInterval(() => { if (cur) timer.textContent = `● ${clock((performance.now() - cur.t0) / 1000)}`; }, 250);
    timer.textContent = "● 0:00";
    ctx.status(`Recording ${[opts.audio ? "audio" : "", opts.midi ? "MIDI" : ""].filter(Boolean).join(" and ")}${cur.startedSeq ? " with the sequencer" : ""}. Play anything; press ■ Stop rec when done.`);
  }
  async function stop() {
    if (!cur) return;
    ctx.send({ type: "record", on: false, audio: false, midi: false });
    if (cur.startedSeq && ctx.playing()) ctx.setTransport(false);
    clearInterval(timerId);
    recBtn.setAttribute("aria-pressed", "false"); recBtn.textContent = "● Rec"; recBtn.classList.remove("recording");
    timer.hidden = true;
  }
  async function finish() {
    const c = cur; cur = null;
    if (!c) return;
    c.end = c.start + c.samples;
    if (!c.audio) c.end = c.notes.length ? Math.max(...c.notes.map((n) => n[0])) : c.start;
    const seconds = c.audio ? c.samples / c.rate : (performance.now() - c.t0) / 1000;
    const name = `${ctx.sessionName() || "Synth"} take ${takes.length + 1}`;
    const midBytes = c.midi ? takeMidi({ ...c, end: c.audio ? c.end : c.start + seconds * c.rate }, c.bpm, name, c.slots) : null;
    const wavBytes = c.audio && c.samples > 0 ? takeWav(c.pcm, c.rate) : null;
    if (!wavBytes && !midBytes) { ctx.status("Nothing was recorded: no notes were played."); return; }
    const t: Take = { id: `t${Date.now().toString(36)}`, name, created: Date.now(), seconds, bpm: c.bpm,
      wav: wavBytes ? new Blob([wavBytes], { type: "audio/wav" }) : null, mid: midBytes ? new Blob([midBytes], { type: "audio/midi" }) : null };
    takes.unshift(t);
    if ((await saveTake(t)) === null) memoryOnly = true;
    render();
    ctx.status(`Recorded ${name} (${clock(seconds)}${t.wav ? ", audio" : ""}${t.mid ? ", MIDI" : midBytes === null && c.midi ? ", no notes for MIDI" : ""}). Share or download it below.`);
  }
  recBtn.addEventListener("click", () => void (cur ? stop() : start()));

  // Sharing: the system share sheet where the browser has one for files.
  async function share(t: Take, which: "wav" | "mid" | "both") {
    const files: File[] = [];
    if ((which === "wav" || which === "both") && t.wav) files.push(new File([t.wav], `${safe(t.name)}.wav`, { type: "audio/wav" }));
    if ((which === "mid" || which === "both") && t.mid) files.push(new File([t.mid], `${safe(t.name)}.mid`, { type: "audio/midi" }));
    if (!files.length) return;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files })) {
      try { await nav.share({ files, title: t.name, text: `${t.name}, made in SoundLab Ultimate Synth` }); ctx.status(`Shared ${t.name}.`); return; }
      catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    for (const f of files) await ctx.download(f.name, new Uint8Array(await f.arrayBuffer()), f.type);
    ctx.status(`This browser has no share sheet for files, so ${files.length > 1 ? "the files were" : "the file was"} downloaded instead. Send ${files.length > 1 ? "them" : "it"} from there.`);
  }

  function render() {
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
    const check = (key: "audio" | "midi" | "withSeq", label: string) => {
      const c = h("input", { type: "checkbox" }) as HTMLInputElement; c.checked = opts[key];
      c.addEventListener("change", () => { opts[key] = c.checked; saveOpts(); });
      return h("label", { class: "check" }, c, label);
    };
    const list = h("div", { class: "takes" });
    if (!takes.length) list.append(h("p", { class: "muted small" }, "No recordings yet. Press ● Rec at the top, play, then press ■ Stop rec."));
    for (const t of takes) {
      const nameIn = h("input", { type: "text", value: t.name, maxlength: 80, "aria-label": "Take name" }) as HTMLInputElement;
      nameIn.addEventListener("change", () => { t.name = nameIn.value.trim() || t.name; void saveTake(t); });
      const btn = (label: string, f: () => void, cls = "button small") => { const b = h("button", { class: cls }, label); b.addEventListener("click", f); return b; };
      const row = h("div", { class: "take" },
        h("div", { class: "row wrap" }, nameIn, h("span", { class: "muted small" }, `${clock(t.seconds)} · ${t.bpm} BPM · ${new Date(t.created).toLocaleString()} · ${[t.wav ? "audio" : "", t.mid ? "MIDI" : ""].filter(Boolean).join(" + ")}`)));
      if (t.wav) { const u = URL.createObjectURL(t.wav); urls.set(t.id, u); row.append(h("audio", { controls: "", src: u, preload: "metadata" })); }
      row.append(h("div", { class: "row wrap" },
        t.wav && t.mid ? btn("Share both", () => void share(t, "both"), "button small primary") : null,
        t.wav ? btn(t.mid ? "Share audio" : "Share", () => void share(t, "wav"), t.mid ? "button small" : "button small primary") : null,
        t.mid ? btn(t.wav ? "Share MIDI" : "Share", () => void share(t, "mid"), t.wav ? "button small" : "button small primary") : null,
        t.wav ? btn("Download WAV", async () => ctx.download(`${safe(t.name)}.wav`, new Uint8Array(await t.wav!.arrayBuffer()), "audio/wav")) : null,
        t.mid ? btn("Download MIDI", async () => ctx.download(`${safe(t.name)}.mid`, new Uint8Array(await t.mid!.arrayBuffer()), "audio/midi")) : null,
        t.mid ? btn("Put MIDI on the selected track", async () => ctx.putOnTrack(new Uint8Array(await t.mid!.arrayBuffer()), t.name)) : null,
        btn("Delete", () => { takes = takes.filter((x) => x !== t); void deleteTake(t.id); render(); }, "button small ghost")));
      list.append(row);
    }
    host.replaceChildren(
      h("div", { class: "row wrap" }, h("strong", {}, "Record"), check("audio", "Audio (WAV)"), check("midi", "MIDI"), check("withSeq", "Start the sequencer with the recording")),
      h("p", { class: "muted small" }, "● Rec captures everything you hear: the sequencer, the on-screen keys, a USB or Bluetooth MIDI keyboard, knob moves and cables. Audio records the master output; MIDI records the notes each slot plays, one track per slot. Takes stay in this browser until you delete them."
        + (memoryOnly ? " This browser isn't keeping them, so they'll be gone when you close the page: share or download what you want to keep." : "")),
      list);
  }
  void loadTakes().then((t) => { takes = t; render(); });
  render();
  return { onChunk, stop: () => void stop(), recording: () => !!cur };
}
