/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ensureCommit, fetchDaily, mainBuildBrief, platformFor, readMainBuild } from './main-build.mjs';
import { withTmpDir } from './shared/tmp-dirs.mjs';

const BODY = Buffer.from('zip');
const sha = buf => createHash('sha256').update(buf).digest('hex');

/** A fetch that serves the feed for `platform` and the download body. */
function fakeFetch(hash) {
	return async url => {
		if (url.endsWith('/releases.json')) {
			return new Response(JSON.stringify({
				version: '2026.11.0-236',
				pub_date: '2026-10-30 13:52:00 UTC',
				url: 'https://cdn.posit.co/positron/dailies/mac/arm64/Positron-darwin-2026.11.0-236-arm64.zip',
				commit: '57b03d33f537a868e49c48c7acd0c59d84f9b453',
				sha256hash: hash,
			}));
		}
		return new Response(BODY);
	};
}

/** An extract that lays out a mac app with an executable binary. */
function fakeExtract(file, dir) {
	const bin = join(dir, 'Positron.app', 'Contents', 'MacOS');
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, 'Positron'), '#!/bin/sh\n');
	chmodSync(join(bin, 'Positron'), 0o755);
}

test('platformFor maps the two supported platforms', () => {
	assert.equal(platformFor('darwin', 'arm64'), 'mac/arm64');
	assert.equal(platformFor('linux', 'x64'), 'deb/x86_64');
	assert.equal(platformFor('win32', 'x64'), null);
});

test('fetchDaily rejects a hash mismatch', () => withTmpDir('main-build-', async dir => {
	await assert.rejects(
		fetchDaily({ platform: 'mac/arm64', outDir: dir, fetchImpl: fakeFetch('0'.repeat(64)), extract: fakeExtract }),
		/sha256 mismatch/,
	);
	assert.equal(existsSync(join(dir, 'main-build.json')), false);
}));

test('fetchDaily writes main-build.json', () => withTmpDir('main-build-', async dir => {
	const build = await fetchDaily({ platform: 'mac/arm64', outDir: dir, fetchImpl: fakeFetch(sha(BODY)), extract: fakeExtract });
	assert.deepEqual(JSON.parse(readFileSync(join(dir, 'main-build.json'), 'utf8')), build);
	assert.equal(build.commit, '57b03d33f537a868e49c48c7acd0c59d84f9b453');
	assert.equal(build.version, '2026.11.0-236');
	assert.equal(build.platform, 'mac/arm64');
	assert.equal(build.binary, join(dir, 'Positron.app', 'Contents', 'MacOS', 'Positron'));
	assert.equal(existsSync(join(dir, 'Positron-darwin-2026.11.0-236-arm64.zip')), false, 'the download is removed once extracted');
}));

test('readMainBuild returns null for a missing file and for a non-executable binary', () => withTmpDir('main-build-', dir => {
	assert.equal(readMainBuild(join(dir, 'main-build.json')), null);
	const binary = join(dir, 'Positron');
	writeFileSync(binary, '');
	chmodSync(binary, 0o644);
	writeFileSync(join(dir, 'main-build.json'), JSON.stringify({ version: 'v', commit: 'c', pubDate: 'd', platform: 'mac/arm64', binary }));
	assert.equal(readMainBuild(join(dir, 'main-build.json')), null);
	chmodSync(binary, 0o755);
	assert.equal(readMainBuild(join(dir, 'main-build.json'))?.binary, binary);
}));

test('mainBuildBrief names the binary, commit and launch command', () => {
	const brief = mainBuildBrief(
		{ version: '2026.11.0-236', commit: '57b03d33f537a868e49c48c7acd0c59d84f9b453', pubDate: '2026-10-30 13:52:00 UTC', platform: 'mac/arm64', binary: '/tmp/main/Positron.app/Contents/MacOS/Positron' },
		{ repo: '/repo', base: 'abc123' },
	);
	assert.match(brief, /^## Main build/m);
	assert.ok(brief.includes('/tmp/main/Positron.app/Contents/MacOS/Positron'));
	assert.ok(brief.includes('launch.sh --app /tmp/main/Positron.app/Contents/MacOS/Positron'));
	// The launcher beside this renderer, which has --app, not the one on a branch that may predate it.
	const launcher = /`(\S+launch\.sh) --app /.exec(brief)?.[1];
	assert.ok(launcher && isAbsolute(launcher) && existsSync(launcher), launcher);
	assert.ok(readFileSync(launcher, 'utf8').includes('--app)'));
	assert.ok(brief.includes('57b03d33f537a868e49c48c7acd0c59d84f9b453'));
	assert.ok(brief.includes('2026.11.0-236'));
	assert.ok(brief.includes('git -C /repo grep -q <id> 57b03d33f537a868e49c48c7acd0c59d84f9b453 -- src extensions'));
});

test('mainBuildBrief says a failed lookup is not a missing ID', () => {
	const brief = mainBuildBrief({ version: 'v', commit: 'c'.repeat(40), pubDate: '', platform: 'mac/arm64', binary: '/b' }, { repo: '/repo', base: 'abc' });
	assert.match(brief, /exit 0: main has it; exit 1: main lacks it; any other exit: the lookup failed, so record `couldNotRun`/);
});

test('mainBuildBrief gives the app arguments when the run knows them', () => {
	const build = { version: 'v', commit: 'c'.repeat(40), pubDate: '', platform: 'deb/x86_64', binary: '/b' };
	assert.match(mainBuildBrief(build, { repo: '/r', base: 'a', appArgs: '--no-sandbox --log debug' }), /--app \/b -- --no-sandbox --log debug`/);
	assert.match(mainBuildBrief(build, { repo: '/r', base: 'a' }), /the same launcher flags and app arguments as your PR instance/);
});

test('ensureCommit is true for a commit the checkout has, and false for one it cannot fetch', () => withTmpDir('main-commit-', dir => {
	const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
	git('init', '-q');
	git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one');
	assert.equal(ensureCommit(dir, git('rev-parse', 'HEAD')), true);
	assert.equal(ensureCommit(dir, 'f'.repeat(40)), false);
}));
