import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  // Secondary entries (delegate, delegate-remote) exist so the A2A integration
  // test (and any future programmatic caller) can import them without pulling
  // in src/index.ts's top-level `program.parse()` CLI bootstrap.
  entry: ["src/index.ts", "src/delegate.ts", "src/delegate-remote.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
});
