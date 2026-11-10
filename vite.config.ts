import { defineConfig, type Plugin } from "vite";
import { build } from "esbuild";

// `import code from "./worklet.ts?worklet"` gives the AudioWorklet's code as
// one bundled string. The page loads it from a Blob URL, so the worklet works
// from the dev server, GitHub Pages and a single-file artifact alike.
function inlineWorklet(): Plugin {
  return {
    name: "inline-worklet",
    async load(id) {
      if (!id.endsWith("?worklet")) return null;
      const file = id.slice(0, -"?worklet".length);
      const r = await build({ entryPoints: [file], bundle: true, write: false, format: "iife", target: "es2020", minify: true, metafile: true });
      for (const input of Object.keys(r.metafile.inputs)) this.addWatchFile(input);
      return `export default ${JSON.stringify(r.outputFiles[0].text)};`;
    },
  };
}
export default defineConfig({ base: "./", plugins: [inlineWorklet()], worker: { format: "es" } });
