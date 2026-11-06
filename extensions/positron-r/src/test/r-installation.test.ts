/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import Fs = require('fs');
import * as Sinon from 'sinon';
import { getRHomePath } from '../r-installation';

// Build the contents of an R wrapper script with a given R_HOME_DIR value.
// The "Shell wrapper for R executable" header is what getRHomePathDarwin
// uses to recognize the file as a valid R wrapper.
function rWrapperScript(rHomeDir: string): string {
	return [
		'#!/bin/sh',
		'# Shell wrapper for R executable.',
		'',
		`R_HOME_DIR=${rHomeDir}`,
		'export R_HOME_DIR',
	].join('\n');
}

suite('r-installation: getRHomePathDarwin', () => {

	let originalPlatform: PropertyDescriptor | undefined;
	let readFileSyncStub: Sinon.SinonStub;
	let existsSyncStub: Sinon.SinonStub;
	let realpathSyncStub: Sinon.SinonStub;

	suiteSetup(function () {
		originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
		Object.defineProperty(process, 'platform', { value: 'darwin' });
	});

	suiteTeardown(function () {
		if (originalPlatform) {
			Object.defineProperty(process, 'platform', originalPlatform);
		}
	});

	teardown(() => {
		readFileSyncStub?.restore();
		existsSyncStub?.restore();
		realpathSyncStub?.restore();
	});

	test('returns parsed R_HOME_DIR when it validates and binpath lives under it', () => {
		const binpath = '/Library/Frameworks/R.framework/Versions/4.5-arm64/Resources/bin/R';
		const parsedHome = '/Library/Frameworks/R.framework/Versions/4.5-arm64/Resources';

		readFileSyncStub = Sinon.stub(Fs, 'readFileSync').returns(rWrapperScript(parsedHome));
		existsSyncStub = Sinon.stub(Fs, 'existsSync').callsFake((p: Fs.PathLike) =>
			String(p) === `${parsedHome}/library/utils/DESCRIPTION`
		);
		// Identity realpath: no symlinks in this scenario.
		realpathSyncStub = Sinon.stub(Fs, 'realpathSync').callsFake((p: Fs.PathLike) => String(p));

		const result = getRHomePath(binpath);

		assert.strictEqual(result, parsedHome);
	});

	test('falls back to dirname(dirname(realpath(binpath))) when parsed R_HOME_DIR is invalid', () => {
		const binpath = '/Users/jane/portable-r/4.5.3-arm64/Resources/bin/R';
		const staleHome = '/build/tmp/R-4.5.3/Resources'; // Baked at build time, doesn't exist on this machine.
		const derivedHome = '/Users/jane/portable-r/4.5.3-arm64/Resources';

		readFileSyncStub = Sinon.stub(Fs, 'readFileSync').returns(rWrapperScript(staleHome));
		// Identity realpath: no symlinks. Used by both binpathIsUnder and derivedRHomePathDarwin.
		realpathSyncStub = Sinon.stub(Fs, 'realpathSync').callsFake((p: Fs.PathLike) => String(p));
		existsSyncStub = Sinon.stub(Fs, 'existsSync').callsFake((p: Fs.PathLike) =>
			String(p) === `${derivedHome}/library/utils/DESCRIPTION`
		);

		const result = getRHomePath(binpath);

		assert.strictEqual(result, derivedHome);
	});

	test('falls back to derived path when parsed R_HOME_DIR validates but binpath lives elsewhere', () => {
		// Conflation case: portable R-4.5.3's wrapper has R_HOME_DIR baked to
		// /Library/.../4.5-arm64/Resources, and the user *also* has CRAN R 4.5.1
		// installed at that exact path. hasRBaseLibrary(parsed) returns true, but
		// binpath is in /Users/.../portable-r/... — handing back parsed would
		// register the portable with CRAN's metadata. Verify we fall through.
		const binpath = '/Users/jane/portable-r/4.5.3-arm64/Resources/bin/R';
		const parsedHome = '/Library/Frameworks/R.framework/Versions/4.5-arm64/Resources';
		const derivedHome = '/Users/jane/portable-r/4.5.3-arm64/Resources';

		readFileSyncStub = Sinon.stub(Fs, 'readFileSync').returns(rWrapperScript(parsedHome));
		realpathSyncStub = Sinon.stub(Fs, 'realpathSync').callsFake((p: Fs.PathLike) => String(p));
		existsSyncStub = Sinon.stub(Fs, 'existsSync').callsFake((p: Fs.PathLike) => {
			const s = String(p);
			return s === `${parsedHome}/library/utils/DESCRIPTION` ||
				s === `${derivedHome}/library/utils/DESCRIPTION`;
		});

		const result = getRHomePath(binpath);

		assert.strictEqual(result, derivedHome);
	});

	test('returns undefined when neither parsed R_HOME_DIR nor fallback validates', () => {
		const binpath = '/some/broken/path/Resources/bin/R';
		const staleHome = '/build/tmp/R/Resources';

		readFileSyncStub = Sinon.stub(Fs, 'readFileSync').returns(rWrapperScript(staleHome));
		realpathSyncStub = Sinon.stub(Fs, 'realpathSync').returns(binpath);
		existsSyncStub = Sinon.stub(Fs, 'existsSync').returns(false); // Nothing validates.

		const result = getRHomePath(binpath);

		assert.strictEqual(result, undefined);
	});

	test('returns undefined when the binary is not an R wrapper script', () => {
		const binpath = '/usr/bin/python';

		// Script lacks the "Shell wrapper for R executable" header.
		readFileSyncStub = Sinon.stub(Fs, 'readFileSync').returns('#!/bin/sh\necho hello\n');
		existsSyncStub = Sinon.stub(Fs, 'existsSync').returns(true); // Even if DESCRIPTION existed, we shouldn't get there.
		realpathSyncStub = Sinon.stub(Fs, 'realpathSync');

		const result = getRHomePath(binpath);

		assert.strictEqual(result, undefined);
		assert.strictEqual(existsSyncStub.callCount, 0,
			'existsSync should not be called when the wrapper header is missing');
		assert.strictEqual(realpathSyncStub.callCount, 0,
			'realpath should not be called when the wrapper header is missing');
	});
});
