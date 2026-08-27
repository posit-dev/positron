/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import * as path from '../../../base/common/path.js';
import { hashLicenseContents, licenseFileHash } from '../../node/localLicense.js';

const license = '-----BEGIN RSTUDIO LICENSE-----\nabc123\n-----END RSTUDIO LICENSE-----';
const renewedLicense = license.replace('abc123', 'def456');

describe('hashLicenseContents', () => {

	it('hashes a license to a short hex digest', () => {
		// Pinned rather than pattern-matched: Posit hashes the licenses it issued the same
		// way and joins on the result, so the algorithm, the truncation, and the encoding
		// are all part of the contract. A different digest or a different slice would still
		// look like a hash while silently breaking that join.
		expect(hashLicenseContents(license)).toBe('c12b6949758226a4');
	});

	it('ignores surrounding whitespace so the same license always hashes the same', () => {
		// A license file can gain or lose a trailing newline in transit; a deployment must
		// not look like a different license because of it.
		expect([
			hashLicenseContents(`${license}\n`),
			hashLicenseContents(`\n\n${license}\n  \n`),
		]).toEqual(['c12b6949758226a4', 'c12b6949758226a4']);
	});

	it('gives different licenses different hashes', () => {
		expect(hashLicenseContents(renewedLicense)).not.toBe(hashLicenseContents(license));
	});
});

describe('licenseFileHash', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-license-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	/** Writes a file into the license-manager directory and returns its path. */
	function writeInDir(name: string, contents: string): string {
		const filePath = path.join(dir, name);
		fs.writeFileSync(filePath, contents);
		return filePath;
	}

	it('hashes the reported license file in preference to the one in the directory', () => {
		// The binary names the license it actually verified; the directory scan is only a
		// fallback, so a stale sibling .lic must not win.
		writeInDir('stale.lic', license);
		const reported = writeInDir('verified.txt', renewedLicense);
		expect(licenseFileHash(dir, reported)).toBe(hashLicenseContents(renewedLicense));
	});

	it('falls back to the .lic in the directory when the binary reports no path', () => {
		writeInDir('license.lic', license);
		expect(licenseFileHash(dir)).toBe('c12b6949758226a4');
	});

	it('falls back to the .lic in the directory when the reported path is gone', () => {
		writeInDir('license.lic', license);
		expect(licenseFileHash(dir, path.join(dir, 'does-not-exist.lic'))).toBe('c12b6949758226a4');
	});

	it('skips an empty reported file and falls back to the license in the directory', () => {
		writeInDir('license.lic', license);
		const reported = writeInDir('truncated.txt', '');
		expect(licenseFileHash(dir, reported)).toBe('c12b6949758226a4');
	});

	it('reports nothing rather than the hash of an empty license file', () => {
		// A truncated or placeholder .lic hashes to a perfectly well-formed value that
		// identifies no license, and every deployment with one would report that same
		// value. A collapsed group in Posit's per-license counts is worse than a missing
		// one, so this fails closed.
		writeInDir('placeholder.lic', '   \n\n  ');
		expect(licenseFileHash(dir)).toBeUndefined();
	});

	it('ignores a relative reported path instead of resolving it against the process cwd', () => {
		// A relative path from the license-manager binary resolves against the server
		// process's working directory, not the binary's, so it can name some entirely
		// unrelated file. `package.json` stands in for one: it exists in the working
		// directory, and accepting the relative path would report a hash of it as this
		// deployment's license. `dir` holds no .lic, so the only way to get a hash here is
		// the bug.
		expect(fs.existsSync(path.join(process.cwd(), 'package.json'))).toBe(true);
		expect(licenseFileHash(dir, 'package.json')).toBeUndefined();
	});

	it('returns undefined rather than throwing when there is nothing to hash', () => {
		// The hash is telemetry. An unreadable directory or a missing license file must
		// leave a legitimately licensed deployment licensed, so this reports nothing
		// instead of letting an exception escape the license check.
		expect([
			licenseFileHash(dir),
			licenseFileHash(path.join(dir, 'no-such-dir')),
			licenseFileHash(path.join(dir, 'no-such-dir'), path.join(dir, 'no-such-file.lic')),
		]).toEqual([undefined, undefined, undefined]);
	});
});
