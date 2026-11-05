/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Type-checks every Vitest file. Vitest strips types without checking them, and
// the main build excludes *.vitest.ts, so this is the only check they get.
//
// src/ tests use vitest.tsconfig.json. For test/e2e and each extension with
// Vitest files, this script generates a config that extends the project's
// tsconfig.json, so its tests are checked with the options the project builds with.
//
// Usage: npm run test:positron:check-ts [-- --print-configs]

import fs from 'fs';
import { parse } from 'jsonc-parser';
import { createRequire } from 'module';
import path from 'path';
import { spawnWithRetry } from '../build/lib/spawnRetry.ts';

const root = path.resolve(import.meta.dirname, '..');
// Same lookup as build/lib/tsgo.ts.
const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('@typescript/native/package.json')), 'bin', 'tsc');
// Written next to each project's tsconfig.json so relative paths and default
// typeRoots resolve the same way; deleted after the run and gitignored.
const generatedName = 'tsconfig.vitest.generated.json';

interface TsConfig {
	extends?: string;
	include?: string[];
	compilerOptions?: { types?: string[] };
}

function glob(pattern: string): string[] {
	return fs.globSync(pattern, { cwd: root, exclude: p => p.includes('node_modules') })
		.map(p => p.split(path.sep).join('/'))
		.sort();
}

// Each extension or test/e2e directory that has Vitest files.
function findProjects(): string[] {
	const projectDirs = new Set<string>();
	for (const file of glob('{extensions/*/**,test/e2e/**}/*.vitest.{ts,tsx}')) {
		const parts = file.split('/');
		projectDirs.add(parts[0] === 'extensions' ? parts.slice(0, 2).join('/') : 'test/e2e');
	}
	return [...projectDirs].sort();
}

// Reads a top-level field or compiler option, following relative `extends`.
function readSetting<T>(configPath: string, get: (config: TsConfig) => T | undefined): T | undefined {
	const config: TsConfig = parse(fs.readFileSync(configPath, 'utf8'));
	const value = get(config);
	if (value !== undefined || !config.extends?.startsWith('.')) {
		return value;
	}
	return readSetting(path.resolve(path.dirname(configPath), config.extends), get);
}

// Keeps the build's ambient declarations (the build gets them through its
// include), swaps in the Vitest files, and drops mocha's globals for Vitest's.
function generateConfig(projectDir: string): object {
	const tsconfig = path.join(root, projectDir, 'tsconfig.json');
	const include = readSetting(tsconfig, c => c.include) ?? ['**/*'];
	const types = readSetting(tsconfig, c => c.compilerOptions?.types) ?? ['node'];
	const vitestGlobals = path.relative(path.join(root, projectDir), path.join(root, 'node_modules/vitest/globals.d.ts'));
	return {
		extends: './tsconfig.json',
		compilerOptions: { noEmit: true, types: types.filter(t => t !== 'mocha') },
		include: [
			'**/*.vitest.ts',
			'**/*.vitest.tsx',
			vitestGlobals.split(path.sep).join('/'),
			...include.flatMap(entry => entry.endsWith('.d.ts') ? [entry] : entry.endsWith('*') ? [`${entry}.d.ts`] : []),
		],
		exclude: ['node_modules', 'out'],
	};
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

	const projects = findProjects();
	const missing = projects.filter(dir => !fs.existsSync(path.join(root, dir, 'tsconfig.json')));
	if (missing.length) {
		console.error(`These directories have Vitest files but no tsconfig.json: ${missing.join(', ')}`);
		return 1;
	}

	const generated = projects.map(dir => ({ path: `${dir}/${generatedName}`, config: generateConfig(dir) }));
	if (process.argv.includes('--print-configs')) {
		for (const { path: file, config } of generated) {
			console.log(`${file}:\n${JSON.stringify(config, null, '\t')}\n`);
		}
		return 0;
	}

	let results;
	try {
		for (const { path: file, config } of generated) {
			fs.writeFileSync(path.join(root, file), JSON.stringify(config, null, '\t'));
		}
		results = await Promise.all(['vitest.tsconfig.json', ...generated.map(g => g.path)].map(check));
	} finally {
		for (const { path: file } of generated) {
			fs.rmSync(path.join(root, file), { force: true });
		}
	}

	let failed = 0;
	for (const { config, code, output } of results) {
		if (code !== 0) {
			failed++;
			console.error(`\n${config}:`);
			console.error(output.trimEnd());
		}
	}
	console.log(`\nChecked ${results.length} Vitest tsconfigs: ${failed ? `${failed} with errors` : 'no errors'}.`);
	return failed ? 1 : 0;
}

process.exitCode = await main();
