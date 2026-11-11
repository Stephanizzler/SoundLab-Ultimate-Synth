// Records the how-to video (public/tutorial.mp4, .vtt captions, poster) by
// driving the real app in headless Chromium: a drawn pointer, captions burned
// in, and the app's own audio captured from its AudioContext.
//   npm run build && npx vite preview --port 4173 &  node tools/record-tutorial.cjs
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");

const URL_ = process.env.APP_URL ?? "http://localhost:4173/?intro=0";
const OUT = path.join(__dirname, "..", "public");
const W = 1280, H = 720;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tutorial-"));

// Runs in the page before the app: the pointer, the caption bar, and a tap on
// everything the app connects to its speakers, recorded with MediaRecorder.
function overlay() {
  const css = `
  #tCursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:99999;pointer-events:none;transform:translate(-3px,-2px);transition:none}
  #tCursor svg{filter:drop-shadow(0 2px 3px #000a)}
  .tRipple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #F5A524;z-index:99998;pointer-events:none;animation:tR .6s ease-out forwards}
  @keyframes tR{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
  #tCap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1040px;z-index:99997;pointer-events:none;background:#0D0F12ee;color:#E8EBF0;border:1px solid #F5A52488;border-radius:12px;padding:12px 20px;font:600 21px/29px system-ui,sans-serif;text-align:center;box-shadow:0 10px 30px #000c;opacity:0;transition:opacity .25s}
  #tCap.on{opacity:1}
  body{-webkit-user-select:none;user-select:none}
  #tCap b{color:#F5A524}
  #tCard{position:fixed;inset:0;z-index:99996;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:radial-gradient(circle at 50% 40%,#1D2128,#0D0F12 70%);color:#E8EBF0;font-family:system-ui,sans-serif;opacity:0;transition:opacity .5s;pointer-events:none}
  #tCard.on{opacity:1}
  #tCard h1{font:700 54px/1.1 Michroma,system-ui,sans-serif;letter-spacing:1px;margin:0}
  #tCard h1 b{color:#F5A524}
  #tCard p{font:500 24px/1.4 system-ui,sans-serif;color:#8B93A1;margin:0;text-align:center}`;
  addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style"); st.textContent = css; document.head.append(st);
    const c = document.createElement("div"); c.id = "tCursor";
    c.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 23 L7.5 17.5 L11.5 26 L15 24.5 L11 16 L19 16 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const cap = document.createElement("div"); cap.id = "tCap";
    const card = document.createElement("div"); card.id = "tCard";
    document.body.append(card, cap, c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => { const r = document.createElement("div"); r.className = "tRipple"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.body.append(r); setTimeout(() => r.remove(), 700); }, true);
  });
  window.__tour = {
    caption(html) { const el = document.getElementById("tCap"); if (!html) { el.classList.remove("on"); return; } el.innerHTML = html; el.classList.add("on"); },
    card(html) { const el = document.getElementById("tCard"); if (!html) { el.classList.remove("on"); return; } el.innerHTML = html; el.classList.add("on"); },
  };
  // Audio tap.
  const orig = AudioNode.prototype.connect;
  let rec = null, chunks = [], recStart = 0;
  AudioNode.prototype.connect = function (dst, ...rest) {
    if (dst instanceof AudioDestinationNode && !rec) {
      const ctx = this.context, tap = ctx.createMediaStreamDestination();
      orig.call(this, tap);
      rec = new MediaRecorder(tap.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128000 });
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start(1000); recStart = Date.now();
    } else if (dst instanceof AudioDestinationNode && rec) {
      // A second connection to the speakers (none today) would be recorded too.
    }
    return orig.call(this, dst, ...rest);
  };
  window.__audio = () => new Promise((res) => {
    if (!rec) return res(null);
    rec.onstop = async () => { const b = new Blob(chunks, { type: "audio/webm" }); const buf = new Uint8Array(await b.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768)); res({ data: btoa(s), start: recStart }); };
    rec.stop();
  });
}

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: { width: W, height: H } } });
  const t0 = Date.now();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(overlay);
  await page.goto(URL_);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("soundlab.synth.intro", "off"); });
  await page.reload();
  await page.waitForTimeout(600);

  const cues = [];
  const now = () => (Date.now() - t0) / 1000;
  let cueStart = 0, cueText = "";
  const wait = (ms) => page.waitForTimeout(ms);
  let mouse = { x: W / 2, y: H / 2 };
  await page.mouse.move(mouse.x, mouse.y);
  async function caption(html) {
    if (cueText) cues.push([cueStart, now(), cueText]);
    cueText = html ? html.replace(/<[^>]+>/g, "") : ""; cueStart = now();
    await page.evaluate((x) => window.__tour.caption(x), html);
  }
  async function card(html, ms) { await page.evaluate((x) => window.__tour.card(x), html); await wait(ms); await page.evaluate(() => window.__tour.card(null)); await wait(500); }
  async function glide(x, y, ms = 650) {
    const steps = Math.max(8, Math.round(ms / 16)), from = { ...mouse };
    for (let i = 1; i <= steps; i++) { const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e); }
    mouse = { x, y };
  }
  async function show(sel, block = "center") {
    await page.locator(sel).first().evaluate((el, b) => el.scrollIntoView({ behavior: "smooth", block: b }), block);
    await wait(900);
  }
  async function centre(sel) {
    let b = await page.locator(sel).first().boundingBox();
    if (b.y < 90 || b.y + b.height > H - 130) { // off screen, under the transport or the caption: bring it in
      await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })); await wait(900);
      b = await page.locator(sel).first().boundingBox();
    }
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
  }
  async function point(sel, ms) { const c = await centre(sel); await glide(c.x, c.y, ms); return c; }
  async function click(sel) { const c = await point(sel); await wait(150); await page.locator(sel).first().click({ position: { x: c.b.width / 2, y: c.b.height / 2 } }); mouse = { x: c.x, y: c.y }; await wait(250); }
  async function scrollBy(dy) { await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), dy); await wait(800); }

  // 0. Title.
  await card("<h1>SOUND<b>LAB</b> Ultimate Synth</h1><p>How to use it · two minutes</p>", 3200);

  // 1. Play.
  await caption("Press <b>Play</b> to hear the demo groove. Everything runs on your device; nothing is uploaded.");
  await click("#play");
  await wait(3200);
  await caption("The <b>scope</b> and <b>spectrum analyser</b> show what's coming out.");
  await show("#scopePanel", "start"); await scrollBy(-70);
  await point("#spectrum"); await wait(3000);

  // 2. Rack (close the drum machine's panel first so the rack fits).
  if (await page.locator("#slot0 .uhead button[aria-expanded=true]").count()) await page.locator("#slot0 .uhead button[aria-expanded=true]").click();
  await caption("<b>The rack</b> has eight slots. Each holds a machine modelled on a classic synth or drum machine.");
  await show("#rackPanel", "start"); await scrollBy(-80);
  await point("#slot2 select.machine"); await wait(3200);
  await caption("Choose the machine for a slot here: Moog, Prophet, Juno, Jupiter, Virus, Nord, DX7, 303, 808, 909 and more.");
  await click("#slot2 select.machine"); await page.keyboard.press("Escape"); await wait(2600);
  await caption("Pick a <b>preset</b>. They're grouped by type: bass, leads, pads, strings, keys, bells…");
  await click("#slot2 select.preset"); await page.keyboard.press("Escape");
  await page.selectOption("#slot2 select.preset", { index: 4 }); await wait(2400);
  await caption("Press <b>▶</b> beside the preset to audition it with a phrase that suits it.");
  await click("#play"); await wait(300); // stop the groove so the audition is heard
  await show("#rackPanel", "start"); await scrollBy(-80);
  await click('#slot2 button[aria-label="Audition slot 3"]'); await wait(4200);

  // 3. Faceplate.
  await caption("Open a slot to see its <b>faceplate</b>: the knobs and switches of the original.");
  await click('#slot2 .uhead button[aria-expanded]'); await wait(900);
  await show("#slot2 .face", "start"); await scrollBy(-90); await wait(1600);
  await caption("Drag a fader or knob up or down: here the filter frequency, while the groove plays.");
  const k = await point('#slot2 .fader[aria-label="Frequency"]');
  await click('#play'); await wait(400);
  const kn = await centre('#slot2 .fader[aria-label="Frequency"]'); await glide(kn.x, kn.y, 400);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) { await page.mouse.move(kn.x, kn.y - i * 2.5); await wait(35); }
  for (let i = 40; i > -20; i--) { await page.mouse.move(kn.x, kn.y - i * 2.5); await wait(30); }
  await page.mouse.up(); mouse = { x: kn.x, y: kn.y + 50 };
  await wait(1200); void k;
  await click('#slot2 .uhead button[aria-expanded]');

  // 3b. Mixer.
  await caption("Every slot plays through <b>the mixer</b>: level, pan, delay and reverb sends, mute and solo. Nothing to wire.");
  await show("#mixerPanel", "start"); await scrollBy(-80);
  await point("#mixer .strip:nth-child(3) .fader"); await wait(4200);
  await caption("If you hear nothing, watch the meters here, and check your volume (and on iPhone, the silent switch).");
  await point("#meterM"); await wait(3800);

  // 4. Sequencer.
  await caption("<b>The sequencer</b>: eight tracks of up to 64 steps. Click a step to turn it on or off.");
  await show("#seqPanel", "start"); await scrollBy(-80);
  for (const s of ["#st7_2", "#st7_6", "#st7_10"]) { if (await page.locator(s).count()) await click(s); }
  await wait(1800);
  await caption("Each track plays one or more slots. The lanes below set notes, velocity, length, chords, slides and CV for patching.");
  await scrollBy(220); await wait(4200);

  // 5. Piano roll.
  await caption("Or draw notes in the <b>piano roll</b>, from C1 to C7. Several notes on one step make a chord.");
  await show("#rollPanel", "start"); await scrollBy(-80);
  await page.locator(".prscroll").evaluate((el) => (el.scrollTop = (96 - 64) * 14 - 120));
  await wait(400);
  const g = await page.locator(".prgrid").boundingBox();
  for (const [step, row] of [[4, 4], [4, 7], [4, 11], [12, 2]]) {
    const x = g.x + step * 24 + 10, y = g.y + (96 - 64) * 14 + row * 14 - 14 * 4 + 7;
    await glide(x, y, 450); await page.mouse.down(); await wait(80); await page.mouse.up(); await wait(450);
  }
  await wait(2200);

  // 6. Patch bay and the back of the rack.
  await caption("<b>The patch bay</b> sends LFOs, macros, the mod wheel and sequencer lanes to any knob.");
  await show("#patchPanel", "start"); await scrollBy(-80); await wait(3200);
  await caption("Switch to <b>Graph</b> to see every connection as a modular patch.");
  await click("#patch .seg:has-text('Graph')"); await wait(3600);
  await caption("Or <b>flip the rack</b> round and plug cables straight into each module's jacks.");
  await show("#rackPanel", "start"); await scrollBy(-80);
  await click("text=⟲ Flip rack"); await wait(1200);
  await show('.jack[data-port="s0.follow"]'); await wait(300);
  await caption("Drag from an output to an input. Here the drums' level ducks the chords: <b>sidechain</b> pumping.");
  const from = await centre('.jack[data-port="s0.follow"]');
  await glide(from.x, from.y - from.b.height / 2 + 10, 600); await page.mouse.down();
  const to = await centre('.jack[data-port="s2.level"]');
  await glide(to.x, to.y - to.b.height / 2 + 10, 1400); await page.mouse.up(); await wait(2600);
  await show("#rackPanel", "start"); await scrollBy(-80);
  await click("text=⟲ Show the front"); await wait(600);

  // 7. Playing.
  await caption("<b>Play</b> with the on-screen keys, your computer keyboard (A to K), or a USB or Bluetooth MIDI keyboard.");
  await click("#play"); await wait(200);
  await show("#playPanel", "start"); await scrollBy(-80);
  for (const n of [60, 64, 67, 72, 67, 64]) {
    const c = await centre(`#keys .kbd [data-note="${n}"]`); const y = c.b.y + c.b.height * 0.8;
    await glide(c.x, y, 260); await page.mouse.down(); await wait(240); await page.mouse.up(); mouse = { x: c.x, y };
  }
  await wait(800);
  await caption("<b>MIDI learn</b>: press it, click a knob, then turn a knob on your controller. One hardware knob can move many.");
  await point("#keys button:has-text('MIDI learn')"); await wait(4200);

  // 8. Undo, autosave, render.
  await caption("Every change can be <b>undone</b>, and your session is saved automatically every ten seconds.");
  await point("#undo"); await wait(3600);
  await caption("<b>Render</b> to a WAV file, export MIDI, or save into a SoundLab project.");
  await click("#play"); await wait(200);
  await show("#filePanel", "start"); await scrollBy(-80);
  await click("#render");
  await page.waitForSelector("#result:not([hidden])", { timeout: 60000 }).catch(() => {});
  await wait(3000);

  // 9. Settings.
  await caption("Watch this video again any time from the <b>⚙ settings</b> button at the top.");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); await wait(900);
  await point("#settingsBtn"); await wait(3200);
  await caption(null);
  await card("<h1>SOUND<b>LAB</b> Ultimate Synth</h1><p>Now make something.</p>", 3000);

  const audio = await page.evaluate(() => window.__audio());
  const end = now();
  await page.close(); await context.close(); await browser.close();
  if (errors.length) console.warn("page errors:\n" + errors.join("\n"));

  const video = fs.readdirSync(tmp).find((f) => f.endsWith(".webm"));
  const args = ["-y", "-i", path.join(tmp, video)];
  if (audio) {
    fs.writeFileSync(path.join(tmp, "audio.webm"), Buffer.from(audio.data, "base64"));
    args.push("-itsoffset", String((audio.start - t0) / 1000), "-i", path.join(tmp, "audio.webm"), "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "128k", "-af", "apad");
  } else console.warn("no audio captured");
  args.push("-t", String(end), "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", path.join(OUT, "tutorial.mp4"));
  execFileSync("ffmpeg", args, { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-ss", "1.8", "-i", path.join(OUT, "tutorial.mp4"), "-frames:v", "1", "-q:v", "4", path.join(OUT, "tutorial-poster.jpg")], { stdio: "ignore" });
  const ts = (s) => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`; };
  fs.writeFileSync(path.join(OUT, "tutorial.vtt"), "WEBVTT\n\n" + cues.map(([a, b, t], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${t}\n`).join("\n"));
  console.log(`tutorial: ${end.toFixed(1)} s, ${(fs.statSync(path.join(OUT, "tutorial.mp4")).size / 1e6).toFixed(1)} MB, ${cues.length} captions`);
})();
