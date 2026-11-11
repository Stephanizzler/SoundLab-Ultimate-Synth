// The cog's settings window: the how-to video (shown when the app opens until
// the user turns that off) and the sound engine choice.
import { h } from "./ui.ts";

const INTRO_KEY = "soundlab.synth.intro";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not stored: fine */ } };

export function setupSettings() {
  const dlg = document.getElementById("settings") as HTMLDialogElement;
  const video = document.getElementById("tutorial") as HTMLVideoElement;
  const onLaunch = document.getElementById("introOnLaunch") as HTMLInputElement;
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    video.poster = "./tutorial-poster.jpg";
    video.append(h("source", { src: "./tutorial.mp4", type: "video/mp4" }));
    const track = h("track", { kind: "captions", src: "./tutorial.vtt", srclang: "en", label: "English", default: "" }) as HTMLTrackElement;
    video.append(track);
    video.load();
    video.addEventListener("error", () => { (document.getElementById("tutorialNote") as HTMLElement).textContent = "The video couldn't be loaded here. It plays in the installed app and at the GitHub Pages address."; }, { once: true });
  };
  const open = (focusVideo: boolean) => {
    load();
    if (!dlg.open) dlg.showModal();
    if (focusVideo) document.getElementById("howto")?.scrollIntoView({ block: "start" });
  };
  const close = () => { video.pause(); if (dlg.open) dlg.close(); };
  onLaunch.checked = get(INTRO_KEY) !== "off";
  onLaunch.addEventListener("change", () => set(INTRO_KEY, onLaunch.checked ? "on" : "off"));
  document.getElementById("settingsBtn")!.addEventListener("click", () => open(false));
  document.getElementById("settingsClose")!.addEventListener("click", close);
  document.getElementById("settingsDone")!.addEventListener("click", close);
  dlg.addEventListener("close", () => video.pause());
  // A click on the backdrop closes it.
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  // When the app opens: the how-to video, unless turned off (or ?intro=0).
  if (onLaunch.checked && new URLSearchParams(location.search).get("intro") !== "0") open(true);
  return { open };
}
