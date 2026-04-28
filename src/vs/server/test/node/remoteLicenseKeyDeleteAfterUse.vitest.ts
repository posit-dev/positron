/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import { join } from '../../../base/common/path.js';
import { FileAccess } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { ServerParsedArgs } from '../../node/serverEnvironmentService.js';

// Mock the license-manager binary wrapper -- we never want to invoke the real
// binary in unit tests. RSA-routed validation returns this canned result.
const { mockActivate } = vi.hoisted(() => ({
	mockActivate: vi.fn(),
}));
vi.mock('../../node/licenseManager.js', () => ({
	activateWithManager: mockActivate,
}));

// Wrap fs.unlinkSync in a vi.fn so we can spy on calls and override per-test.
// Real unlink runs by default (so files actually get removed); per-test
// overrides simulate failure modes (EACCES, ENOENT).
vi.mock('fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fs')>();
	return { ...actual, unlinkSync: vi.fn(actual.unlinkSync) };
});

const RSA_LICENSE_CONTENT = '-----BEGIN RSTUDIO LICENSE-----\nfake-rsa-payload\n-----END RSTUDIO LICENSE-----\n';
const RSA_RESULT = { valid: true, licensee: 'Test Licensee' };

const { validateLicenseKey } = await import('../../node/remoteLicenseKey.js');

const buildArgs = (overrides: Partial<ServerParsedArgs> = {}): ServerParsedArgs => ({
	'accept-server-license-terms': false,
	workspace: '',
	folder: '',
	help: false,
	version: false,
	compatibility: '',
	_: [],
	...overrides,
});

describe('validateLicenseKey delete-after-use', () => {
	const originalEnvKey = process.env.POSITRON_LICENSE_KEY;
	const originalEnvFile = process.env.POSITRON_LICENSE_KEY_FILE;
	const originalEnvDelete = process.env.POSITRON_LICENSE_KEY_FILE_DELETE_AFTER_USE;
	let tmpDir: string;

	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => { });
		vi.spyOn(console, 'log').mockImplementation(() => { });
		// FileAccess.asFileUri('') throws in plain-Node test contexts (no AMD
		// loader). Stub it so the RSA branch can compute its installPath.
		vi.spyOn(FileAccess, 'asFileUri').mockReturnValue(URI.file('/fake/install/path'));
		delete process.env.POSITRON_LICENSE_KEY;
		delete process.env.POSITRON_LICENSE_KEY_FILE;
		delete process.env.POSITRON_LICENSE_KEY_FILE_DELETE_AFTER_USE;
		tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'positron-license-delete-test-'));
		mockActivate.mockResolvedValue(RSA_RESULT);
	});

	afterEach(() => {
		const restore = (name: string, value: string | undefined) => {
			if (value === undefined) { delete process.env[name]; }
			else { process.env[name] = value; }
		};
		restore('POSITRON_LICENSE_KEY', originalEnvKey);
		restore('POSITRON_LICENSE_KEY_FILE', originalEnvFile);
		restore('POSITRON_LICENSE_KEY_FILE_DELETE_AFTER_USE', originalEnvDelete);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const writeRsaFile = (name = 'license.lic') => {
		const file = join(tmpDir, name);
		fs.writeFileSync(file, RSA_LICENSE_CONTENT);
		return file;
	};

	it('deletes the file when arg flag is set + --license-key-file is the source', async () => {
		const file = writeRsaFile();
		const result = await validateLicenseKey('token', buildArgs({
			'license-key-file': file,
			'license-key-file-delete-after-use': true,
		}));
		expect(result).toEqual(RSA_RESULT);
		expect(fs.existsSync(file)).toBe(false);
	});

	it('deletes the file when env flag is set + POSITRON_LICENSE_KEY_FILE is the source', async () => {
		const file = writeRsaFile();
		process.env.POSITRON_LICENSE_KEY_FILE = file;
		process.env.POSITRON_LICENSE_KEY_FILE_DELETE_AFTER_USE = '1';
		const result = await validateLicenseKey('token', buildArgs());
		expect(result).toEqual(RSA_RESULT);
		expect(fs.existsSync(file)).toBe(false);
	});

	it('does not delete the file when no flag is set', async () => {
		const file = writeRsaFile();
		const result = await validateLicenseKey('token', buildArgs({
			'license-key-file': file,
		}));
		expect(result).toEqual(RSA_RESULT);
		expect(fs.existsSync(file)).toBe(true);
	});

	it('does not call unlink when the source is inline --license-key', async () => {
		// Inline content goes through validateLicense (JSON-only); '{...' is
		// enough to take that branch -- we only care that no file delete is
		// attempted, regardless of validation outcome.
		await validateLicenseKey('token', buildArgs({
			'license-key': '{}',
			'license-key-file-delete-after-use': true,
		}));
		expect(vi.mocked(fs.unlinkSync)).not.toHaveBeenCalled();
	});

	it('does not call unlink when the source is inline POSITRON_LICENSE_KEY', async () => {
		process.env.POSITRON_LICENSE_KEY = '{}';
		process.env.POSITRON_LICENSE_KEY_FILE_DELETE_AFTER_USE = '1';
		await validateLicenseKey('token', buildArgs());
		expect(vi.mocked(fs.unlinkSync)).not.toHaveBeenCalled();
	});

	it('does not delete the file when the source is the user-data-dir fallback', async () => {
		// The persistent license-key store is intentionally exempt from
		// delete-after-use even when the flag is set.
		const file = join(tmpDir, 'license-key');
		fs.writeFileSync(file, RSA_LICENSE_CONTENT);
		const result = await validateLicenseKey('token', buildArgs({
			'user-data-dir': tmpDir,
			'license-key-file-delete-after-use': true,
		}));
		expect(result).toEqual(RSA_RESULT);
		expect(fs.existsSync(file)).toBe(true);
	});

	it('deletes the file even when validation fails', async () => {
		// Malformed JSON content so validation rejects, but the file is still
		// ephemeral and must be cleaned up.
		const file = join(tmpDir, 'license.lic');
		fs.writeFileSync(file, '{ not valid json');
		const result = await validateLicenseKey('token', buildArgs({
			'license-key-file': file,
			'license-key-file-delete-after-use': true,
		}));
		expect(result).toEqual({ valid: false });
		expect(fs.existsSync(file)).toBe(false);
	});

	it('returns invalid and logs FATAL when unlink fails with a non-ENOENT error', async () => {
		const file = writeRsaFile();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
		const accessError: NodeJS.ErrnoException = Object.assign(new Error('EACCES'), { code: 'EACCES' });
		vi.mocked(fs.unlinkSync).mockImplementationOnce(() => { throw accessError; });

		const result = await validateLicenseKey('token', buildArgs({
			'license-key-file': file,
			'license-key-file-delete-after-use': true,
		}));

		expect(result).toEqual({ valid: false });
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FATAL'));
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(file));
	});

	it('treats ENOENT on unlink as success and returns the original result', async () => {
		const file = writeRsaFile();
		const enoentError: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
		vi.mocked(fs.unlinkSync).mockImplementationOnce(() => { throw enoentError; });

		const result = await validateLicenseKey('token', buildArgs({
			'license-key-file': file,
			'license-key-file-delete-after-use': true,
		}));

		expect(result).toEqual(RSA_RESULT);
	});

	it('cross-source: arg sets flag, env var sets file path', async () => {
		const file = writeRsaFile();
		process.env.POSITRON_LICENSE_KEY_FILE = file;
		const result = await validateLicenseKey('token', buildArgs({
			'license-key-file-delete-after-use': true,
		}));
		expect(result).toEqual(RSA_RESULT);
		expect(fs.existsSync(file)).toBe(false);
	});

	it('cross-source: env var sets flag, arg sets file path', async () => {
		const file = writeRsaFile();
		process.env.POSITRON_LICENSE_KEY_FILE_DELETE_AFTER_USE = '1';
		const result = await validateLicenseKey('token', buildArgs({
			'license-key-file': file,
		}));
		expect(result).toEqual(RSA_RESULT);
		expect(fs.existsSync(file)).toBe(false);
	});

	describe('env-var truthiness', () => {
		// The strict parser accepts only 1/true/yes/on (case-insensitive).
		// Crucially, `=0` and `=false` must NOT enable deletion, since
		// operators commonly read those as "off" but a permissive
		// `!!process.env.X` would treat them as truthy.
		it.each(['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'on', 'ON', '  true  '])(
			'enables deletion when env var is %j',
			async (value) => {
				const file = writeRsaFile();
				process.env.POSITRON_LICENSE_KEY_FILE_DELETE_AFTER_USE = value;
				await validateLicenseKey('token', buildArgs({
					'license-key-file': file,
				}));
				expect(fs.existsSync(file)).toBe(false);
			},
		);

		it.each(['0', 'false', 'FALSE', 'no', 'off', '', '   ', 'enabled', 'garbage'])(
			'does NOT enable deletion when env var is %j',
			async (value) => {
				const file = writeRsaFile();
				process.env.POSITRON_LICENSE_KEY_FILE_DELETE_AFTER_USE = value;
				await validateLicenseKey('token', buildArgs({
					'license-key-file': file,
				}));
				expect(fs.existsSync(file)).toBe(true);
			},
		);
	});
});
