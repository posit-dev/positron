/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// One fixer session per open finding, at most --cap a night. Each "fixed"
// becomes a commit, then check.ts and a full smoke run decide whether it stays.
//
//   node .claude/skills/drive-positron/heal/fix-loop.ts --dir /tmp/heal --runner PATH/session-cli.mjs [--cap 5] [-- APP ARGS...]
//
// Refuses a dirty tree: the loop runs reset --hard and clean. Exit 1 when a
// session failed, the fixer edited outside the skill or committed, or git failed.

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFixtureState, stopFixture } from '../test/fixture-app.ts';
import { flagValue, readResults, unknownArg, type SmokeResults } from '../test/smoke-lib.ts';
import { addFields, readFindings, readState, writeFinding, writeState, type Finding } from './finding.ts';
import { queue, readOutcome, regressions } from './fix-lib.ts';
import { smokeChecksChanged } from './links.ts';
import { cascade } from './rerun-lib.ts';
import { outside, pathsFromStatus, SKILL_PREFIX } from './scope.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');

function isMain(): boolean {
	try { return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}

/** Runs git in the checkout; throws when it fails, so the loop never goes on from a wrong HEAD. */
function git(...a: string[]): string {
	const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
	if (r.error || r.status !== 0) { throw new Error(`git ${a.slice(0, 2).join(' ')} failed: ${r.error?.message ?? (r.stderr || '').trim().split('\n').pop()}`); }
	return r.stdout;
}

const STATUS = ['status', '--porcelain=v1', '-z', '--untracked-files=all'];

function main(): number {
	const dash = process.argv.indexOf('--');
	const own = process.argv.slice(2, dash < 0 ? undefined : dash);
	const appArgs = dash < 0 ? [] : process.argv.slice(dash + 1);
	const bad = unknownArg(own, ['--dir', '--runner', '--cap']);
	if (bad !== null) { console.log(`fix-loop: unknown argument ${JSON.stringify(bad)}`); return 2; }
	const flag = (name: string): string | null => {
		const v = flagValue(own, name);
		if (v instanceof Error) { console.log(`fix-loop: ${v.message}`); process.exit(2); }
		return v;
	};
	const dir = flag('--dir') ?? '/tmp/heal';
	const runner = flag('--runner');
	const capText = flag('--cap') ?? '5';
	if (!runner) { console.log('fix-loop: --runner is required'); return 2; }
	if (!/^[1-9]\d*$/.test(capText)) { console.log('fix-loop: --cap must be a positive integer'); return 2; }
	const cap = Number(capText);
	if (git(...STATUS) !== '') { console.log('fix-loop: the working tree is not clean; the loop resets and cleans it, so commit or stash first'); return 2; }
	if (readState(dir).wholesale) { console.log('fix-loop: smoke broke wholesale; no fixer runs'); writeState(dir, { gate: 'none' }); return 0; }

	const fdir = join(dir, 'findings');
	const stateFile = join(dir, 'fixer-app.json');
	const base = git('rev-parse', 'HEAD').trim();
	let baseline: SmokeResults = readResults(join(dir, 'smoke-1.json'));
	const order = baseline.cases.map(c => c.name);
	let findings = readFindings(fdir);
	const { attempt, notAttempted } = queue(findings, order, cap);
	const save = (f: Finding) => { writeFinding(fdir, f); findings = findings.map(x => x.id === f.id ? f : x); };
	for (const f of notAttempted) { save(addFields(f, { notAttempted: `over the ${cap}-session cap; comes back next night` })); }
	mkdirSync(join(dir, 'cost'), { recursive: true });
	mkdirSync(join(dir, 'checks'), { recursive: true });
	const discard = (to: string, all: boolean) => {
		git('reset', '--hard', to);
		if (all) { git('clean', '-fdq'); } else { git('clean', '-fdq', '--', SKILL_PREFIX); }
	};
	let accepted = 0;
	let n = 0;
	let failed = false;
	let scopeViolation = '';

	for (const queued of attempt) {
		const f = findings.find(x => x.id === queued.id)!;
		if (f.outcome !== undefined) { continue; } // resolved by an earlier fix's cascade
		n++;
		const outFile = join(dir, `outcome-${f.id}.json`);
		rmSync(outFile, { force: true });
		rmSync(stateFile, { force: true });
		writeFileSync(join(dir, 'fixer-brief.md'), [
			'# Finding', '', '```json', JSON.stringify(f, null, 2), '```', '',
			`Checkout: ${repo}`, `App args for fixture-app.ts launch: ${appArgs.join(' ') || '(none)'}`,
			`State file for fixture-app.ts --state: ${stateFile}`, `Outcome path: ${outFile}`,
		].join('\n'));
		const pre = git('rev-parse', 'HEAD').trim();
		const session = spawnSync(process.execPath, [runner, '--prompt-file', join(dir, 'fixer-brief.md'), '--system-file', join(here, 'fixer.md'),
			'--tools', 'Bash,Read,Edit,Write,Glob,Grep', '--model', 'opus', '--max-turns', '150', '--time-limit', '25',
			'--cwd', repo, '--label', `fixer ${f.id}`, '--out', join(dir, 'cost', `fixer-${f.id}.json`)], { stdio: 'inherit' });

		// Stop the fixer's instance before any git or check step; smoke launches its own.
		const app = readFixtureState(stateFile);
		if (app instanceof Error) { console.log(`fix-loop: ${app.message}; the fixer's instance may still be running`); }
		else if (app && !stopFixture({ session: 'heal-fix', root: '/tmp/dp-heal-fix', ...app })) { console.log('fix-loop: the fixer\'s instance did not stop'); }

		if (git('rev-parse', 'HEAD').trim() !== pre) {
			discard(pre, true);
			scopeViolation = `${f.id}: the fixer committed`;
			writeState(dir, { scopeViolation });
			console.log(`fix-loop: ${f.id} committed; discarded, stopping`);
			break;
		}
		const touched = pathsFromStatus(git(...STATUS));
		const bad = outside(touched);
		if (bad.length) {
			discard(pre, true);
			scopeViolation = `${f.id}: ${bad.join(', ')}`;
			writeState(dir, { scopeViolation });
			console.log(`fix-loop: ${f.id} edited outside ${SKILL_PREFIX}: ${bad.join(', ')}; discarded, stopping`);
			break;
		}
		if (session.error || session.status !== 0) {
			discard(pre, false);
			failed = true;
			const why = session.error ? session.error.message : `exit ${session.status ?? `signal ${session.signal}`}`;
			save(addFields(f, { notAttempted: `the fixer session failed (${why})` }));
			console.log(`fix-loop: ${f.id} session failed (${why})`);
			continue;
		}
		const o = readOutcome(existsSync(outFile) ? readFileSync(outFile, 'utf8') : null);
		if (typeof o === 'string') {
			discard(pre, false);
			save(addFields(f, { notAttempted: `the session ended without a usable outcome: ${o}` }));
			continue;
		}
		if (o.outcome !== 'fixed' || !touched.length) {
			discard(pre, false);
			save(addFields(f, { outcome: o.outcome, reason: o.reason, reproductions: [o.reproduction], ...(o.outcome === 'fixed' ? { rejected: 'outcome fixed with no change' } : {}) }));
			continue;
		}

		const changed = smokeChecksChanged(touched);
		git('add', '--', SKILL_PREFIX);
		// --no-verify: the pre-commit hook needs the full dev setup, and check.ts runs next.
		git('-c', 'user.name=positron-bot', '-c', 'user.email=positron-bot@posit.co', 'commit', '-q', '--no-verify', '-m', `drive-positron: fix ${f.id}\n\n${o.reason}`);
		const sha = git('rev-parse', 'HEAD').trim();

		// The post-fix check: check.ts, then the full suite, which is also the cascade re-check.
		const check = spawnSync(process.execPath, [join(here, '../test/check.ts')], { cwd: repo, encoding: 'utf8' });
		const postFile = join(dir, `post-${n}.json`);
		rmSync(postFile, { force: true });
		const smoke = check.status === 0
			? spawnSync(process.execPath, [join(here, '../test/smoke.ts'), '--results', postFile, '--', ...appArgs], { cwd: repo, encoding: 'utf8' })
			: null;
		writeFileSync(join(dir, 'checks', `post-${n}.txt`), `${check.stdout ?? ''}${check.stderr ?? ''}\n${smoke ? `${smoke.stdout ?? ''}${smoke.stderr ?? ''}` : '(smoke not run: check.ts failed)'}`);
		let after: SmokeResults | null = null;
		try { after = smoke && existsSync(postFile) ? readResults(postFile) : null; } catch { /* reported as "smoke did not run" */ }
		const reg = after ? regressions(baseline, after) : [];
		const verdict = check.status !== 0 ? 'check.ts failed'
			: !after || after.launch === 'FAIL' ? 'smoke did not run'
			: reg.length ? `turned red: ${reg.map(c => `${c.name} (${c.problem.slice(0, 160)})`).join('; ')}`
			: f.case && !after.cases.some(c => c.name === f.case && c.status === 'PASS') ? `its own case "${f.case}" still fails`
			: '';
		save(addFields(f, { outcome: 'fixed', reason: o.reason, reproductions: [o.reproduction], smokeChecksChanged: changed, commit: sha, ...(verdict ? { rejected: verdict } : {}) }));
		if (verdict) {
			discard(pre, false);
			console.log(`fix-loop: ${f.id} fix rejected: ${verdict}`);
			continue;
		}
		accepted++;
		baseline = after!;
		findings = cascade(findings, after!, f.id, after!.startedAt);
		for (const x of findings) { writeFinding(fdir, x); }
		console.log(`fix-loop: ${f.id} fixed in ${sha.slice(0, 8)}`);
	}

	// Every accepted commit passed its own check, and HEAD is the last of them, so the series is the gate's subject.
	rmSync(join(dir, 'patches'), { recursive: true, force: true });
	if (accepted) { git('format-patch', '-q', '--no-color', '-o', join(dir, 'patches'), `${base}..HEAD`); }
	writeState(dir, { gate: accepted ? 'pass' : 'none', notAttempted: notAttempted.map(f => f.id) });
	console.log(`fix-loop: ${accepted} fix(es) accepted of ${n} session(s)`);
	return failed || scopeViolation ? 1 : 0;
}

if (isMain()) {
	try { process.exitCode = main(); } catch (e) { console.log(`fix-loop: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; }
}
