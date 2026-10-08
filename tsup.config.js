/**
 * @type {import('tsup').Options}
 */
module.exports = {
  dts: true,
  minify: false,
  bundle: true,
  sourcemap: true,
  treeshake: true,
  splitting: true,
  clean: true,
  outDir: "dist",
  format: ["cjs"],
  entry: ["src/index.ts"],
  tsconfig: "tsconfig.node.json",
};
