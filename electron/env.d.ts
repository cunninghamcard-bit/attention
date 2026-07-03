/**
 * The Electron main/preload sources are authored as ES modules but bundled to
 * CommonJS (`dist-electron/*.cjs`) by `vite.electron.config.ts`, so Node's
 * CommonJS `__dirname` exists at runtime. Declare it for the type checker,
 * which sees the sources under `moduleResolution: Bundler`.
 */
declare const __dirname: string;
