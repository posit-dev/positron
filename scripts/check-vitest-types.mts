/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Type-checks every Vitest file. Vitest strips types without checking them, and
// the main build excludes *.vitest.ts, so this is the only check they get.
//
// Checks each config listed in the root tsconfig.json: vitest.tsconfig.json for
// src/, and a tsconfig.vitest.json in test/e2e and each extension with Vitest files.
//
// Usage: npm run test:positron:check-ts

import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { spawnWithRetry } from '../build/lib/spawnRetry.ts';

const root = path.resolve(import.meta.dirname, '..');
// Same lookup as build/lib/tsgo.ts.
const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('@typescript/native/package.json')), 'bin', 'tsc');

function glob(pattern: string): string[] {
	return fs.globSync(pattern, { cwd: root, exclude: p => p.includes('node_modules') })
		.map(p => p.split(path.sep).join('/'))
		.sort();
}

// The configs referenced by the root tsconfig.json, relative to the repo root.
function listedConfigs(): string[] {
	const text = fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
	const { references }: { references: { path: string }[] } = JSON.parse(text);
	return references.map(ref => path.posix.normalize(ref.path));
}

// Each project with Vitest files needs a tsconfig.vitest.json listed in the root
// tsconfig.json, or its tests go unchecked here and unclaimed in the editor.
function findMissingConfigs(listed: string[]): string[] {
	const needed = new Set<string>();
	for (const file of glob('{extensions/*/**,test/e2e/**}/*.vitest.{ts,tsx}')) {
		const parts = file.split('/');
		const project = parts[0] === 'extensions' ? parts.slice(0, 2).join('/') : 'test/e2e';
		needed.add(`${project}/tsconfig.vitest.json`);
	}
	for (const config of glob('{extensions/*,test/e2e}/tsconfig.vitest.json')) {
		needed.add(config);
	}
	return [...needed].filter(config => !listed.includes(config) || !fs.existsSync(path.join(root, config))).sort();
}

// A Vitest file under a nested tsconfig.json (a package inside an extension or
// test/e2e) would be checked with the outer project's options, not its own.
function findNestedFiles(): string[] {
	return glob('{extensions/*/**,test/e2e/**}/*.vitest.{ts,tsx}').filter(file => {
		const parts = file.split('/');
		const top = parts[0] === 'extensions' ? parts.slice(0, 2).join('/') : 'test/e2e';
		for (let dir = path.posix.dirname(file); dir !== top; dir = path.posix.dirname(dir)) {
			if (fs.existsSync(path.join(root, dir, 'tsconfig.json'))) {
				return true;
			}
		}
		return false;
	});
}

// TypeScript keeps foo.vitest.ts and silently drops foo.vitest.tsx when both
// match an include, so the .tsx file would never be checked.
function findShadowedFiles(): string[] {
	const files = new Set(glob('{src,extensions,test/e2e}/**/*.vitest.{ts,tsx}'));
	return [...files].filter(file => file.endsWith('.tsx') && files.has(file.slice(0, -1)));
}

async function check(config: string): Promise<{ config: string; code: number; output: string }> {
	// spawnWithRetry rides out the transient macOS `spawn EBADF` (see build/lib/spawnRetry.ts).
	const child = await spawnWithRetry(process.execPath, [tsc, '--noEmit', '--skipLibCheck', '-p', config], { cwd: root });
	return new Promise(resolve => {
		let output = '';
		child.stdout?.on('data', chunk => output += chunk);
		child.stderr?.on('data', chunk => output += chunk);
		child.on('error', err => output += `\nFailed to run tsc: ${err.message}`);
		child.on('close', (code, signal) => {
			if (signal) {
				output += `\ntsc was killed by ${signal}`;
			}
			resolve({ config, code: code ?? 1, output });
		});
	});
}

// Shows each error on the PR's checks page and diff, not only in the job log.
function printAnnotations(output: string): void {
	const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
	for (const [, file, line, col, code, message] of output.matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm)) {
		console.log(`::error file=${escape(file)},line=${line},col=${col},title=${code}::${escape(message)}`);
	}
}

async function main(): Promise<number> {
	const shadowed = findShadowedFiles();
	if (shadowed.length) {
		console.error('These .vitest.tsx files share a name with a .vitest.ts file, so TypeScript never checks them:');
		for (const file of shadowed) {
			console.error(`  ${file}`);
		}
		console.error('Rename one file of each pair.');
		return 1;
	}

	const nested = findNestedFiles();
	if (nested.length) {
		console.error('These Vitest files are in a nested package with its own tsconfig.json, so they would be checked with the wrong compiler options:');
		for (const file of nested) {
			console.error(`  ${file}`);
		}
		console.error('Move the tests out of the nested package, or add nested package support to scripts/check-vitest-types.mts.');
		return 1;
	}

	const listed = listedConfigs();
	const missing = findMissingConfigs(listed);
	if (missing.length) {
		console.error('These Vitest configs are missing, or not listed in the root tsconfig.json:');
		for (const config of missing) {
			console.error(`  ${config}`);
		}
		console.error('Create each one with {"extends": ["./tsconfig.json", "../../tsconfig.vitest.base.json"]} and add it to "references" in tsconfig.json.');
		return 1;
	}

	const results = await Promise.all(listed.map(check));
	let failed = 0;
	for (const { config, code, output } of results) {
		if (code !== 0) {
			failed++;
			console.error(`\n${config}:`);
			console.error(output.trimEnd());
			if (process.env.GITHUB_ACTIONS) {
				printAnnotations(output);
			}
		}
	}
	console.log(`\nChecked ${results.length} Vitest tsconfigs: ${failed ? `${failed} with errors` : 'no errors'}.`);
	return failed ? 1 : 0;
}

process.exitCode = await main();
