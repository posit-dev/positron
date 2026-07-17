/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Postinstall script for positron-r. Resolves an Ark binary into the runtime
 * location `resources/ark/` for use by the kernel launcher (`src/kernel.ts`).
 *
 * The Ark version is determined by the submodule pinned at
 * `extensions/positron-r/ark`:
 *   <version>  = `version` field in `ark/crates/ark/Cargo.toml`
 *   <distance> = `git rev-list --count <last-tag>..HEAD` inside the submodule
 *   <short_sha> = `git rev-parse --short=7 HEAD` inside the submodule
 *
 * The expected prebuild release tag in `posit-dev/positron-ark` is:
 *   `ark-<version>-<distance>-<short_sha>`
 *
 * The short SHA is included so builds from diverging branches at the same
 * (version, distance) produce distinct tags and asset names.
 *
 * The resolved submodule commit is also written to a `SUBMODULE_COMMIT` sidecar
 * in the runtime location. Because that location ships in the packaged
 * extension, Positron can compare it against the running Ark's commit to warn
 * about a stale Ark even in a release build (see `src/arkVersionCheck.ts`).
 *
 * Resolution order (local dev):
 *   1. A local `cargo build` at `ark/target/release/ark[.exe]`
 *   2. An already-installed prebuild matching the expected version (marker file)
 *   3. Download the exact prebuild from positron-ark
 *   4. Build from source via `cargo build --release` (if rust is installed)
 *   5. Download the most recent earlier prebuild (with a stderr note)
 *   6. Helpful error
 *
 * On a dev machine, building the current ark from source is preferred over
 * silently downloading a stale prebuild: a developer with the rust toolchain
 * installed should get exactly the ark their submodule points at. The
 * older-prebuild fallback (step 5) is the absolute last resort, for machines
 * without rust, and it prints a stderr warning so the staleness is visible.
 *
 * In CI (detected via `CI=true`), the fallback prebuild step is skipped
 * entirely: we go exact prebuild -> build from source -> fail hard. A PR that
 * bumps the ark submodule must actually test against the new ark, never
 * against a stale fallback. CI runners for the common platforms have rust
 * pre-installed.
 */

import decompress from 'decompress';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as https from 'https';
import { platform, arch } from 'os';
import * as path from 'path';
import { promisify } from 'util';

// Paths relative to the cwd at install time (extensions/positron-r).
const SUBMODULE_DIR = 'ark';
const RUNTIME_DIR = path.join('resources', 'ark');
const MARKER_FILE = path.join(RUNTIME_DIR, 'VERSION');
// Sidecar recording the submodule commit this install was resolved against.
// Ships in the packaged extension (unlike the submodule itself), so Positron
// can detect a stale Ark at runtime even in a release build with no git. See
// `warnOnArkVersionMismatch` in `src/arkVersionCheck.ts`.
const SUBMODULE_COMMIT_FILE = path.join(RUNTIME_DIR, 'SUBMODULE_COMMIT');

// GitHub repo that hosts the prebuilds.
const PREBUILD_OWNER = 'posit-dev';
const PREBUILD_REPO = 'positron-ark';

const writeFileAsync = promisify(fs.writeFile);
const existsAsync = promisify(fs.exists);

const redirectStatusCodes = new Set([301, 302, 307, 308]);

type NodeArch = ReturnType<typeof arch>;

/**
 * Information about a single asset to download for the current platform.
 */
interface ArkAssetTarget {
	/** The platform-arch suffix in the asset filename, e.g. `darwin-universal`. */
	readonly assetSuffix: string;
	/** Optional subdirectory under `resources/ark/` to extract into. */
	readonly subdirectory?: string;
	/** Human-readable label for log output. */
	readonly label: string;
}

/**
 * Resolved version info for the Ark submodule.
 */
interface ArkBuildInfo {
	/** Public release version from Cargo.toml, e.g. `0.1.251`. */
	version: string;
	/** Commits past the most recent ark release tag. */
	distance: number;
	/** Short (7-char) SHA of the ark submodule HEAD. */
	shortSha: string;
	/** Release tag to look for in positron-ark, e.g. `ark-0.1.251-10-abc1234`. */
	releaseTag: string;
	/** Version string the binary self-reports, e.g. `0.1.251+10.abc1234`. */
	buildVersion: string;
}

/** Idle timeout for HTTPS requests. Avoids indefinite hangs on flaky networks. */
const HTTPS_TIMEOUT_MS = 60_000;

/** Promisified `https.get` returning the response. Aborts after `HTTPS_TIMEOUT_MS` of inactivity. */
const httpsGetAsync = (opts: https.RequestOptions | string | URL): Promise<IncomingMessage> => {
	return new Promise<IncomingMessage>((resolve, reject) => {
		const req = https.get(opts, resolve);
		req.once('error', reject);
		req.setTimeout(HTTPS_TIMEOUT_MS, () => {
			req.destroy(new Error(`HTTPS request timed out after ${HTTPS_TIMEOUT_MS}ms`));
		});
	});
};

const readResponseBody = async (response: IncomingMessage): Promise<Buffer> => {
	return await new Promise<Buffer>((resolve, reject) => {
		const chunks: Buffer[] = [];
		response.on('data', chunk => {
			chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
		});
		response.once('end', () => resolve(Buffer.concat(chunks)));
		response.once('error', reject);
	});
};

function buildRequestOptions(url: URL, headers: Record<string, string>): https.RequestOptions {
	return {
		headers,
		method: 'GET',
		protocol: url.protocol,
		hostname: url.hostname,
		path: `${url.pathname}${url.search}`
	};
}

async function downloadReleaseAsset(assetUrl: string, headers: Record<string, string>): Promise<Buffer> {
	let requestUrl = new URL(assetUrl);
	let response = await httpsGetAsync(buildRequestOptions(requestUrl, headers));
	while (response.statusCode && redirectStatusCodes.has(response.statusCode)) {
		const location = response.headers.location;
		if (!location) {
			throw new Error('Redirect response missing Location header while downloading Ark asset.');
		}
		requestUrl = new URL(location);
		response = await httpsGetAsync(buildRequestOptions(requestUrl, headers));
	}
	if (response.statusCode !== 200) {
		const body = await readResponseBody(response);
		throw new Error(`Failed to download asset: HTTP ${response.statusCode}\n\n${body.toString('utf-8')}`);
	}
	return await readResponseBody(response);
}

/**
 * Env overrides applied to every subprocess spawned by this script. We use
 * git's `GIT_CONFIG_*` env vars to mark all directories as safe - CI runners
 * (especially containerized ones) often have the workspace owned by a
 * different uid than the one running git, which trips git's "dubious
 * ownership" check. The env-var form is process-local; it never touches the
 * user's global git config.
 */
const subprocessEnv: NodeJS.ProcessEnv = {
	...process.env,
	GIT_CONFIG_COUNT: '1',
	GIT_CONFIG_KEY_0: 'safe.directory',
	GIT_CONFIG_VALUE_0: '*',
};

/**
 * Run a short shell command and capture its output. Use {@link runStreaming}
 * for long-running commands like `cargo build`.
 */
async function execShort(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
	const { exec } = require('child_process');
	return new Promise((resolve, reject) => {
		exec(command, { cwd, env: subprocessEnv }, (error: Error | null, stdout: string, stderr: string) => {
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

/**
 * Run a command, inheriting stdio. Resolves on exit 0; rejects otherwise.
 */
async function runStreaming(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: platform() === 'win32' });
		child.on('error', reject);
		child.on('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${command} exited with code ${code}.`));
			}
		});
	});
}

/**
 * What asset(s) we need for the current platform/arch.
 */
function getDownloadTargets(currentPlatform: NodeJS.Platform, currentArch: NodeArch): ArkAssetTarget[] {
	switch (currentPlatform) {
		case 'win32':
			// On Windows, we always download both x64 and arm64 builds since
			// Windows on ARM can run x64 via emulation, and Positron may need
			// to launch ark for an R installation that doesn't match the host arch.
			return [
				{ assetSuffix: 'windows-arm64', subdirectory: 'windows-arm64', label: 'Windows ARM64' },
				{ assetSuffix: 'windows-x64', subdirectory: 'windows-x64', label: 'Windows x64' }
			];
		case 'darwin':
			return [{
				assetSuffix: currentArch === 'arm64' ? 'darwin-arm64' : 'darwin-x64',
				label: currentArch === 'arm64' ? 'macOS ARM64' : 'macOS x64'
			}];
		case 'linux':
			return [{
				assetSuffix: currentArch === 'arm64' ? 'linux-arm64' : 'linux-x64',
				label: currentArch === 'arm64' ? 'Linux ARM64' : 'Linux x64'
			}];
		default:
			throw new Error(`Unsupported platform ${currentPlatform}.`);
	}
}

/**
 * Make sure the ark submodule is checked out and has tags available for
 * `git describe`. This is defensive — CI workflows that don't checkout with
 * `submodules: true` (or shallow checkouts that omit tags) still produce a
 * working install.
 */
async function ensureSubmoduleReady(): Promise<void> {
	const cargoPath = path.join(SUBMODULE_DIR, 'crates', 'ark', 'Cargo.toml');
	if (!await existsAsync(cargoPath)) {
		console.log('Ark submodule not initialized; running `git submodule update --init`...');
		const { stdout } = await execShort('git rev-parse --show-toplevel');
		const repoRoot = stdout.trim();
		const submodulePath = `extensions/positron-r/${SUBMODULE_DIR}`;
		await execShort(`git submodule update --init -- ${submodulePath}`, repoRoot);
		if (!await existsAsync(cargoPath)) {
			throw new Error(`Submodule init did not produce ${cargoPath}.`);
		}
	}
	// Ensure tags are available for `git describe` (shallow checkouts may not
	// have them). A failed fetch is non-fatal; distance falls back to 0.
	try {
		await execShort('git describe --tags --abbrev=0', SUBMODULE_DIR);
	} catch {
		console.log('Fetching tags in ark submodule...');
		try {
			await execShort('git fetch --tags', SUBMODULE_DIR);
		} catch (err) {
			console.warn(`Could not fetch tags: ${err}`);
		}
	}
}

/**
 * Read the Ark version from the submodule's Cargo.toml and compute the git
 * distance from the most recent ark release tag.
 */
async function readSubmoduleBuildInfo(): Promise<ArkBuildInfo> {
	await ensureSubmoduleReady();

	const cargoPath = path.join(SUBMODULE_DIR, 'crates', 'ark', 'Cargo.toml');
	const cargo = await fs.promises.readFile(cargoPath, 'utf-8');
	const versionMatch = cargo.match(/^version\s*=\s*"([0-9.]+)"/m);
	if (!versionMatch) {
		throw new Error(`Could not parse version from ${cargoPath}.`);
	}
	const version = versionMatch[1];

	let distance = 0;
	try {
		const { stdout: lastTag } = await execShort('git describe --tags --abbrev=0', SUBMODULE_DIR);
		const tag = lastTag.trim();
		const { stdout: count } = await execShort(`git rev-list --count ${tag}..HEAD`, SUBMODULE_DIR);
		const parsed = parseInt(count.trim(), 10);
		if (!isNaN(parsed)) {
			distance = parsed;
		}
	} catch (err) {
		console.warn(`Could not compute distance from last ark tag: ${err}. Assuming distance=0.`);
	}

	const { stdout: shaOut } = await execShort('git rev-parse --short=7 HEAD', SUBMODULE_DIR);
	const shortSha = shaOut.trim();
	if (!/^[0-9a-f]{7}$/.test(shortSha)) {
		throw new Error(`Could not compute short SHA for ark submodule (got "${shortSha}").`);
	}

	const releaseTag = `ark-${version}-${distance}-${shortSha}`;
	const buildVersion = `${version}+${distance}.${shortSha}`;
	return { version, distance, shortSha, releaseTag, buildVersion };
}

/**
 * If the developer has built ark locally in the submodule's `target/debug` or
 * `target/release` directory, copy that binary into the runtime location.
 * Always wins over prebuilds — devs iterating on ark should see their changes
 * immediately. Debug is preferred over release: developers iterating on ark
 * typically run plain `cargo build`, so a debug binary is the current work.
 *
 * For Windows: only the host arch is populated. The other arch's slot is
 * left as-is (which may be empty or stale from a previous run).
 */
async function tryUseLocalBuild(): Promise<boolean> {
	const kernelName = platform() === 'win32' ? 'ark.exe' : 'ark';
	const debugBinary = path.join(SUBMODULE_DIR, 'target', 'debug', kernelName);
	const releaseBinary = path.join(SUBMODULE_DIR, 'target', 'release', kernelName);
	const localBinary = fs.existsSync(debugBinary) ? debugBinary
		: fs.existsSync(releaseBinary) ? releaseBinary
			: undefined;
	if (!localBinary) {
		return false;
	}

	console.log(`Using locally built Ark from ${localBinary}.`);
	await fs.promises.mkdir(RUNTIME_DIR, { recursive: true });

	if (platform() === 'win32') {
		const subdir = process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
		const targetDir = path.join(RUNTIME_DIR, subdir);
		await fs.promises.mkdir(targetDir, { recursive: true });
		await fs.promises.copyFile(localBinary, path.join(targetDir, kernelName));
	} else {
		await fs.promises.copyFile(localBinary, path.join(RUNTIME_DIR, kernelName));
	}

	// Don't write the marker — local builds re-evaluate via the binary's
	// existence in the submodule on every run, so a marker would just go stale.
	return true;
}

/**
 * Record the submodule commit this install resolved against, next to the
 * binary. Bundled with the extension (`resources/ark/` ships), so Positron can
 * compare it to the running Ark's reported commit at runtime even when the git
 * submodule isn't present (a release build). See `warnOnArkVersionMismatch` in
 * `src/arkVersionCheck.ts`. Distinct from {@link MARKER_FILE}, which records the
 * *installed* build version for the prebuild cache check.
 */
async function writeSubmoduleCommitMarker(info: ArkBuildInfo): Promise<void> {
	await fs.promises.mkdir(RUNTIME_DIR, { recursive: true });
	await writeFileAsync(SUBMODULE_COMMIT_FILE, info.shortSha);
}

/**
 * Whether the runtime location already holds a prebuild matching `info`.
 * The marker is written only by {@link extractPrebuildAssets} after a
 * successful download; local-build paths intentionally do not touch it.
 */
async function isCachedPrebuildCurrent(info: ArkBuildInfo): Promise<boolean> {
	if (!await existsAsync(MARKER_FILE)) {
		return false;
	}
	const marker = (await fs.promises.readFile(MARKER_FILE, 'utf-8')).trim();
	return marker === info.buildVersion;
}

/**
 * Discover a GitHub PAT from environment variables or git config.
 */
async function findGithubPat(): Promise<string | undefined> {
	let pat = process.env.GITHUB_PAT;
	if (pat) {
		console.log('Using GitHub PAT from GITHUB_PAT.');
		return pat;
	}
	pat = process.env.POSITRON_GITHUB_RO_PAT;
	if (pat) {
		console.log('Using GitHub PAT from POSITRON_GITHUB_RO_PAT.');
		return pat;
	}
	try {
		const { stdout } = await execShort('git config --get credential.https://api.github.com.token');
		pat = stdout.trim();
		if (pat) {
			console.log('Using GitHub PAT from git config (credential.https://api.github.com.token).');
			return pat;
		}
	} catch {
		// No git config setting; fine.
	}
	return undefined;
}

function buildHeaders(githubPat: string | undefined): Record<string, string> {
	const headers: Record<string, string> = {
		'Accept': 'application/vnd.github+json',
		'User-Agent': 'positron-ark-installer'
	};
	if (githubPat) {
		headers.Authorization = `token ${githubPat}`;
	}
	return headers;
}

/**
 * Fetch a single release by tag from positron-ark. Returns null on 404.
 */
async function fetchReleaseByTag(tag: string, githubPat: string | undefined): Promise<any | null> {
	const headers = buildHeaders(githubPat);
	const response = await httpsGetAsync({
		headers,
		method: 'GET',
		protocol: 'https:',
		hostname: 'api.github.com',
		path: `/repos/${PREBUILD_OWNER}/${PREBUILD_REPO}/releases/tags/${tag}`
	} as https.RequestOptions);
	const buf = await readResponseBody(response);
	if (response.statusCode === 404) {
		return null;
	}
	if (response.statusCode !== 200) {
		throw new Error(
			`Failed to query positron-ark release ${tag}: HTTP ${response.statusCode}\n\n` +
			buf.toString('utf-8'));
	}
	return JSON.parse(buf.toString('utf-8'));
}

interface ParsedRelease {
	tag: string;
	version: string;
	distance: number;
	shortSha: string;
	release: any;
}

/**
 * List ark-* releases in positron-ark sorted descending by (version, distance).
 * Caps at the most recent 100 releases.
 */
async function listArkReleases(githubPat: string | undefined): Promise<ParsedRelease[]> {
	const headers = buildHeaders(githubPat);
	const response = await httpsGetAsync({
		headers,
		method: 'GET',
		protocol: 'https:',
		hostname: 'api.github.com',
		path: `/repos/${PREBUILD_OWNER}/${PREBUILD_REPO}/releases?per_page=100`
	} as https.RequestOptions);
	const buf = await readResponseBody(response);
	if (response.statusCode !== 200) {
		throw new Error(
			`Failed to list positron-ark releases: HTTP ${response.statusCode}\n\n` +
			buf.toString('utf-8'));
	}
	const releases = JSON.parse(buf.toString('utf-8')) as any[];
	const parsed: ParsedRelease[] = [];
	for (const release of releases) {
		const tag: string = release.tag_name || '';
		const m = tag.match(/^ark-([0-9.]+)-([0-9]+)-([0-9a-f]{7})$/);
		if (m) {
			parsed.push({ tag, version: m[1], distance: parseInt(m[2], 10), shortSha: m[3], release });
		}
	}
	parsed.sort((a, b) => compareVersionDistance(b, a));
	return parsed;
}

/**
 * Compare (version, distance) tuples. Returns negative if a < b, 0 if equal,
 * positive if a > b.
 */
function compareVersionDistance(
	a: { version: string; distance: number },
	b: { version: string; distance: number }
): number {
	const av = a.version.split('.').map(n => parseInt(n, 10));
	const bv = b.version.split('.').map(n => parseInt(n, 10));
	for (let i = 0; i < Math.max(av.length, bv.length); i++) {
		const diff = (av[i] || 0) - (bv[i] || 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return a.distance - b.distance;
}

/**
 * Download the platform asset(s) from the given release and extract into
 * the runtime location. Updates the marker file with `markerVersion`.
 */
async function extractPrebuildAssets(
	release: any,
	targets: ArkAssetTarget[],
	githubPat: string | undefined,
	tagForFilename: string,
	markerVersion: string
): Promise<void> {
	const assetHeaders = buildHeaders(githubPat);
	assetHeaders.Accept = 'application/octet-stream';

	await fs.promises.mkdir(RUNTIME_DIR, { recursive: true });

	// On Windows, scrub a top-level ark.exe that previous installs may have left.
	if (platform() === 'win32') {
		const legacy = path.join(RUNTIME_DIR, 'ark.exe');
		if (await existsAsync(legacy)) {
			await fs.promises.unlink(legacy);
		}
	}

	// Asset filenames embed the version-distance-shortSha, e.g.
	// `ark-0.1.251-10-abc1234-darwin-universal.zip`. We strip the `ark-`
	// prefix so the same string works for both the tag and the filename body.
	const assetVersion = tagForFilename.replace(/^ark-/, '');

	for (const target of targets) {
		const assetName = `ark-${assetVersion}-${target.assetSuffix}.zip`;
		const asset = release.assets?.find((a: any) => a.name === assetName);
		if (!asset) {
			throw new Error(`Asset ${assetName} not found in release ${release.tag_name}.`);
		}
		console.log(`Downloading ${assetName} (${target.label}) from ${asset.url}...`);
		const data = await downloadReleaseAsset(asset.url, assetHeaders);
		if (data.length < 1024) {
			throw new Error(`Asset ${assetName} is suspiciously small (${data.length} bytes).`);
		}

		const targetDir = target.subdirectory ? path.join(RUNTIME_DIR, target.subdirectory) : RUNTIME_DIR;
		if (target.subdirectory) {
			await fs.promises.rm(targetDir, { recursive: true, force: true });
		}
		await fs.promises.mkdir(targetDir, { recursive: true });

		const zipDest = path.join(targetDir, '__ark_download.zip');
		await writeFileAsync(zipDest, data);
		await decompress(zipDest, targetDir);
		await fs.promises.unlink(zipDest);
		console.log(`Installed ${assetName} into ${targetDir}.`);
	}

	await writeFileAsync(MARKER_FILE, markerVersion);
}

/**
 * Try to download the exact prebuild matching `info.releaseTag`.
 */
async function tryDownloadExactPrebuild(
	info: ArkBuildInfo,
	targets: ArkAssetTarget[],
	githubPat: string | undefined
): Promise<boolean> {
	console.log(`Looking for prebuild ${info.releaseTag} in posit-dev/${PREBUILD_REPO}...`);
	const release = await fetchReleaseByTag(info.releaseTag, githubPat);
	if (!release) {
		console.log(`Prebuild ${info.releaseTag} not found.`);
		return false;
	}
	await extractPrebuildAssets(release, targets, githubPat, info.releaseTag, info.buildVersion);
	return true;
}

/**
 * Try to download the most recent earlier prebuild as a fallback. Prints a
 * stderr note explaining what we used and how stale it is.
 */
async function tryDownloadFallbackPrebuild(
	info: ArkBuildInfo,
	targets: ArkAssetTarget[],
	githubPat: string | undefined
): Promise<boolean> {
	console.log(`Searching for an earlier prebuild in posit-dev/${PREBUILD_REPO}...`);
	const all = await listArkReleases(githubPat);
	const target = { version: info.version, distance: info.distance };
	const fallback = all.find(r => compareVersionDistance(r, target) <= 0);
	if (!fallback) {
		console.log('No earlier prebuilds available.');
		return false;
	}
	const fallbackBuildVersion = `${fallback.version}+${fallback.distance}.${fallback.shortSha}`;
	console.warn(
		`\nNote: prebuild for ${info.releaseTag} is not yet available in ` +
		`posit-dev/${PREBUILD_REPO}.\n` +
		`Using ${fallback.tag} instead (${describeBehind(fallback, target)}).\n`);
	await extractPrebuildAssets(fallback.release, targets, githubPat, fallback.tag, fallbackBuildVersion);
	return true;
}

function describeBehind(
	fallback: { version: string; distance: number },
	target: { version: string; distance: number }
): string {
	if (fallback.version === target.version) {
		return `${target.distance - fallback.distance} commits behind submodule HEAD`;
	}
	return `older release ${fallback.version}+${fallback.distance}, target was ${target.version}+${target.distance}`;
}

/**
 * Try `cargo build --release` in the submodule. Requires rust to be installed.
 */
async function tryCargoBuild(info: ArkBuildInfo): Promise<boolean> {
	const which = platform() === 'win32' ? 'where cargo' : 'which cargo';
	try {
		await execShort(which);
	} catch {
		console.log('cargo not found on PATH; cannot build from source.');
		return false;
	}

	console.log(`Building Ark from source in ${SUBMODULE_DIR}/ (this may take a few minutes)...`);
	const env = { ...process.env, ARK_BUILD_VERSION: info.buildVersion };
	await runStreaming('cargo', ['build', '--release'], SUBMODULE_DIR, env);

	const kernelName = platform() === 'win32' ? 'ark.exe' : 'ark';
	const builtBinary = path.join(SUBMODULE_DIR, 'target', 'release', kernelName);
	if (!fs.existsSync(builtBinary)) {
		throw new Error(`Built ark binary not found at ${builtBinary} after cargo build.`);
	}

	await fs.promises.mkdir(RUNTIME_DIR, { recursive: true });
	if (platform() === 'win32') {
		const subdir = process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
		const targetDir = path.join(RUNTIME_DIR, subdir);
		await fs.promises.mkdir(targetDir, { recursive: true });
		await fs.promises.copyFile(builtBinary, path.join(targetDir, kernelName));
	} else {
		await fs.promises.copyFile(builtBinary, path.join(RUNTIME_DIR, kernelName));
	}
	// Don't write the marker — `tryUseLocalBuild` will pick up the same binary
	// on the next run via existence in the submodule.
	return true;
}

class InstallError extends Error {
	constructor(info: ArkBuildInfo, inCi: boolean) {
		const triedFallback = inCi
			? `  (Fallback prebuilds are intentionally not used in CI.)`
			: `  - the most recent earlier ark-* release — not found, or download failed`;
		super([
			`Failed to install Ark.`,
			``,
			`Tried these prebuild releases in posit-dev/${PREBUILD_REPO}:`,
			`  - ${info.releaseTag} (exact match for the submodule SHA) — not found`,
			triedFallback,
			``,
			`Then attempted to build from source via cargo. That also failed or cargo was not on PATH.`,
			``,
			`To fix:`,
			`  - Install Rust via https://rustup.rs and re-run \`npm install\`, OR`,
			`  - Verify network access to https://api.github.com and https://github.com, OR`,
			`  - Trigger the prebuild workflow manually for the current submodule SHA:`,
			`      https://github.com/posit-dev/${PREBUILD_REPO}/actions/workflows/build-ark.yml`,
		].join('\n'));
		this.name = 'InstallError';
	}
}

async function main(): Promise<void> {
	const info = await readSubmoduleBuildInfo();
	console.log(`Ark submodule: version ${info.version}, distance ${info.distance} (${info.releaseTag})`);

	// Record the submodule commit next to the binary so Positron can detect a
	// stale Ark at runtime, including in release bundles that ship no git
	// submodule. Written up front so every resolution path below — including the
	// early-return local-build and cached-prebuild paths — leaves it in place.
	await writeSubmoduleCommitMarker(info);

	// Respect npm_config_arch when cross-building (e.g. building x64 on arm64 macOS).
	const targetArch = (process.env.npm_config_arch as NodeArch | undefined) || arch();
	const targets = getDownloadTargets(platform() as NodeJS.Platform, targetArch);

	// In CI we require correctness: if the exact prebuild is missing, build
	// from source. If that also fails, fail hard rather than silently using a
	// stale fallback prebuild — a PR that bumps the ark submodule must
	// actually test against the new ark.
	// Most CI providers set `CI=true`; some use `CI=1`. Treat any non-empty,
	// non-"false", non-"0" value as "in CI".
	const ciVar = process.env.CI;
	const inCi = ciVar !== undefined && ciVar !== '' && ciVar.toLowerCase() !== 'false' && ciVar !== '0';

	// 1. Local cargo build in the submodule wins.
	if (await tryUseLocalBuild()) {
		return;
	}

	// 2. Already-installed prebuild matches.
	if (await isCachedPrebuildCurrent(info)) {
		console.log(`Already-installed prebuild matches ${info.buildVersion}; nothing to do.`);
		return;
	}

	const githubPat = await findGithubPat();

	// 3. Exact prebuild.
	try {
		if (await tryDownloadExactPrebuild(info, targets, githubPat)) {
			return;
		}
	} catch (err) {
		console.warn(`Could not download exact prebuild: ${err}`);
	}

	// 4. Build from source (both CI and dev). On a dev machine this is
	// preferred over the older-prebuild fallback: a developer with rust
	// installed should get exactly the ark their submodule points at, not a
	// stale prebuild.
	try {
		if (await tryCargoBuild(info)) {
			return;
		}
	} catch (err) {
		console.warn(`cargo build failed: ${err}`);
	}

	// In CI we stop here: never fall back to a stale prebuild. A PR that bumps
	// the ark submodule must actually test against the new ark.
	if (inCi) {
		throw new InstallError(info, inCi);
	}

	// 5. Fallback to most recent earlier prebuild (local dev only, last resort).
	// Reached only when there's no exact prebuild and rust isn't installed.
	try {
		if (await tryDownloadFallbackPrebuild(info, targets, githubPat)) {
			return;
		}
	} catch (err) {
		console.warn(`Could not download fallback prebuild: ${err}`);
	}

	// 6. Helpful error.
	throw new InstallError(info, inCi);
}

main().catch((error) => {
	// Fail loudly so npm install fails here rather than letting a later step
	// produce a confusing "Unable to find R kernel" error at runtime.
	console.error('Failed to install Ark kernel:');
	console.error(error?.message ?? error);
	process.exit(1);
});
