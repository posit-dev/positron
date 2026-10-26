/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Fetches the past week's findings from earlier runs of this workflow into
// <dir>/recent/<run id>/, for the finder's area pick and the fixer's brief,
// and whether each product issue they name is still open, into
// <dir>/recent/issues.json.
//
//   node .claude/skills/drive-positron/heal/recent.ts --dir /tmp/heal [--days 7]
//
// Needs GH_TOKEN, GITHUB_API_URL, GITHUB_REPOSITORY and GITHUB_RUN_ID (Actions
// sets all but the token). Uses fetch and python3's zipfile, since gh may not
// be in the image. Best effort: a run it cannot read is skipped, and it always
// exits 0 once its arguments parse.

import { spawnSync } from 'child_process';
import { mkdirSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { flagValue, unknownArg } from '../test/smoke-lib.ts';
import { readFindings, type Finding } from './finding.ts';

const WORKFLOW = 'drive-positron-nightly.yml';
const ARTIFACT = 'drive-positron-heal';

function isMain(): boolean {
	try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

/** The first directory named `findings` under root, breadth first. */
function findingsDir(root: string): string | null {
	const queue = [root];
	while (queue.length) {
		const d = queue.shift()!;
		for (const e of readdirSync(d, { withFileTypes: true })) {
			if (!e.isDirectory()) { continue; }
			if (e.name === 'findings') { return join(d, e.name); }
			queue.push(join(d, e.name));
		}
	}
	return null;
}

/** The nightly's completed runs since `since`; only main's, so a branch test run never becomes a later night's history. */
export function runsUrl(api: string, repo: string, workflow: string, since: string): string {
	return `${api}/repos/${repo}/actions/workflows/${workflow}/runs?branch=main&status=completed&created=%3E%3D${since}&per_page=50`;
}

/** The issues earlier product findings were filed as, each once, in order. */
export function issuesIn(runs: Finding[][]): number[] {
	return [...new Set(runs.flat().flatMap(f => f.outcome === 'product' && f.issue ? [f.issue] : []))].sort((a, b) => a - b);
}

async function main(): Promise<number> {
	const own = process.argv.slice(2);
	const bad = unknownArg(own, ['--dir', '--days']);
	if (bad !== null) { console.log(`recent: unknown argument ${JSON.stringify(bad)}`); return 2; }
	const dir = flagValue(own, '--dir');
	const days = flagValue(own, '--days');
	if (dir instanceof Error || days instanceof Error) { console.log(`recent: ${(dir instanceof Error ? dir : days as Error).message}`); return 2; }
	if (days !== null && !/^[1-9]\d*$/.test(days)) { console.log('recent: --days must be a positive integer'); return 2; }
	const { GH_TOKEN: token, GITHUB_API_URL: api = 'https://api.github.com', GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: self } = process.env;
	const out = join(dir ?? '/tmp/heal', 'recent');
	mkdirSync(out, { recursive: true });
	if (!token || !repo) { console.log('recent: GH_TOKEN or GITHUB_REPOSITORY is not set; no earlier findings'); return 0; }
	const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
	const get = async (url: string) => {
		const r = await fetch(url, { headers });
		if (!r.ok) { throw new Error(`${r.status} ${url}`); }
		return r;
	};

	const since = new Date(Date.now() - Number(days ?? '7') * 86400000).toISOString().slice(0, 10);
	let runs: { id: number }[];
	try {
		runs = (await (await get(runsUrl(api, repo, WORKFLOW, since))).json()).workflow_runs ?? [];
	} catch (e) {
		console.log(`recent: listing runs failed (${e instanceof Error ? e.message : e}); no earlier findings`);
		return 0;
	}
	let got = 0;
	for (const { id } of runs.filter(r => String(r.id) !== self)) {
		const tmp = join(out, `.dl-${id}`);
		try {
			const arts = (await (await get(`${api}/repos/${repo}/actions/runs/${id}/artifacts?name=${ARTIFACT}`)).json()).artifacts ?? [];
			const art = arts.find((a: { expired: boolean }) => !a.expired);
			if (!art) { continue; }
			mkdirSync(tmp, { recursive: true });
			const zip = join(tmp, 'a.zip');
			writeFileSync(zip, Buffer.from(await (await get(art.archive_download_url)).arrayBuffer()));
			const unz = spawnSync('python3', ['-m', 'zipfile', '-e', zip, join(tmp, 'x')], { encoding: 'utf8' });
			if (unz.status !== 0) { throw new Error(`unzip: ${(unz.stderr || unz.error?.message || '').trim()}`); }
			const f = findingsDir(join(tmp, 'x'));
			if (f) { rmSync(join(out, String(id)), { recursive: true, force: true }); renameSync(f, join(out, String(id))); got++; }
		} catch (e) {
			console.log(`recent: run ${id} skipped (${e instanceof Error ? e.message : e})`);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	}
	console.log(`recent: findings from ${got} of ${runs.length} run(s) since ${since}`);
	const states: Record<number, string> = {};
	const runDirs = readdirSync(out, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.'));
	for (const n of issuesIn(runDirs.map(d => readFindings(join(out, d.name))))) {
		try { states[n] = (await (await get(`${api}/repos/${repo}/issues/${n}`)).json()).state; } catch (e) { console.log(`recent: issue ${n} skipped (${e instanceof Error ? e.message : e})`); }
	}
	writeFileSync(join(out, 'issues.json'), `${JSON.stringify(states, null, '\t')}\n`);
	return 0;
}

if (isMain()) {
	main().then(c => { process.exitCode = c; }, e => { console.log(`recent: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 0; });
}
