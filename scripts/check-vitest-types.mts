/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Type-checks every Vitest file. Vitest strips types without checking them, and
// the main build excludes *.vitest.ts, so this is the only check they get.
//
// src/ tests use vitest.tsconfig.json. Tests under test/e2e and inside an
// extension use that project's tsconfig.vitest.json, so they are checked with
// the compiler options the project builds with.
//
// Usage: npm run test:positron:check-ts

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const tsc = path.join(root, 'node_modules', '@typescript', 'native', 'bin', 'tsc');

function glob(pattern: string): string[] {
	return fs.globSync(pattern, { cwd: root, exclude: p => p.includes('node_modules') })
		.map(p => p.split(path.sep).join('/'))
		.sort();
}

// Each extension or test/e2e directory that has Vitest files needs its own
// tsconfig.vitest.json, or its tests would silently go unchecked.
function findUncoveredProjects(): string[] {
	const projectDirs = new Set<string>();
	for (const file of glob('{extensions/*/**,test/e2e/**}/*.vitest.{ts,tsx}')) {
		const parts = file.split('/');
		projectDirs.add(parts[0] === 'extensions' ? parts.slice(0, 2).join('/') : 'test/e2e');
	}
	return [...projectDirs].filter(dir => !fs.existsSync(path.join(root, dir, 'tsconfig.vitest.json')));
}

function check(config: string): Promise<{ config: string; code: number; output: string }> {
	return new Promise(resolve => {
		const child = spawn(process.execPath, [tsc, '--noEmit', '--skipLibCheck', '-p', config], { cwd: root });
		let output = '';
		child.stdout.on('data', chunk => output += chunk);
		child.stderr.on('data', chunk => output += chunk);
		child.on('close', code => resolve({ config, code: code ?? 1, output }));
	});
}

async function main(): Promise<number> {
	const uncovered = findUncoveredProjects();
	if (uncovered.length) {
		console.error('These directories have Vitest files but no tsconfig.vitest.json:');
		for (const dir of uncovered) {
			console.error(`  ${dir}`);
		}
		console.error('Copy one from another extension (e.g. extensions/positron-r/tsconfig.vitest.json) and match its "types" and "include" to the directory\'s tsconfig.json.');
		return 1;
	}

	const configs = ['vitest.tsconfig.json', ...glob('{extensions/*,test/e2e}/tsconfig.vitest.json')];
	const results = await Promise.all(configs.map(check));

	let failed = 0;
	for (const { config, code, output } of results) {
		if (code !== 0) {
			failed++;
			console.error(`\n${config}:`);
			console.error(output.trimEnd());
		}
	}
	console.log(`\nChecked ${configs.length} Vitest tsconfigs: ${failed ? `${failed} with errors` : 'no errors'}.`);
	return failed ? 1 : 0;
}

process.exitCode = await main();
