/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findProjectRProfile } from './project-profile';

describe('findProjectRProfile', () => {
	// <tmp>/workspace is the workspace folder; notebooks live in <tmp>/workspace/project/notebooks
	let tmp: string;
	let root: string;
	let notebooks: string;

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-r-project-profile-'));
		root = path.join(tmp, 'workspace');
		notebooks = path.join(root, 'project', 'notebooks');
		fs.mkdirSync(notebooks, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	function writeProfile(dir: string): string {
		const profile = path.join(dir, '.Rprofile');
		fs.writeFileSync(profile, '');
		return profile;
	}

	it('finds the profile of the workspace folder', () => {
		const profile = writeProfile(root);
		expect(findProjectRProfile(notebooks, root)).toBe(profile);
	});

	it('prefers the nearest profile', () => {
		writeProfile(root);
		const profile = writeProfile(path.join(root, 'project'));
		expect(findProjectRProfile(notebooks, root)).toBe(profile);
	});

	it('returns undefined when the working directory has its own profile', () => {
		writeProfile(root);
		writeProfile(notebooks);
		expect(findProjectRProfile(notebooks, root)).toBeUndefined();
	});

	it('returns undefined when the working directory is the workspace folder', () => {
		writeProfile(tmp);
		expect(findProjectRProfile(root, root)).toBeUndefined();
	});

	it('returns undefined when there is no profile', () => {
		expect(findProjectRProfile(notebooks, root)).toBeUndefined();
	});

	it('ignores profiles above the workspace folder', () => {
		writeProfile(tmp);
		expect(findProjectRProfile(notebooks, root)).toBeUndefined();
	});

	it('returns undefined when the working directory is outside the workspace folder', () => {
		writeProfile(tmp);
		const outside = path.join(tmp, 'elsewhere');
		fs.mkdirSync(outside);
		expect(findProjectRProfile(outside, root)).toBeUndefined();
	});

	it('returns undefined when the nearest profile is in the home directory', () => {
		// R already falls back to the home profile on its own
		writeProfile(root);
		expect(findProjectRProfile(notebooks, root, root)).toBeUndefined();
	});
});
