/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from '../../base/common/path.js';
import type { ILicenseValidationResult } from './remoteLicenseKey.js';

const execFileAsync = promisify(execFile);

const LicError = {
	OK: 0,
	FAIL: 1,
	TRIAL_EXPIRED: 2,
	VM: 3,
	ALREADY_ACTIVATED: 4,
	FILE_NOT_FOUND: 41,
	ROOT_REQUIRED: 44,
} as const;

interface LicenseCommandResult {
	result: number;
	message?: string;
	status?: string;
	'days-left'?: number;
	'has-key'?: boolean;
	'has-trial'?: boolean;
	'license-file'?: string;
	licensee?: string;
	initialized?: boolean;
	expiration?: number;
}

function validatedResult(result: LicenseCommandResult): ILicenseValidationResult {
	const status = result.status?.toLowerCase() || '';
	if (status === 'expired') {
		throw new Error('License has expired. Please renew your license.');
	}
	if (status !== 'activated' && status !== 'evaluation') {
		throw new Error(`Invalid license result: ${JSON.stringify(result)}`);
	}
	return { valid: true, licensee: result.licensee };
}

type LicErrorCode = typeof LicError[keyof typeof LicError];
const knownResultCodes = new Set(Object.values(LicError) as LicErrorCode[]);
function knownResultCode(code: unknown): code is LicErrorCode {
	return typeof code === 'number' && knownResultCodes.has(code as LicErrorCode);
}

// The `verify` command prefixes its JSON output with a signature hash line.
// If stdout contains no '{', returns as-is; JSON.parse will throw upstream.
function extractJson(stdout: string): string {
	const jsonStart = stdout.indexOf('{');
	return jsonStart > 0 ? stdout.slice(jsonStart) : stdout;
}

/**
 * Hashes the contents of a license file into the short, stable identifier that P3M
 * telemetry reports as `positron-license-hash`, so Posit can count session starts per
 * license it issued. SHA-256 over the trimmed license bytes, truncated to 16 hex
 * characters: wide enough that collisions across the issued licenses are negligible,
 * short enough to stay readable in URLs and logs.
 *
 * Surrounding ASCII whitespace is the only thing normalized away. Everything between the
 * first and last non-ASCII-whitespace byte is hashed exactly as it appears, interior line
 * endings included; the Posit-side script must use the same byte-level contract.
 *
 * The hash identifies a deployment's license, not a user, and is meaningless to anyone
 * without Posit's own records of the licenses it issued.
 */
export function hashLicenseContents(contents: Buffer): string | undefined {
	let start = 0;
	while (start < contents.length && isAsciiWhitespace(contents[start])) {
		start++;
	}

	let end = contents.length;
	while (end > start && isAsciiWhitespace(contents[end - 1])) {
		end--;
	}

	if (start === end) {
		return undefined;
	}
	return crypto.createHash('sha256').update(contents.subarray(start, end)).digest('hex').slice(0, 16);
}

function isAsciiWhitespace(byte: number): boolean {
	return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

/**
 * Hashes the license file backing a verified license. Prefers the path the license-manager
 * binary reported; falls back to the .lic in its own directory, which is where both
 * `activateLicenseFile` and `verifyLocalLicense` leave the effective license.
 *
 * Returns undefined when no candidate yields a hash. The hash is telemetry only, so a
 * failure to compute it must never fail an otherwise valid license check; reporting nothing
 * is always better than reporting a hash that does not identify a license Posit issued.
 */
export function licenseFileHash(licenseManagerDir: string, reportedPath?: string): string | undefined {
	// Only an absolute reported path is usable. A relative one would resolve against the
	// server process's working directory rather than the binary's, which could read an
	// unrelated same-named file; the directory scan below is the better guess in that case.
	const candidates: string[] = reportedPath && path.isAbsolute(reportedPath) ? [reportedPath] : [];
	try {
		const localLic = fs.readdirSync(licenseManagerDir).find(f => f.endsWith('.lic'));
		if (localLic) {
			candidates.push(path.join(licenseManagerDir, localLic));
		}
	} catch {
		// Directory unreadable; whatever the binary reported is all we have.
	}
	for (const candidate of candidates) {
		let contents: Buffer;
		try {
			contents = fs.readFileSync(candidate);
		} catch {
			// Unreadable candidate; try the next one.
			continue;
		}
		// An empty or whitespace-only file hashes to a perfectly well-formed value that
		// identifies no license at all, and every deployment with a truncated or
		// placeholder .lic would report that same value. Skip it: a collapsed group in
		// Posit's per-license counts is far worse than a missing one.
		const licenseHash = hashLicenseContents(contents);
		if (licenseHash) {
			return licenseHash;
		}
	}
	return undefined;
}

/**
 * Wrapper for executing classic `license-manager` binary commands (the binary bundled
 * under `resources/activation/`). Not to be confused with `licenseManager.ts`, which
 * supervises the AWS License Manager client.
 */
class LocalLicenseManager {
	constructor(private readonly licenseManagerPath: string) { }

	private async runJsonCommand(command: string, args: string[] = []): Promise<LicenseCommandResult> {
		const licenseManagerDir = path.dirname(this.licenseManagerPath);
		const env = {
			...process.env,
			LD_LIBRARY_PATH: licenseManagerDir,
		};

		let stdout = '';
		try {
			const result = await execFileAsync(
				this.licenseManagerPath,
				[command, ...args, '--output=json'],
				{ maxBuffer: 1024 * 1024, timeout: 10000, env }
			);
			if (result.stderr && result.stderr.length > 0) {
				console.warn(`license-manager stderr: ${result.stderr}`);
			}
			stdout = result.stdout;
		} catch (error) {
			const execError = error as { stdout?: string; message?: string };
			stdout = execError.stdout ?? '';
			if (!stdout) {
				throw new Error(execError.message || 'Unknown error');
			}
		}

		const jsonStr = extractJson(stdout);
		const parsed = JSON.parse(jsonStr);
		if (!knownResultCode(parsed?.result)) {
			throw new Error(`Unexpected license-manager response: ${stdout}`);
		}
		return parsed;
	}

	async verify(): Promise<ILicenseValidationResult> {
		const result = await this.runJsonCommand('verify');
		if (result.result !== LicError.OK) {
			throw new Error(`License verification failed: ${result.message || `code ${result.result}`}`);
		}

		const validated = validatedResult(result);
		console.log(`Positron license verified: ${JSON.stringify(result)}`);
		// Hash the verified file here rather than at the call sites: this is the one
		// place both the activated and the pre-existing local .lic converge, so the
		// hash always names the license that was actually accepted.
		const licenseHash = licenseFileHash(path.dirname(this.licenseManagerPath), result['license-file']);
		return licenseHash ? { ...validated, licenseHash } : validated;
	}

	async activateLicenseFile(licenseFilePath: string): Promise<ILicenseValidationResult> {
		const licenseManagerDir = path.dirname(this.licenseManagerPath);

		if (!fs.existsSync(licenseFilePath)) {
			throw new Error(`License file not found: ${licenseFilePath}`);
		}

		const localLic = fs.readdirSync(licenseManagerDir).find(f => f.endsWith('.lic'));
		if (!localLic) {
			// No .lic next to the binary -- copy the provided file there.
			fs.copyFileSync(licenseFilePath, path.join(licenseManagerDir, path.basename(licenseFilePath)));
		} else {
			const localLicPath = path.join(licenseManagerDir, localLic);
			// Compare contents rather than paths: the provided path may be the
			// local file itself, and copying a file onto itself truncates it.
			let sameContents: boolean | undefined;
			try {
				sameContents = fs.readFileSync(licenseFilePath).equals(fs.readFileSync(localLicPath));
			} catch {
				// One of the files is unreadable; leave the existing file in
				// place and let verification report its state.
			}
			if (sameContents === false) {
				// The provided license differs from the local one -- overwrite
				// the local file in place so a renewal takes effect. Sessions
				// without write access keep using the existing file.
				try {
					fs.copyFileSync(licenseFilePath, localLicPath);
					console.log(`Replaced license file: ${localLicPath}`);
				} catch (e) {
					console.warn(`Cannot replace license file at ${localLicPath}: ${e}; using the existing license file.`);
				}
			} else {
				console.log(`Using existing license file: ${localLicPath}`);
			}
		}

		return this.verify();
	}
}

/**
 * Activates a Positron Server license file using the license-manager binary.
 */
export async function activateWithManager(
	installPath: string,
	licenseFilePath: string,
): Promise<ILicenseValidationResult> {
	const licenseManagerPath = findLicenseManagerPath(installPath);
	const licenseManager = new LocalLicenseManager(licenseManagerPath);
	return licenseManager.activateLicenseFile(licenseFilePath);
}

/**
 * Checks for a .lic file next to the license-manager binary and verifies it.
 * Returns undefined if no .lic file is found or the binary doesn't exist.
 */
export async function verifyLocalLicense(
	installPath: string,
): Promise<ILicenseValidationResult | undefined> {
	let licenseManagerPath: string;
	try {
		licenseManagerPath = findLicenseManagerPath(installPath);
	} catch {
		return undefined;
	}

	const licenseManagerDir = path.dirname(licenseManagerPath);
	let localLic: string | undefined;
	try {
		localLic = fs.readdirSync(licenseManagerDir).find(f => f.endsWith('.lic'));
	} catch {
		return undefined;
	}
	if (!localLic) {
		return undefined;
	}

	const licenseManager = new LocalLicenseManager(licenseManagerPath);
	return licenseManager.verify();
}

/**
 * Gets the platform-specific subdirectory for the license-manager binary.
 * @returns The platform subdirectory path
 */
function getPlatformSubdir(): string {
	const platform = os.platform();
	if (platform === 'linux') {
		const arch = os.arch();
		// Map Node.js arch names to the directory names used by the build
		const archMap: Record<string, string> = {
			'x64': 'x86_64',
			'arm64': 'aarch64',
		};
		const archDir = archMap[arch] || arch;
		return path.join('linux', archDir);
	}
	// No other platforms are currently supported
	throw new Error(`Platform not supported: ${platform}`);
}

/**
 * Locates the license-manager binary relative to the Positron installation.
 * @param installPath The root installation path of Positron
 * @returns The absolute path to the license-manager binary
 */
function findLicenseManagerPath(installPath: string): string {
	const platformSubdir = getPlatformSubdir();
	const licenseManagerPath = path.join(installPath, 'resources', 'activation', platformSubdir, 'license-manager');

	if (!fs.existsSync(licenseManagerPath)) {
		throw new Error(`License manager binary not found at: ${licenseManagerPath}`);
	}

	try {
		fs.accessSync(licenseManagerPath, fs.constants.X_OK);
	} catch {
		throw new Error(`License manager binary is not executable: ${licenseManagerPath}`);
	}

	return licenseManagerPath;
}
