import { fileURLToPath } from 'node:url';

process.env.GRAILSHOT_RUNTIME = 'node';
process.env.NODE_ENV = 'production';
const cli = new URL('../node_modules/vinext/dist/cli.js', import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), 'build'];
await import(cli.href);
