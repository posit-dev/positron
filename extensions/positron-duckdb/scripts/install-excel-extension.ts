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
 * Integrity and signing. DuckDB ships these extensions with a trailing footer
 * appended past the end of the Mach-O image. That footer is NOT just a signature:
 * it carries DuckDB's required metadata (platform, engine version, ABI type, and
 * a format-version magic) followed by a 256-byte signature. DuckDB reads that
 * metadata from the end of the file to recognize the artifact as one of its
 * extensions, independent of whether the signature is trusted. We don't rely on
 * the signature for trust; instead we pin a SHA-256 of each platform's artifact
 * in package.json and verify the download against it (see `assertHash`), which
 * guards against a compromised CDN or a corrupted download.
 *
 * On macOS the trailing footer is a problem at signing time: it sits past the end
 * of the Mach-O image, and Apple's `codesign --options runtime` strict validation
 * rejects any such trailing data ("main executable failed strict validation"),
 * which would block notarization. But the footer is *required* by DuckDB at load
 * time, so we can't simply drop it -- and we can't keep it either: these two
 * requirements conflict on the same bytes. We also can't re-attach the footer
 * after signing, because the extension lives inside the signed, sealed app bundle
 * and modifying it would invalidate the app signature. So we split the work:
 *
 *   1. Here (install time), for macOS targets we truncate the file to the end of
 *      the Mach-O image (see `stripMachOTrailingData`), leaving a clean Mach-O
 *      that codesign accepts, and we save the removed footer alongside it as a
 *      sidecar (`excel.duckdb_extension.footer`). Both ship inside the bundle and
 *      are sealed normally.
 *   2. At runtime, the extension reconstructs the full file (stripped Mach-O +
 *      footer) once into a writable cache outside the bundle and loads it from
 *      there (see `resolveExcelExtensionPath` in src/extension.ts).
 *
 * Apple's signing rewrites the Mach-O image, so DuckDB's own signature (computed
 * over the original image) no longer matches the reconstructed file; it is
 * therefore loaded with `allow_unsigned_extensions` at runtime (see
 * `duckdbWorker.ts`), and the pinned hash above is what backs its integrity.
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
import { stripMachOTrailingData, verifyExtensionHash } from '../src/excelExtensionInstallUtils';

/** Directory holding the vendored extension (packaged into the .vsix). */
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
/** The vendored, decompressed extension file loaded at runtime. */
const EXTENSION_FILE = path.join(RESOURCES_DIR, 'excel.duckdb_extension');
/**
 * macOS only: DuckDB's trailing footer, stripped from `EXTENSION_FILE` so the
 * Mach-O can be Apple-signed, saved here to be re-attached at runtime (see the
 * file header and `resolveExcelExtensionPath` in src/extension.ts).
 */
const FOOTER_FILE = path.join(RESOURCES_DIR, 'excel.duckdb_extension.footer');
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
 * canonical artifact DuckDB publishes. The byte-level comparison lives in
 * `verifyExtensionHash` (see excelExtensionInstallUtils.ts) so it can be tested;
 * this wrapper just supplies the pinned hash from package.json.
 */
function assertHash(bytes: Buffer, duckdbPlatformName: string): void {
	const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
	const expected = packageJson.positron?.duckdbExcelExtensionHashes?.[duckdbPlatformName];
	verifyExtensionHash(bytes, expected, duckdbPlatformName);
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

	// Skip the download if we already have the matching extension. On macOS we
	// also require the sidecar footer to be present, since signing depends on it.
	const isMacOS = duckdbPlatformName.startsWith('osx_');
	if (fs.existsSync(EXTENSION_FILE) && fs.existsSync(VERSION_FILE) &&
		fs.readFileSync(VERSION_FILE, 'utf-8') === tag &&
		(!isMacOS || fs.existsSync(FOOTER_FILE))) {
		console.log(`DuckDB Excel extension ${tag} already present; nothing to do.`);
		return;
	}

	let extensionBytes = await downloadExtension(version, duckdbPlatformName);

	// Verify integrity against the pinned hash before any further processing, so
	// the check covers the canonical artifact DuckDB published.
	assertHash(extensionBytes, duckdbPlatformName);

	// On macOS, strip DuckDB's trailing footer so codesign's strict validation
	// passes and the app can be notarized, and save the footer so it can be
	// re-attached at runtime (see the file header for the full rationale). Fail
	// loudly if there was nothing to strip: shipping a file with DuckDB's footer
	// still attached would break signing later in the pipeline with the opaque
	// "main executable failed strict validation", far from this root cause.
	let footer: Buffer | undefined;
	if (isMacOS) {
		const stripped = stripMachOTrailingData(extensionBytes);
		if (!stripped) {
			throw new Error(
				`Expected to strip DuckDB's trailing footer from the macOS Excel extension ` +
				`(${duckdbPlatformName}), but found no trailing data past the Mach-O image. The ` +
				'artifact format may have changed; signing would fail strict validation. Inspect ' +
				'the download and update stripMachOTrailingData before shipping.'
			);
		}
		footer = extensionBytes.subarray(stripped.length);
		console.log(`Stripped ${footer.length} trailing bytes (DuckDB footer) for macOS signing; saved for runtime re-attach.`);
		extensionBytes = stripped;
	}

	fs.mkdirSync(RESOURCES_DIR, { recursive: true });
	fs.writeFileSync(EXTENSION_FILE, new Uint8Array(extensionBytes));
	if (footer) {
		fs.writeFileSync(FOOTER_FILE, new Uint8Array(footer));
	} else if (fs.existsSync(FOOTER_FILE)) {
		// Non-macOS target: drop any stale footer from a previous macOS install so
		// we never ship an orphaned sidecar.
		fs.rmSync(FOOTER_FILE);
	}
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
