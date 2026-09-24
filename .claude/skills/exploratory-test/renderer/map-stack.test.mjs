/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapStack } from './map-stack.mjs';

// The checkout's own copy; the fixture root has no node_modules.
const traceMapping = () => createRequire(import.meta.url)('@jridgewell/trace-mapping');

// out/vs/a.js line 2 maps to src/vs/a.ts line 3.
const root = mkdtempSync(join(tmpdir(), 'map-stack-'));
mkdirSync(join(root, 'out/vs'), { recursive: true });
const map = { version: 3, sources: ['../../src/vs/a.ts'], names: [], mappings: 'AAAA;AAEA' };
writeFileSync(join(root, 'out/vs/a.js'), `x();\ny();\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`);
writeFileSync(join(root, 'out/vs/b.js'), 'z();\n');

const map1 = text => mapStack(text, root, traceMapping);

test('maps a vscode-file frame from another install to a repo-relative source line', () => {
	const text = 'Error: boom\n    at f (vscode-file://vscode-app/Applications/Positron.app/Contents/Resources/app/out/vs/a.js:2:5)';
	assert.equal(map1(text), 'Error: boom\n    at f (src/vs/a.ts:3)');
});

test('a map naming another checkout resolves to the same file under root', () => {
	mkdirSync(join(root, 'src/vs'), { recursive: true });
	writeFileSync(join(root, 'src/vs/c.ts'), '');
	const other = { version: 3, sources: ['/elsewhere/positron/src/vs/c.ts'], names: [], mappings: 'AAAA' };
	writeFileSync(join(root, 'out/vs/c.js'), `w();\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(other)).toString('base64')}\n`);
	assert.equal(map1('    at k (out/vs/c.js:1:1)'), '    at k (src/vs/c.ts:1)');
});

test('maps a bare frame and a relative path', () => {
	assert.equal(map1('    at out/vs/a.js:1:1'), '    at src/vs/a.ts:1');
});

test('leaves node: frames and frames with no map as they are', () => {
	const text = '    at g (node:internal/process/task_queues:95:5)\n    at h (out/vs/b.js:1:1)\n    at i (out/vs/missing.js:1:1)';
	assert.equal(map1(text), text);
});

test('keeps 10 frames per stack, then counts the rest at the same indent', () => {
	const stack = n => Array.from({ length: n }, (_, i) => `  at f${i} (node:x:1:1)`).join('\n');
	const lines = map1(`E1\n${stack(13)}\nE2\n${stack(2)}`).split('\n');
	assert.equal(lines.length, 1 + 10 + 1 + 1 + 2);
	assert.equal(lines[11], '  ... 3 more');
	assert.equal(lines[12], 'E2');
});

test('runs as a script when called through a symlinked path', () => {
	const link = join(root, 'link');
	symlinkSync(dirname(fileURLToPath(import.meta.url)), link);
	const r = spawnSync(process.execPath, [join(link, 'map-stack.mjs'), '--root', root], { input: 'E\n    at node:x:1:1\n', encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout, 'E\n    at node:x:1:1\n');
});
