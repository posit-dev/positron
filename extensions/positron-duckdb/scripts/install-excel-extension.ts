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
 * The extension is a signed core DuckDB extension, so it loads from disk without
 * weakening signature verification. It must match the DuckDB engine exactly in
 * both version and platform; this script pins the version in package.json and
 * asserts it against the installed `@duckdb/node-api` so a binding bump can't
 * silently ship an unloadable extension.
 */

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

async function main(): Promise<void> {
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

	const extensionBytes = await downloadExtension(version, duckdbPlatformName);
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
