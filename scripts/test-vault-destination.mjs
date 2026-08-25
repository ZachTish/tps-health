import assert from 'node:assert/strict';
import test from 'node:test';
import esbuild from 'esbuild';

const built = await esbuild.build({
  entryPoints: ['src/vault-destination.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [{
    name: 'obsidian-stub',
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/u, namespace: 'stub' }, () => ({
        contents: 'export const normalizePath = (value) => String(value || "").replace(/\\\\/g, "/").replace(/\\/{2,}/g, "/").replace(/^\\.\\//, "");',
        loader: 'js',
      }));
    },
  }],
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
const {
  buildVaultDestinationPath,
  fileIsInVaultDestination,
  normalizeVaultDestinationFolder,
} = await import(moduleUrl);

test('root is an explicit stable health destination', () => {
  assert.equal(normalizeVaultDestinationFolder('/', 'Health/Foods'), '/');
  assert.equal(normalizeVaultDestinationFolder('.', 'Health/Foods'), '/');
  assert.equal(normalizeVaultDestinationFolder('', 'Health/Foods'), 'Health/Foods');
  assert.equal(buildVaultDestinationPath('/', 'Apple.md'), 'Apple.md');
  assert.equal(buildVaultDestinationPath('Health/Foods', 'Apple.md'), 'Health/Foods/Apple.md');
});

test('root folder matching includes only root-level files', () => {
  assert.equal(fileIsInVaultDestination('Apple.md', '/'), true);
  assert.equal(fileIsInVaultDestination('Health/Apple.md', '/'), false);
  assert.equal(fileIsInVaultDestination('Health/Foods/Apple.md', 'Health/Foods'), true);
  assert.equal(fileIsInVaultDestination('Health/Apple.md', 'Health/Foods'), false);
});
