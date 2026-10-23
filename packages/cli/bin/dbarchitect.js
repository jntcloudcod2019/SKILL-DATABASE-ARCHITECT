#!/usr/bin/env node
// Thin shim: Node >= 22.18 runs the TypeScript sources directly (type stripping), so there is no build step for the CLI.
const { main } = await import('../src/main.ts');
process.exitCode = await main(process.argv.slice(2));
