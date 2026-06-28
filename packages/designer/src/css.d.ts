// Ambient declaration for CSS side-effect imports. `vite/client` covers this
// for app/dev typechecking, but the .d.ts rollup pass (api-extractor's bundled
// TS) doesn't read that reference, so declare it explicitly here too.
declare module '*.css'
