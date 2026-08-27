/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { arkResourceDirs, readArkVersion } from './ark-version.js';

describe('arkResourceDirs', () => {
	test('looks under the macOS app bundle first on darwin', () => {
		const [first] = arkResourceDirs('/build', 'darwin');
		expect(first).toBe('/build/Contents/Resources/app/extensions/positron-r/resources/ark');
	});

	test('looks under resources/app first on linux and windows', () => {
		const expected = '/build/resources/app/extensions/positron-r/resources/ark';
		expect(arkResourceDirs('/build', 'linux')[0]).toBe(expected);
		expect(arkResourceDirs('/build', 'win32')[0]).toBe(expected);
	});

	// A positron-server build keeps its app files at the root rather than under
	// resources/app, exactly as getVersionFromBuild in positron-version.ts has to
	// allow for. Candidates rather than a branch on the memory lane: the question
	// is only where this build put its extensions.
	test('falls back to the build root, so the server lane resolves too', () => {
		for (const platform of ['darwin', 'linux', 'win32'] as const) {
			expect(arkResourceDirs('/build', platform)).toContain(
				'/build/extensions/positron-r/resources/ark');
		}
	});
});

describe('readArkVersion', () => {
	let buildRoot: string;
	let arkDir: string;

	beforeEach(() => {
		buildRoot = mkdtempSync(join(tmpdir(), 'ark-version-'));
		// The server-layout candidate, which is in the list on every platform, so
		// these cases do not depend on which OS runs them.
		arkDir = join(buildRoot, 'extensions', 'positron-r', 'resources', 'ark');
		mkdirSync(arkDir, { recursive: true });
	});

	afterEach(() => { rmSync(buildRoot, { recursive: true, force: true }); });

	test('reads the resolved build version from the VERSION sidecar', () => {
		writeFileSync(join(arkDir, 'VERSION'), '0.1.252+209.885fac4\n');
		expect(readArkVersion(buildRoot)).toBe('0.1.252+209.885fac4');
	});

	// The whole build version, not the bare semver. The dashboard marks a change,
	// and an ark bump that moves the distance and sha without touching Cargo.toml
	// would be invisible if this trimmed at the '+'.
	test('keeps the distance and short sha rather than trimming to the semver', () => {
		writeFileSync(join(arkDir, 'VERSION'), '0.1.252+209.885fac4');
		expect(readArkVersion(buildRoot)).toContain('+209.885fac4');
	});

	test('prefers VERSION over SUBMODULE_COMMIT when both are present', () => {
		writeFileSync(join(arkDir, 'VERSION'), '0.1.252+209.885fac4');
		writeFileSync(join(arkDir, 'SUBMODULE_COMMIT'), '5564f48');
		expect(readArkVersion(buildRoot)).toBe('0.1.252+209.885fac4');
	});

	// install-kernel writes SUBMODULE_COMMIT on every resolution path but writes
	// VERSION only after a prebuild download, so a locally built ark leaves the
	// commit and no version.
	test('falls back to SUBMODULE_COMMIT when VERSION was never written', () => {
		writeFileSync(join(arkDir, 'SUBMODULE_COMMIT'), '5564f48\n');
		expect(readArkVersion(buildRoot)).toBe('5564f48');
	});

	test('treats a whitespace-only sidecar as absent and keeps looking', () => {
		writeFileSync(join(arkDir, 'VERSION'), '   \n');
		writeFileSync(join(arkDir, 'SUBMODULE_COMMIT'), '5564f48');
		expect(readArkVersion(buildRoot)).toBe('5564f48');
	});

	// Never a placeholder. 'unknown' reaching the dashboard would draw an ark
	// marker on a date where no release happened.
	test('returns undefined rather than a placeholder when no sidecar exists', () => {
		vi.spyOn(console, 'log').mockImplementation(() => { });
		expect(readArkVersion(buildRoot)).toBeUndefined();
	});

	test('returns undefined with no build root, rather than searching the repo', () => {
		expect(readArkVersion('')).toBeUndefined();
	});

	// An unreadable sidecar must not take a memory run down with it: the run has
	// already measured everything by the time this is called.
	test('returns undefined rather than throwing when a sidecar cannot be read', () => {
		vi.spyOn(console, 'log').mockImplementation(() => { });
		// A directory where the file should be: exists, cannot be read as a file.
		mkdirSync(join(arkDir, 'VERSION'));
		expect(readArkVersion(buildRoot)).toBeUndefined();
	});
});
