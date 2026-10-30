/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A build of main for the explorer to replay its findings on: the published
// daily, one download and no compile. Whether a finding happens on main is
// what decides its Origin.
//
// Usage:
//   node main-build.mjs fetch --out <dir> [--platform mac/arm64|deb/x86_64]
//     downloads the latest daily for the platform (default: this machine's),
//     checks its sha256 against the feed, extracts it into <dir>, writes
//     <dir>/main-build.json and prints it. Exits 1 with the reason on any
//     failure; a run without a main build is still a run.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const FEED = 'https://cdn.posit.co/positron/dailies';
// Where each platform's download keeps the executable, relative to the extract.
const BINARY = {
	'mac/arm64': join('Positron.app', 'Contents', 'MacOS', 'Positron'),
	'deb/x86_64': join('usr', 'share', 'positron', 'positron'),
};
// The launcher beside this renderer, which has --app. In CI the renderer comes
// from the harness while the helpers come from the branch under test, which
// may predate --app.
const LAUNCH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drive-positron', 'scripts', 'launch.sh');

/**
 * @typedef {{ version: string, commit: string, pubDate: string, platform: string, binary: string }} MainBuild
 */

/** The feed platform for this machine, or null when there is no daily for it. */
export function platformFor(os = process.platform, arch = process.arch) {
	if (os === 'darwin' && arch === 'arm64') {
		return 'mac/arm64';
	}
	if (os === 'linux' && arch === 'x64') {
		return 'deb/x86_64';
	}
	return null;
}

/** Unpacks a downloaded daily into `dir`: a mac .zip or a Linux .deb. */
function defaultExtract(file, dir) {
	if (file.endsWith('.zip')) {
		execFileSync('unzip', ['-q', '-o', file, '-d', dir], { stdio: 'inherit' });
	} else if (file.endsWith('.deb')) {
		execFileSync('dpkg-deb', ['-x', file, dir], { stdio: 'inherit' });
	} else {
		throw new Error(`no way to extract ${basename(file)}`);
	}
}

/**
 * Downloads the latest daily for `platform` into `outDir`, checks it against
 * the feed's sha256, extracts it, and writes `main-build.json` there.
 * @returns {Promise<MainBuild>}
 */
export async function fetchDaily({ platform, outDir, fetchImpl = fetch, extract = defaultExtract }) {
	if (!BINARY[platform]) {
		throw new Error(`no daily for platform ${platform}`);
	}
	const feedRes = await fetchImpl(`${FEED}/${platform}/releases.json`);
	if (!feedRes.ok) {
		throw new Error(`feed answered ${feedRes.status}`);
	}
	const feed = await feedRes.json();
	for (const key of ['version', 'url', 'commit', 'sha256hash']) {
		if (typeof feed[key] !== 'string' || !feed[key]) {
			throw new Error(`feed has no ${key}`);
		}
	}
	const res = await fetchImpl(feed.url);
	if (!res.ok) {
		throw new Error(`download answered ${res.status}`);
	}
	// Streamed to disk and hashed on the way: the daily is a few hundred MB, and
	// in CI it downloads beside the PR's compile.
	mkdirSync(outDir, { recursive: true });
	const file = join(outDir, basename(new URL(feed.url).pathname));
	const sha = createHash('sha256');
	const out = createWriteStream(file);
	try {
		for await (const chunk of res.body) {
			sha.update(chunk);
			if (!out.write(chunk)) {
				await once(out, 'drain');
			}
		}
		out.end();
		await once(out, 'finish');
	} catch (err) {
		out.destroy();
		rmSync(file, { force: true });
		throw err;
	}
	const hash = sha.digest('hex');
	if (hash !== feed.sha256hash.toLowerCase()) {
		rmSync(file, { force: true });
		throw new Error(`sha256 mismatch: the feed says ${feed.sha256hash}, the download is ${hash}`);
	}
	extract(file, outDir);
	rmSync(file, { force: true });
	const binary = join(resolve(outDir), BINARY[platform]);
	if (!isExecutable(binary)) {
		throw new Error(`no executable at ${binary} after extracting`);
	}
	const build = { version: feed.version, commit: feed.commit, pubDate: feed.pub_date ?? '', platform, binary };
	writeFileSync(join(outDir, 'main-build.json'), `${JSON.stringify(build, null, 2)}\n`);
	return build;
}

/**
 * The latest daily for `platform`, kept in `cacheDir/<version>`: downloaded
 * once, reused by later runs, and replaced when a newer one is published.
 * Only the newest is kept.
 * @returns {Promise<MainBuild>}
 */
export async function cachedDaily({ platform, cacheDir, fetchImpl = fetch, extract = defaultExtract }) {
	const res = await fetchImpl(`${FEED}/${platform}/releases.json`);
	if (!res.ok) {
		throw new Error(`feed answered ${res.status}`);
	}
	const { version } = await res.json();
	if (typeof version !== 'string' || !/^[\w.-]+$/.test(version)) {
		throw new Error('feed has no usable version');
	}
	const dir = join(cacheDir, version);
	const build = readMainBuild(join(dir, 'main-build.json')) ?? await fetchDaily({ platform, outDir: dir, fetchImpl, extract });
	for (const old of readdirSync(cacheDir).filter(name => name !== version)) {
		rmSync(join(cacheDir, old), { recursive: true, force: true });
	}
	return build;
}

/**
 * The main build for a local run, or null with the reason logged: the one in
 * `given` when a directory was named, none when `skip`, else the cached daily
 * for this machine. A run without one still runs; its findings get no Origin.
 */
export async function localMainBuild({ given, skip = false, platform = platformFor(), cacheDir, fetch: fetchBuild = cachedDaily, log = () => { } }) {
	if (skip) {
		return null;
	}
	if (given) {
		return readMainBuild(join(given, 'main-build.json'));
	}
	if (!platform) {
		log(`no daily build of main for this platform (${process.platform}/${process.arch}); exploring without one, so no finding gets an Origin`);
		return null;
	}
	try {
		mkdirSync(cacheDir, { recursive: true });
		return await fetchBuild({ platform, cacheDir });
	} catch (err) {
		log(`could not fetch a daily build of main: ${err.message}; exploring without one, so no finding gets an Origin`);
		return null;
	}
}

function isExecutable(path) {
	try {
		accessSync(path, constants.X_OK);
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/** The main build described in `path`, or null when it is missing, unreadable, or its binary cannot run. */
export function readMainBuild(path) {
	let build;
	try {
		build = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
	if (!build || typeof build.commit !== 'string' || typeof build.binary !== 'string' || !isExecutable(build.binary)) {
		return null;
	}
	return build;
}

/**
 * Whether the checkout has main's commit, fetching it when it does not. The
 * `needs` lookup and the drift check both read it, and a failed lookup must
 * not pass for a missing ID.
 */
export function ensureCommit(repo, commit) {
	const has = () => {
		try {
			execFileSync('git', ['-C', repo, 'cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' });
			return true;
		} catch {
			return false;
		}
	};
	if (has()) {
		return true;
	}
	try {
		execFileSync('git', ['-C', repo, 'fetch', '--no-tags', '--depth=1', 'origin', commit], { stdio: 'ignore', timeout: 120_000 });
	} catch {
		return false;
	}
	return has();
}

/**
 * The brief's section that hands the explorer the main build. `appArgs` are the
 * app arguments the PR instance was launched with, when the run knows them
 * (CI); otherwise the explorer reuses its own.
 */
export function mainBuildBrief(build, { repo, base, appArgs = '' }) {
	return [
		'## Main build',
		'',
		'A packaged build of main is ready for the main replay of each finding (see "On main" in your instructions).',
		'',
		`- Version ${build.version}, built from main at \`${build.commit}\`${build.pubDate ? ` (published ${build.pubDate})` : ''}. The base of this change is \`${base}\`; the daily is main as of its build, not the base.`,
		`- Binary: \`${build.binary}\``,
		appArgs
			? `- Launch: \`${LAUNCH} --app ${build.binary} -- ${appArgs}\`, with the same launcher flags (before the \`--\`) as your PR instance.`
			: `- Launch: \`${LAUNCH} --app ${build.binary}\`, followed by the same launcher flags and app arguments as your PR instance.`,
		`- Whether main has a \`needs\` ID: \`git -C ${repo} grep -q <id> ${build.commit} -- src extensions\` (exit 0: main has it; exit 1: main lacks it; any other exit: the lookup failed, so record \`couldNotRun\`).`,
	].join('\n');
}

async function main() {
	const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, platform: { type: 'string' } } });
	if (positionals[0] !== 'fetch' || !values.out) {
		console.error('usage: node main-build.mjs fetch --out <dir> [--platform mac/arm64|deb/x86_64]');
		process.exit(2);
	}
	const platform = values.platform ?? platformFor();
	if (!platform) {
		console.error(`main-build: no daily for ${process.platform}/${process.arch}`);
		process.exit(1);
	}
	try {
		console.log(JSON.stringify(await fetchDaily({ platform, outDir: values.out })));
	} catch (err) {
		console.error(`main-build: ${err.message}`);
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
