/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Reads the helper failures from the past week's exploratory runs into
// <dir>/leads.json, for the finder to reproduce first. Those runs reach the
// features PRs change, which smoke and the finder's own areas do not cover.
//
//   node .claude/skills/drive-positron/heal/leads.ts --dir /tmp/heal [--days 7]
//
// Needs GH_TOKEN and GITHUB_REPOSITORY (Actions sets the second). Uses fetch
// and python3's zipfile, as recent.ts does. Best effort: a run it cannot read
// is skipped, and it always exits 0 once its arguments parse.

import { spawnSync } from 'child_process';
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { flagValue, unknownArg } from '../test/smoke-lib.ts';
import { failures, groupLeads, type Failure } from './leads-lib.ts';

const WORKFLOW = 'test-exploratory.yml';
const ARTIFACT = 'exploratory-run-';

function isMain(): boolean {
	try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

/** Every actions.log under root. */
function logsUnder(root: string): string[] {
	return readdirSync(root, { withFileTypes: true, recursive: true })
		.filter(e => e.isFile() && e.name === 'actions.log').map(e => join(e.parentPath, e.name));
}

async function main(): Promise<number> {
	const own = process.argv.slice(2);
	const bad = unknownArg(own, ['--dir', '--days']);
	if (bad !== null) { console.log(`leads: unknown argument ${JSON.stringify(bad)}`); return 2; }
	const dir = flagValue(own, '--dir');
	const days = flagValue(own, '--days');
	if (dir instanceof Error || days instanceof Error) { console.log(`leads: ${(dir instanceof Error ? dir : days as Error).message}`); return 2; }
	if (days !== null && !/^[1-9]\d*$/.test(days)) { console.log('leads: --days must be a positive integer'); return 2; }
	const out = dir ?? '/tmp/heal';
	mkdirSync(out, { recursive: true });
	const { GH_TOKEN: token, GITHUB_API_URL: api = 'https://api.github.com', GITHUB_SERVER_URL: server = 'https://github.com', GITHUB_REPOSITORY: repo } = process.env;
	const write = (byRun: { run: string; failures: Failure[] }[], since: string) =>
		writeFileSync(join(out, 'leads.json'), `${JSON.stringify({ since, runs: byRun.length, leads: groupLeads(byRun) }, null, '\t')}\n`);
	const since = new Date(Date.now() - Number(days ?? '7') * 86400000).toISOString().slice(0, 10);
	if (!token || !repo) { console.log('leads: GH_TOKEN or GITHUB_REPOSITORY is not set; no leads'); write([], since); return 0; }
	const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
	const get = async (url: string) => {
		const r = await fetch(url, { headers });
		if (!r.ok) { throw new Error(`${r.status} ${url}`); }
		return r;
	};

	// Any branch: a PR's run is where its new feature is reached. Most of the
	// workflow's runs are comments it skips, so ask for the two that ran.
	const runs: { id: number }[] = [];
	for (const status of ['success', 'failure']) {
		try {
			const url = `${api}/repos/${repo}/actions/workflows/${WORKFLOW}/runs?status=${status}&created=%3E%3D${since}&per_page=100`;
			runs.push(...(await (await get(url)).json()).workflow_runs ?? []);
		} catch (e) {
			console.log(`leads: listing ${status} runs failed (${e instanceof Error ? e.message : e})`);
		}
	}
	const byRun: { run: string; failures: Failure[] }[] = [];
	for (const { id } of runs) {
		const tmp = join(out, `.leads-${id}`);
		try {
			const arts = (await (await get(`${api}/repos/${repo}/actions/runs/${id}/artifacts?per_page=100`)).json()).artifacts ?? [];
			const mine = arts.filter((a: { name: string; expired: boolean }) => a.name.startsWith(ARTIFACT) && !a.expired);
			const found: Failure[] = [];
			for (const art of mine) {
				mkdirSync(tmp, { recursive: true });
				const zip = join(tmp, 'a.zip');
				writeFileSync(zip, Buffer.from(await (await get(art.archive_download_url)).arrayBuffer()));
				const unz = spawnSync('python3', ['-m', 'zipfile', '-e', zip, join(tmp, 'x')], { encoding: 'utf8' });
				if (unz.status !== 0) { throw new Error(`unzip: ${(unz.stderr || unz.error?.message || '').trim()}`); }
				for (const log of logsUnder(join(tmp, 'x'))) { found.push(...failures(readFileSync(log, 'utf8'))); }
				rmSync(tmp, { recursive: true, force: true });
			}
			if (mine.length) { byRun.push({ run: `${server}/${repo}/actions/runs/${id}`, failures: found }); }
		} catch (e) {
			console.log(`leads: run ${id} skipped (${e instanceof Error ? e.message : e})`);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	}
	write(byRun, since);
	const n = byRun.reduce((s, r) => s + r.failures.length, 0);
	console.log(`leads: ${n} helper failure(s) in ${byRun.length} exploratory run(s) since ${since}`);
	return 0;
}

if (isMain()) {
	main().then(c => { process.exitCode = c; }, e => { console.log(`leads: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 0; });
}
