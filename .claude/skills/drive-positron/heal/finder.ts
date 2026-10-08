/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The finder: one read-only agent session that reproduces the leads from
// exploratory runs (leads.ts), then explores one area of the helpers.
//
//   node .claude/skills/drive-positron/heal/finder.ts --dir /tmp/heal --runner PATH/session-cli.mjs [--minutes 45] [--leads-only] [-- APP ARGS...]
//
// Launches its own instance (session heal-find), picks the area, runs the
// session, keeps the findings that validate, and stops the instance.
// --leads-only skips the area, for nights that are not explore nights.

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { launchFixture, readFixtureState, stopFixture, type App } from '../test/fixture-app.ts';
import { flagValue, unknownArg } from '../test/smoke-lib.ts';
import { readFindings, validateFinding } from './finding.ts';
import { isoWeek, pickArea, type Area } from './finder-lib.ts';
import { formatLeads, type Lead } from './leads-lib.ts';

/** How many leads the brief lists; the rest wait for a night with fewer. */
const MAX_LEADS = 8;

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');

function isMain(): boolean {
	try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

function main(): number {
	const dash = process.argv.indexOf('--');
	const own = process.argv.slice(2, dash < 0 ? undefined : dash);
	const appArgs = dash < 0 ? [] : process.argv.slice(dash + 1);
	const bad = unknownArg(own.filter(a => a !== '--leads-only'), ['--dir', '--runner', '--minutes']);
	if (bad !== null) { console.log(`finder: unknown argument ${JSON.stringify(bad)}`); return 2; }
	const flag = (name: string): string | null => {
		const v = flagValue(own, name);
		if (v instanceof Error) { console.log(`finder: ${v.message}`); process.exit(2); }
		return v;
	};
	const dir = flag('--dir') ?? '/tmp/heal';
	const runner = flag('--runner');
	const minutes = flag('--minutes') ?? '45';
	const leadsOnly = own.includes('--leads-only');
	if (!runner) { console.log('finder: --runner is required'); return 2; }
	if (!/^[1-9]\d*$/.test(minutes)) { console.log('finder: --minutes must be a positive integer'); return 2; }

	const areas = (JSON.parse(readFileSync(join(here, 'areas.json'), 'utf8')) as { areas: Area[] }).areas;
	const recentDir = join(dir, 'recent');
	const recent = existsSync(recentDir) ? readdirSync(recentDir, { withFileTypes: true }).filter(d => d.isDirectory()).flatMap(d => readFindings(join(recentDir, d.name))) : [];
	const { area, why } = pickArea(areas, isoWeek(new Date()), recent);
	const leadsFile = join(dir, 'leads.json');
	const leads = existsSync(leadsFile) ? (JSON.parse(readFileSync(leadsFile, 'utf8')) as { leads: Lead[] }).leads : [];
	if (leadsOnly && !leads.length) { console.log('finder: --leads-only and no leads; nothing to do'); return 0; }
	console.log(`finder: ${Math.min(leads.length, MAX_LEADS)} of ${leads.length} lead(s)${leadsOnly ? ', no area' : `, then area ${area.name} (${why})`}`);

	const scratch = join(dir, 'finder-new');
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	mkdirSync(join(dir, 'cost'), { recursive: true });
	let sessionProblem = '';
	const stateFile = join(dir, 'finder-app.json');
	rmSync(stateFile, { force: true });
	let app: App | null = null;
	try {
		const up = launchFixture({ session: 'heal-find', root: '/tmp/dp-heal-find', appArgs, onStarted: a => {
			app = a;
			writeFileSync(stateFile, JSON.stringify({ cdpPort: a.cdpPort, runDir: a.runDir }));
		} });
		const brief = [
			...(leads.length ? [`Leads (see "Leads from exploratory runs"), most telling first:\n\n${formatLeads(leads, MAX_LEADS)}`] : []),
			...(leadsOnly ? ['No area tonight: stop once the leads are done.'] : [`Area: ${area.name}: ${area.focus}.`, `Helpers: ${area.helpers.join(', ')}.`]),
			`Checkout: ${repo}. Run helpers from there.`,
			`A Positron instance is running on a copy of the smoke fixture and attached as Playwright session \`heal-find\` (CDP port ${up.cdpPort}). Pass \`--session heal-find\` to every helper.`,
			`To start over on a fresh instance: \`node .claude/skills/drive-positron/test/fixture-app.ts stop --session heal-find --root /tmp/dp-heal-find --state ${stateFile}\`, then \`node .claude/skills/drive-positron/test/fixture-app.ts launch --session heal-find --root /tmp/dp-heal-find --state ${stateFile} -- ${appArgs.join(' ')}\`; the new cdpPort is in ${stateFile} and in the JSON it prints.`,
			`Write findings to: ${scratch}`,
		].join('\n\n');
		writeFileSync(join(dir, 'finder-brief.md'), brief);
		const r = spawnSync(process.execPath, [runner, '--prompt-file', join(dir, 'finder-brief.md'), '--system-file', join(here, 'finder.md'),
			'--tools', 'Bash,Read,Glob,Grep', '--model', 'opus', '--max-turns', '200', '--time-limit', minutes,
			'--cwd', repo, '--label', 'finder', '--out', join(dir, 'cost', 'finder-session.json')], { stdio: 'inherit' });
		if (r.error) { sessionProblem = `could not run the session: ${r.error.message}`; }
		else if (r.status !== 0) { sessionProblem = `the session exited ${r.status ?? `on signal ${r.signal}`}`; }
	} finally {
		const current = readFixtureState(stateFile);
		const first = app as App | null;
		if (current instanceof Error) {
			console.log(`finder: ${current.message}; stopping the original instance`);
			if (first) { stopFixture(first); }
		} else if (current && first) {
			if (!stopFixture({ ...first, ...current })) { sessionProblem ||= 'the instance did not stop'; }
			if (first.cdpPort !== current.cdpPort) { stopFixture(first); }
		}
	}

	const rejected: { file: string; problems: string[] }[] = [];
	mkdirSync(join(dir, 'findings'), { recursive: true });
	for (const file of readdirSync(scratch).filter(f => f.endsWith('.json'))) {
		let parsed: { id: string; source: string } | null = null;
		let problems: string[];
		try {
			const raw = JSON.parse(readFileSync(join(scratch, file), 'utf8'));
			problems = validateFinding(raw);
			if (!problems.length) { parsed = raw; }
		} catch (e) { problems = [`not JSON: ${String(e)}`]; }
		if (parsed && (parsed.source !== 'finder' || !parsed.id.startsWith('finder-'))) { problems.push('a finder finding has source "finder" and an id starting finder-'); }
		if (!parsed || problems.length) { rejected.push({ file, problems }); continue; }
		renameSync(join(scratch, file), join(dir, 'findings', `${parsed.id}.json`));
	}
	writeFileSync(join(dir, 'finder-rejected.json'), `${JSON.stringify(rejected, null, '\t')}\n`);
	console.log(`finder: ${readdirSync(join(dir, 'findings')).filter(f => f.startsWith('finder-')).length} findings, ${rejected.length} rejected`);
	if (sessionProblem) { console.log(`finder: ${sessionProblem}`); return 1; }
	return 0;
}

if (isMain()) {
	try { process.exitCode = main(); } catch (e) { console.log(`finder: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; }
}
