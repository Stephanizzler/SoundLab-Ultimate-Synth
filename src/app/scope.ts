// Output scope and spectrum analyser, drawn from an AnalyserNode on the
// synth's output. Draws only while the panel is on screen and the page visible.

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function fit(c: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

export function startScopes(analyser: AnalyserNode, scope: HTMLCanvasElement, spectrum: HTMLCanvasElement, readout: HTMLElement) {
  const time = new Float32Array(analyser.fftSize), freq = new Float32Array(analyser.frequencyBinCount), hold = new Float32Array(analyser.frequencyBinCount).fill(-200);
  const rate = analyser.context.sampleRate;
  let visible = true, raf = 0;
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) loop(); });
  io.observe(scope);

  const drawScope = () => {
    const { g, w, h } = fit(scope);
    analyser.getFloatTimeDomainData(time);
    g.fillStyle = css("--bg", "#0d0f12"); g.fillRect(0, 0, w, h);
    g.strokeStyle = css("--line", "#2a2f38"); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); for (let k = 1; k < 4; k++) { g.moveTo((w * k) / 4, 0); g.lineTo((w * k) / 4, h); } g.stroke();
    // Trigger on a rising zero crossing so a steady note stands still.
    const span = 1024;
    let start = 0;
    for (let i = 1; i < time.length - span; i++) if (time[i - 1] < 0 && time[i] >= 0) { start = i; break; }
    let peak = 0;
    g.strokeStyle = css("--accent", "#f5a524"); g.lineWidth = 1.6; g.beginPath();
    for (let i = 0; i < span; i++) {
      const v = time[start + i]; peak = Math.max(peak, Math.abs(v));
      const x = (i / (span - 1)) * w, y = h / 2 - v * (h / 2) * 0.95;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    return peak;
  };
  const drawSpectrum = () => {
    const { g, w, h } = fit(spectrum);
    analyser.getFloatFrequencyData(freq);
    g.fillStyle = css("--bg", "#0d0f12"); g.fillRect(0, 0, w, h);
    const lo = Math.log10(20), hi = Math.log10(Math.min(20000, rate / 2));
    const xOf = (hz: number) => ((Math.log10(hz) - lo) / (hi - lo)) * w;
    const yOf = (db: number) => Math.min(h, Math.max(0, (-db / 96) * h));
    // Grid: decades and every 24 dB.
    g.strokeStyle = css("--line", "#2a2f38"); g.fillStyle = css("--muted", "#8b93a1"); g.font = "10px 'JetBrains Mono', monospace"; g.lineWidth = 1;
    g.beginPath();
    for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = xOf(hz); g.moveTo(x, 0); g.lineTo(x, h); }
    for (const db of [-24, -48, -72]) { const y = yOf(db); g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
    for (const [hz, t] of [[100, "100"], [1000, "1k"], [10000, "10k"]] as const) g.fillText(t, xOf(hz) + 3, h - 4);
    for (const db of [-24, -48, -72]) g.fillText(`${db}`, 3, yOf(db) - 3);
    // Spectrum (filled) and decaying peak hold.
    const binHz = rate / analyser.fftSize;
    g.beginPath(); g.moveTo(0, h);
    let px = -1;
    for (let b = 1; b < freq.length; b++) {
      const hz = b * binHz; if (hz < 20) continue; if (hz > 20000) break;
      const x = xOf(hz); if (x - px < 0.75) continue; px = x;
      hold[b] = Math.max(freq[b], hold[b] - 0.6);
      g.lineTo(x, yOf(freq[b]));
    }
    g.lineTo(w, h); g.closePath();
    const acc = css("--info", "#6ea8ff");
    g.fillStyle = acc + "55"; g.fill(); g.strokeStyle = acc; g.lineWidth = 1.2; g.stroke();
    g.strokeStyle = css("--text", "#e8ebf0"); g.globalAlpha = 0.6; g.beginPath(); px = -1;
    for (let b = 1; b < hold.length; b++) {
      const hz = b * binHz; if (hz < 20) continue; if (hz > 20000) break;
      const x = xOf(hz); if (x - px < 1.5) continue; px = x;
      if (b === 1) g.moveTo(x, yOf(hold[b])); else g.lineTo(x, yOf(hold[b]));
    }
    g.stroke(); g.globalAlpha = 1;
  };
  function loop() {
    cancelAnimationFrame(raf);
    if (!visible || document.hidden) return;
    const peak = drawScope(); drawSpectrum();
    readout.textContent = peak > 0 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS peak` : "silent";
    raf = requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", loop);
  loop();
}
