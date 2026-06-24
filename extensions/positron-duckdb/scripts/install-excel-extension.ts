/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Downloads the DuckDB `excel` extension that the data explorer uses to read
 * `.xlsx` files, and vendors it under `resources/` so it can be loaded from
 * disk at runtime (rather than via DuckDB's network autoload). Bundling the
 * extension is what makes `.xlsx` support work in offline / airgapped installs.
 *
 * It must match the DuckDB engine exactly in both version and platform; this
 * script pins the version in package.json and asserts it against the installed
 * `@duckdb/node-api` so a binding bump can't silently ship an unloadable
 * extension.
 *
 * Integrity and signing. DuckDB ships these extensions with its own 256-bit
 * signature appended to the end of the file. We don't rely on that signature for
 * trust; instead we pin a SHA-256 of each platform's artifact in package.json
 * and verify the download against it (see `assertHash`), which guards against a
 * compromised CDN or a corrupted download. On macOS the trailing DuckDB footer
 * also has to go: it sits past the end of the Mach-O code signature, and Apple's
 * `codesign --options runtime` strict validation rejects any such trailing data
 * ("main executable failed strict validation"), which would block notarization.
 * So for macOS targets we truncate the file to the end of its `LC_CODE_SIGNATURE`
 * (see `stripMachOTrailingData`), leaving a clean Mach-O that can be Apple-signed
 * and notarized. Stripping the footer makes DuckDB treat the extension as
 * unsigned, which is why it is loaded with `allow_unsigned_extensions` at runtime
 * (see `duckdbWorker.ts`); the pinned hash above is what backs its integrity.
 *
 * Pass `--print-hashes` to download every supported platform and print the
 * SHA-256 map to paste into package.json when bumping the pinned version.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';
import { arch, platform } from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

/** Directory holding the vendored extension (packaged into the .vsix). */
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
/** The vendored, decompressed extension file loaded at runtime. */
const EXTENSION_FILE = path.join(RESOURCES_DIR, 'excel.duckdb_extension');
/** Records the version that was downloaded, to skip redundant downloads. */
const VERSION_FILE = path.join(RESOURCES_DIR, 'EXCEL_VERSION');

/**
 * Resolve the DuckDB extension platform name (e.g. `osx_arm64`) for the build
 * target. Respects the build's target arch so cross-builds (e.g. building x64
 * on an arm64 host) fetch the right artifact. npm normalizes the `NPM_CONFIG_ARCH`
 * env var to the lowercase `npm_config_arch` config when it runs lifecycle
 * scripts, but we also read the raw env var so a direct invocation (outside an
 * npm lifecycle) still honors it.
 */
function duckdbPlatform(): string {
	const targetArch = process.env['npm_config_arch'] || process.env['NPM_CONFIG_ARCH'] || arch();
	switch (platform()) {
		case 'darwin':
			return targetArch === 'arm64' ? 'osx_arm64' : 'osx_amd64';
		case 'linux':
			return targetArch === 'arm64' ? 'linux_arm64' : 'linux_amd64';
		case 'win32':
			return 'windows_amd64';
		default:
			throw new Error(`Unsupported platform for the DuckDB Excel extension: ${platform()}`);
	}
}

/**
 * The DuckDB engine version that the excel extension must match. Pinned in
 * package.json and validated against the installed @duckdb/node-api below.
 */
function pinnedDuckDBVersion(): string {
	const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
	const version = packageJson.positron?.binaryDependencies?.duckdbExcelExtension;
	if (!version) {
		throw new Error('Missing positron.binaryDependencies.duckdbExcelExtension in package.json.');
	}
	return version;
}

/**
 * Verify the pinned extension version matches the installed @duckdb/node-api so
 * the extension is loadable by the bundled engine. node-api versions look like
 * `1.5.3-r.3`; the underlying DuckDB version is the `1.5.3` part.
 */
function assertVersionMatchesEngine(pinnedVersion: string): void {
	const nodeApiPackageJson = JSON.parse(fs.readFileSync(
		path.join(__dirname, '..', 'node_modules', '@duckdb', 'node-api', 'package.json'), 'utf-8'));
	const engineVersion = `v${String(nodeApiPackageJson.version).split('-')[0]}`;
	if (engineVersion !== pinnedVersion) {
		throw new Error(
			`The pinned Excel extension version (${pinnedVersion}) does not match the ` +
			`installed @duckdb/node-api engine (${engineVersion}). Update ` +
			`positron.binaryDependencies.duckdbExcelExtension in package.json to ${engineVersion}.`
		);
	}
}

/**
 * The DuckDB platform names we ship an extension for. Used by `--print-hashes`
 * to regenerate the pinned SHA-256 map when bumping the version.
 */
const SUPPORTED_PLATFORMS = ['osx_arm64', 'osx_amd64', 'linux_arm64', 'linux_amd64', 'windows_amd64'] as const;

/**
 * Assert the downloaded (decompressed) extension matches the SHA-256 pinned for
 * its platform in package.json. This is our integrity anchor: we strip DuckDB's
 * own signature on macOS, so the pin is what protects against a tampered or
 * corrupted download. Verify before any stripping, so the pin matches the
 * canonical artifact DuckDB publishes.
 */
function assertHash(bytes: Buffer, duckdbPlatformName: string): void {
	const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
	const expected = packageJson.positron?.duckdbExcelExtensionHashes?.[duckdbPlatformName];
	if (!expected) {
		throw new Error(
			`Missing positron.duckdbExcelExtensionHashes.${duckdbPlatformName} in package.json. ` +
			'Run `npm run print-excel-hashes` and paste the result to pin the expected hashes.'
		);
	}
	const actual = crypto.createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
	if (actual !== expected) {
		throw new Error(
			`SHA-256 mismatch for the DuckDB Excel extension (${duckdbPlatformName}): expected ` +
			`${expected}, got ${actual}. The download may be corrupt or tampered with. If the ` +
			'pinned version changed, regenerate hashes with `npm run print-excel-hashes`.'
		);
	}
}

/**
 * Truncate a thin 64-bit Mach-O to the end of its code signature, dropping any
 * trailing data (DuckDB appends its signature there). Returns the truncated
 * bytes, or `undefined` if `bytes` is not a thin 64-bit Mach-O with an `LC_CODE_SIGNATURE`
 * (e.g. a fat binary or a non-Mach-O artifact), in which case nothing is
 * stripped. Downloads are always thin, per-arch artifacts, so the fat case does
 * not arise here; the guard just keeps this safe if that ever changes.
 */
function stripMachOTrailingData(bytes: Buffer): Buffer | undefined {
	// DuckDB ships x86_64 / arm64 extensions, which are little-endian 64-bit
	// Mach-O. Only handle that; treat anything else (fat, big-endian, non-Mach-O)
	// as "nothing to strip".
	const MH_MAGIC_64 = 0xfeedfacf;
	const LC_CODE_SIGNATURE = 0x1d;

	if (bytes.length < 32 || bytes.readUInt32LE(0) !== MH_MAGIC_64) {
		return undefined;
	}

	const ncmds = bytes.readUInt32LE(16); // mach_header_64: magic, cputype, cpusubtype, filetype, ncmds, ...
	let offset = 32; // size of mach_header_64
	for (let i = 0; i < ncmds && offset + 16 <= bytes.length; i++) {
		const cmd = bytes.readUInt32LE(offset);
		const cmdsize = bytes.readUInt32LE(offset + 4);
		if (cmd === LC_CODE_SIGNATURE) {
			const dataoff = bytes.readUInt32LE(offset + 8);
			const datasize = bytes.readUInt32LE(offset + 12);
			const end = dataoff + datasize;
			return end < bytes.length ? bytes.subarray(0, end) : undefined;
		}
		offset += cmdsize;
	}
	return undefined;
}

/** GET a URL, following redirects, resolving with the final response. */
function httpsGet(url: string): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers: { 'User-Agent': 'positron-duckdb-excel-downloader' } }, (res) => {
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				res.resume();
				resolve(httpsGet(new URL(res.headers.location, url).toString()));
				return;
			}
			resolve(res);
		});
		req.once('error', reject);
	});
}

/** Download the gzipped extension and return its decompressed bytes. */
async function downloadExtension(version: string, duckdbPlatformName: string): Promise<Buffer> {
	const url = `https://extensions.duckdb.org/${version}/${duckdbPlatformName}/excel.duckdb_extension.gz`;
	console.log(`Downloading DuckDB Excel extension from ${url} ...`);
	const response = await httpsGet(url);
	if (response.statusCode !== 200) {
		response.resume();
		throw new Error(`Failed to download the DuckDB Excel extension: HTTP ${response.statusCode}`);
	}
	const chunks: Buffer[] = [];
	for await (const chunk of response) {
		chunks.push(chunk as Buffer);
	}
	const compressed = Buffer.concat(chunks);
	if (compressed.length < 1024) {
		throw new Error(`Downloaded data is too small (${compressed.length} bytes); the download probably failed.`);
	}
	return zlib.gunzipSync(compressed);
}

/**
 * Download every supported platform's extension and print the SHA-256 map to
 * paste into `positron.duckdbExcelExtensionHashes` in package.json. Run this
 * (via `npm run print-excel-hashes`) whenever the pinned version changes.
 */
async function printHashes(): Promise<void> {
	const version = pinnedDuckDBVersion();
	const hashes: Record<string, string> = {};
	for (const duckdbPlatformName of SUPPORTED_PLATFORMS) {
		const bytes = await downloadExtension(version, duckdbPlatformName);
		hashes[duckdbPlatformName] = crypto.createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
	}
	console.log(`\nPaste into positron.duckdbExcelExtensionHashes in package.json for ${version}:`);
	console.log(JSON.stringify(hashes, null, 2));
}

async function main(): Promise<void> {
	if (process.argv.includes('--print-hashes')) {
		await printHashes();
		return;
	}

	const version = pinnedDuckDBVersion();
	assertVersionMatchesEngine(version);
	const duckdbPlatformName = duckdbPlatform();
	const tag = `${version}/${duckdbPlatformName}`;

	// Skip the download if we already have the matching extension.
	if (fs.existsSync(EXTENSION_FILE) && fs.existsSync(VERSION_FILE) &&
		fs.readFileSync(VERSION_FILE, 'utf-8') === tag) {
		console.log(`DuckDB Excel extension ${tag} already present; nothing to do.`);
		return;
	}

	let extensionBytes = await downloadExtension(version, duckdbPlatformName);

	// Verify integrity against the pinned hash before any further processing, so
	// the check covers the canonical artifact DuckDB published.
	assertHash(extensionBytes, duckdbPlatformName);

	// On macOS, strip DuckDB's trailing signature so codesign's strict validation
	// passes and the app can be notarized (see the file header for why).
	if (duckdbPlatformName.startsWith('osx_')) {
		const stripped = stripMachOTrailingData(extensionBytes);
		if (stripped) {
			console.log(`Stripped ${extensionBytes.length - stripped.length} trailing bytes (DuckDB signature) for macOS signing.`);
			extensionBytes = stripped;
		}
	}

	fs.mkdirSync(RESOURCES_DIR, { recursive: true });
	fs.writeFileSync(EXTENSION_FILE, new Uint8Array(extensionBytes));
	fs.writeFileSync(VERSION_FILE, tag);
	console.log(`Installed DuckDB Excel extension ${tag} (${extensionBytes.length} bytes).`);
}

/**
 * Whether we are running in CI. Azure Pipelines (this repo's CI) sets `TF_BUILD`;
 * most other CI systems set `CI`.
 */
function isCI(): boolean {
	return !!(process.env['CI'] || process.env['TF_BUILD'] || process.env['BUILD_BUILDID']);
}

main().catch((error) => {
	console.error('Failed to install the DuckDB Excel extension:', error);
	if (isCI()) {
		// Fail the build hard: a release that "builds" but silently lacks Excel
		// support is worse than a build failure. Better to find out here.
		process.exit(1);
	}
	// On a developer machine, soft-fail: a transient download problem (offline,
	// proxy, CDN hiccup) should not block `npm install` for the whole repo. The
	// runtime degrades gracefully when the extension is absent -- only .xlsx
	// support is unavailable, with a clear error -- and re-running install will
	// fetch it once the network recovers.
	console.warn(
		'Continuing without the DuckDB Excel extension. Excel (.xlsx) support in ' +
		'the data explorer will be unavailable until this download succeeds; ' +
		're-run `npm install` (or `npm run install-excel-extension`) to retry.'
	);
});
