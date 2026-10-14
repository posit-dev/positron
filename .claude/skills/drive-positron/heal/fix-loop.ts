/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// One fixer session per open finding, at most --cap a night, and none started
// once --budget-minutes have passed. Each "fixed" becomes a commit, then
// check.ts and a smoke run decide whether it stays: the sections the change can
// reach (affected.ts), or the full suite when it is shared. check.ts runs once
// first, so a check already red on main does not reject every fix.
//
//   node .claude/skills/drive-positron/heal/fix-loop.ts --dir /tmp/heal --runner PATH/session-cli.mjs [--cap 5] [--budget-minutes N] [-- APP ARGS...]
//
// Refuses a dirty tree: the loop runs reset --hard and clean. Exit 1 when a
// session failed, the fixer edited outside the skill or committed, git failed,
// or check.ts printed no results before the loop.

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFixtureState, stopFixture } from '../test/fixture-app.ts';
import { flagValue, readResults, SMOKE_ROOT, SMOKE_SESSION, unknownArg, type SmokeResults } from '../test/smoke-lib.ts';
import { addFields, readFindings, readState, writeFinding, writeState, type Finding } from './finding.ts';
import { addedKeys, affectedHelpers, postSections, readGraph, selectorUsers } from './affected.ts';
import { addedCases, applyCovers, caseGate, earlierVerdicts, fixedBefore, inSections, knownProduct, newCaseProblems, newCheckFailures, otherOpen, parseChecks, placeSections, queue, readOutcome, regressions, readReview, replaceCases, type FixerOutcome, type IssueStates, type Review } from './fix-lib.ts';
import { checksChanged } from './links.ts';
import { cascade, mergeResults } from './rerun-lib.ts';
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

// Build output inside a submodule (ai-lib, ark) shows as a modified submodule; only a moved commit counts.
const STATUS = ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty'];
const SMOKE = `${SKILL_PREFIX}test/smoke.ts`;

function main(): number {
	const dash = process.argv.indexOf('--');
	const own = process.argv.slice(2, dash < 0 ? undefined : dash);
	const appArgs = dash < 0 ? [] : process.argv.slice(dash + 1);
	const bad = unknownArg(own, ['--dir', '--runner', '--cap', '--budget-minutes']);
	if (bad !== null) { console.log(`fix-loop: unknown argument ${JSON.stringify(bad)}`); return 2; }
	const flag = (name: string): string | null => {
		const v = flagValue(own, name);
		if (v instanceof Error) { console.log(`fix-loop: ${v.message}`); process.exit(2); }
		return v;
	};
	const dir = flag('--dir') ?? '/tmp/heal';
	const runner = flag('--runner');
	const capText = flag('--cap') ?? '5';
	const budgetText = flag('--budget-minutes');
	if (!runner) { console.log('fix-loop: --runner is required'); return 2; }
	if (!/^[1-9]\d*$/.test(capText)) { console.log('fix-loop: --cap must be a positive integer'); return 2; }
	if (budgetText !== null && !/^\d+$/.test(budgetText)) { console.log('fix-loop: --budget-minutes must be a whole number'); return 2; }
	const cap = Number(capText);
	const started = Date.now();
	const budgetMs = budgetText === null ? Infinity : Number(budgetText) * 60_000;
	if (git(...STATUS) !== '') { console.log('fix-loop: the working tree is not clean; the loop resets and cleans it, so commit or stash first'); return 2; }
	if (readState(dir).wholesale) { console.log('fix-loop: smoke broke wholesale; no fixer runs'); writeState(dir, { gate: 'none' }); return 0; }

	const fdir = join(dir, 'findings');
	const stateFile = join(dir, 'fixer-app.json');
	const base = git('rev-parse', 'HEAD').trim();
	let baseline: SmokeResults = readResults(join(dir, 'smoke-1.json'));
	const order = baseline.cases.map(c => c.name);
	let findings = readFindings(fdir);
	// recent/<run id>/ holds earlier nights' findings, fetched by the workflow.
	const recentDir = join(dir, 'recent');
	const recent = new Map(existsSync(recentDir) ? readdirSync(recentDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => [d.name, readFindings(join(recentDir, d.name))]) : []);
	const save = (f: Finding) => { writeFinding(fdir, f); findings = findings.map(x => x.id === f.id ? f : x); };
	// A product bug filed as an open issue needs no fixer; tonight's two failing reproductions say it is still there.
	const issuesFile = join(recentDir, 'issues.json');
	const states: IssueStates = existsSync(issuesFile) ? JSON.parse(readFileSync(issuesFile, 'utf8')) : {};
	for (const f of findings.filter(x => x.outcome === undefined)) {
		const k = knownProduct(recent, f, states);
		if (!k) { continue; }
		const { broke, cause } = k.finding;
		save(addFields(f, {
			outcome: 'product', issue: k.issue, reason: `a known product bug, open as issue #${k.issue} (run ${k.run}); no fixer ran`,
			...(broke ? { broke } : {}), ...(cause ? { cause } : {}),
		}));
	}
	const { attempt, notAttempted } = queue(findings, order, cap);
	for (const f of findings.filter(x => x.outcome === undefined)) {
		const runs = fixedBefore(recent, f);
		if (runs.length) { save(addFields(f, { fixedBefore: runs })); }
	}
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
	const runCheck = () => spawnSync(process.execPath, [join(here, '../test/check.ts')], { cwd: repo, encoding: 'utf8' });

	// A fix is judged only on the checks that pass without it.
	const before = attempt.length ? runCheck() : null;
	const checksBefore = parseChecks(before?.stdout ?? '');
	const redOnMain = [...checksBefore].filter(([, v]) => v === 'FAIL').map(([name]) => name);
	if (before) { writeFileSync(join(dir, 'checks', 'before.txt'), `${before.stdout ?? ''}${before.stderr ?? ''}`); }
	if (before && before.status !== 0 && !checksBefore.size) { console.log('fix-loop: check.ts printed no results before the loop; no fixer runs'); writeState(dir, { gate: 'none' }); return 1; }
	if (redOnMain.length) { console.log(`fix-loop: check.ts already fails before any fix: ${redOnMain.join(', ')}`); writeState(dir, { checksRedOnMain: redOnMain }); }
	let outOfTime = 0;

	type Session = { kind: 'stop' } | { kind: 'failed'; why: string } | { kind: 'unusable'; why: string } | { kind: 'outcome'; o: FixerOutcome; touched: string[] };
	/** One fixer session on the brief already written; leaves the tree as the fixer left it unless it must stop. */
	const runFixer = (f: Finding, pre: string, outFile: string, label: string, minutes: number): Session => {
		rmSync(outFile, { force: true });
		rmSync(stateFile, { force: true });
		const session = spawnSync(process.execPath, [runner, '--prompt-file', join(dir, 'fixer-brief.md'), '--system-file', join(here, 'fixer.md'),
			'--tools', 'Bash,Read,Edit,Write,Glob,Grep', '--model', 'opus', '--effort', 'high', '--max-turns', '150', '--time-limit', String(minutes),
			'--cwd', repo, '--write-root', join(repo, SKILL_PREFIX), '--label', `fixer ${label}`, '--out', join(dir, 'cost', `fixer-${label}.json`)], { stdio: 'inherit' });

		// Stop the fixer's instance before any git or check step; smoke launches its own.
		const app = readFixtureState(stateFile);
		if (app instanceof Error) { console.log(`fix-loop: ${app.message}; the fixer's instance may still be running`); }
		else if (app && !stopFixture({ session: 'heal-fix', root: '/tmp/dp-heal-fix', ...app })) { console.log('fix-loop: the fixer\'s instance did not stop'); }
		// And the one a `smoke.ts --keep` left; post-fix smoke relaunches on its root.
		const kept = readFixtureState(join(SMOKE_ROOT, 'instance.json'));
		if (kept instanceof Error) { console.log(`fix-loop: ${kept.message}; a kept smoke instance may still be running`); }
		else if (kept && !stopFixture({ session: SMOKE_SESSION, root: SMOKE_ROOT, ...kept })) { console.log('fix-loop: the kept smoke instance did not stop'); }

		if (git('rev-parse', 'HEAD').trim() !== pre) {
			discard(pre, true);
			scopeViolation = `${f.id}: the fixer committed`;
			writeState(dir, { scopeViolation });
			console.log(`fix-loop: ${f.id} committed; discarded, stopping`);
			return { kind: 'stop' };
		}
		const touched = pathsFromStatus(git(...STATUS));
		const bad = outside(touched);
		if (bad.length) {
			discard(pre, true);
			scopeViolation = `${f.id}: ${bad.join(', ')}`;
			writeState(dir, { scopeViolation });
			console.log(`fix-loop: ${f.id} edited outside ${SKILL_PREFIX}: ${bad.join(', ')}; discarded, stopping`);
			return { kind: 'stop' };
		}
		if (session.error || session.status !== 0) { return { kind: 'failed', why: session.error ? session.error.message : `exit ${session.status ?? `signal ${session.signal}`}` }; }
		const o = readOutcome(existsSync(outFile) ? readFileSync(outFile, 'utf8') : null);
		return typeof o === 'string' ? { kind: 'unusable', why: o } : { kind: 'outcome', o, touched };
	};

	/** A read-only review of the staged change; its verdict, or null when the review itself failed. */
	const reviewFix = (f: Finding, o: FixerOutcome, pre: string, round: number): Review | null => {
		const brief = join(dir, 'review-brief.md');
		writeFileSync(brief, [
			'# Finding', '', '```json', JSON.stringify(f, null, 2), '```', '',
			'# The fixer\'s account', '', o.reason, '', ...(o.plain.change ? [`Change: ${o.plain.change}`, ''] : []),
			...(o.untestable ? [`No smoke case, because: ${o.untestable}`, ''] : []),
			'# Staged diff', '', '```diff', git('diff', '--cached', '--no-color', pre), '```',
		].join('\n'));
		const out = join(dir, 'cost', `reviewer-${f.id}-${round}.json`);
		const r = spawnSync(process.execPath, [runner, '--prompt-file', brief, '--system-file', join(here, 'reviewer.md'),
			'--tools', 'Read,Grep,Glob', '--model', 'sonnet', '--effort', 'medium', '--max-turns', '40', '--time-limit', '8',
			'--cwd', repo, '--write-root', join(dir, 'review-sandbox'), '--label', `reviewer ${f.id}`, '--out', out], { stdio: 'inherit' });
		if (r.error || r.status !== 0 || !existsSync(out)) { console.log(`fix-loop: ${f.id} review ${round} did not run`); return null; }
		const v = readReview((JSON.parse(readFileSync(out, 'utf8')) as { finalText?: string }).finalText ?? null);
		if (typeof v === 'string') { console.log(`fix-loop: ${f.id} review ${round}: ${v}`); return null; }
		return v;
	};

	for (const queued of attempt) {
		const f = findings.find(x => x.id === queued.id)!;
		if (f.outcome !== undefined) { continue; } // resolved by an earlier fix's cascade
		if (Date.now() - started >= budgetMs) {
			outOfTime++;
			save(addFields(f, { notAttempted: 'the night\'s fixer time ran out; comes back next night' }));
			continue;
		}
		n++;
		const outFile = join(dir, `outcome-${f.id}.json`);
		const earlier = earlierVerdicts(recent, f);
		const others = otherOpen(findings, f.id);
		writeFileSync(join(dir, 'fixer-brief.md'), [
			'# Finding', '', '```json', JSON.stringify(f, null, 2), '```', '',
			...(earlier.length ? ['# Earlier verdicts', '', ...earlier.map(v => `- ${v}`), ''] : []),
			...(others.length ? ['# Other open findings tonight', '', ...others, ''] : []),
			`Checkout: ${repo}`, `App args for fixture-app.ts launch: ${appArgs.join(' ') || '(none)'}`,
			`State file for fixture-app.ts --state: ${stateFile}`, `Outcome path: ${outFile}`,
			...(redOnMain.length ? [`check.ts already fails without your fix: ${redOnMain.join(', ')}. Those checks are not yours to fix.`] : []),
		].join('\n'));
		const pre = git('rev-parse', 'HEAD').trim();
		const first = runFixer(f, pre, outFile, f.id, 25);
		if (first.kind === 'stop') { break; }
		if (first.kind === 'failed') {
			discard(pre, false);
			failed = true;
			save(addFields(f, { notAttempted: `the fixer session failed (${first.why})` }));
			console.log(`fix-loop: ${f.id} session failed (${first.why})`);
			continue;
		}
		if (first.kind === 'unusable') {
			discard(pre, false);
			save(addFields(f, { notAttempted: `the session ended without a usable outcome: ${first.why}` }));
			continue;
		}
		let { o, touched } = first;
		if (o.outcome !== 'fixed' || !touched.length) {
			discard(pre, false);
			save(addFields(f, { outcome: o.outcome, reason: o.reason, reproductions: [o.reproduction], ...o.plain, ...(o.issue ? { issue: o.issue } : {}), ...(o.outcome === 'fixed' ? { rejected: 'outcome fixed with no change' } : {}) }));
			continue;
		}

		git('add', '--', SKILL_PREFIX);
		let added = touched.includes(SMOKE) ? addedCases(git('diff', '--cached', '-U0', '--no-color', pre, '--', SMOKE)) : [];
		const gate = caseGate(touched, added, o.untestable);
		if (gate) {
			discard(pre, false);
			save(addFields(f, { outcome: 'fixed', reason: o.reason, reproductions: [o.reproduction], ...o.plain, rejected: gate }));
			console.log(`fix-loop: ${f.id} fix rejected: ${gate}`);
			continue;
		}
		const r1 = reviewFix(f, o, pre, 1);
		let notes = r1?.notes ?? [];
		let reviewVerdict = r1?.verdict;
		let revised = false;
		// One send-back, and only while the night has time; the second review is recorded, not obeyed.
		if (r1?.verdict === 'revise' && Date.now() - started < budgetMs) {
			writeFileSync(join(dir, 'fixer-brief.md'), [readFileSync(join(dir, 'fixer-brief.md'), 'utf8'), '',
				'# Review of your change', '', 'Your change is still in the working tree. A reviewer sent it back with these notes. Fix what is right in them, then write the outcome file again; say in `reason` which notes you did not act on and why.', '',
				...r1.notes.map(n => `- ${n}`)].join('\n'));
			git('reset', '-q');
			const second = runFixer(f, pre, outFile, `${f.id}-revise`, 10);
			if (second.kind === 'stop') { break; }
			if (second.kind !== 'outcome' || second.o.outcome !== 'fixed' || !second.touched.length) {
				discard(pre, false);
				if (second.kind === 'failed') { failed = true; }
				const why = second.kind === 'outcome' ? `the revision ended as ${second.o.outcome}` : second.why;
				save(addFields(f, { outcome: 'fixed', reason: o.reason, reproductions: [o.reproduction], ...o.plain, review: r1.notes, rejected: `review sent it back and ${why}` }));
				continue;
			}
			({ o, touched } = second);
			revised = true;
			git('add', '--', SKILL_PREFIX);
			const added2 = touched.includes(SMOKE) ? addedCases(git('diff', '--cached', '-U0', '--no-color', pre, '--', SMOKE)) : [];
			const gate2 = caseGate(touched, added2, o.untestable);
			if (gate2) {
				discard(pre, false);
				save(addFields(f, { outcome: 'fixed', reason: o.reason, reproductions: [o.reproduction], ...o.plain, review: r1.notes, revised, rejected: gate2 }));
				continue;
			}
			added = added2;
			const r2 = reviewFix(f, o, pre, 2);
			notes = r2?.notes ?? [];
			reviewVerdict = r2?.verdict;
		}
		// Added cases are not a change to what judges the fix.
		const changed = checksChanged(added?.length ? touched.filter(p => p !== SMOKE) : touched);
		// --no-verify: the pre-commit hook needs the full dev setup, and check.ts runs next.
		git('-c', 'user.name=positron-bot', '-c', 'user.email=positron-bot@posit.co', 'commit', '-q', '--no-verify', '-m', `drive-positron: fix ${f.id}\n\n${o.reason}`);
		const sha = git('rev-parse', 'HEAD').trim();

		// The post-fix check: check.ts, then smoke over the sections the change can reach, one
		// launch each (--until a section's last case runs its setup and all its cases), or the
		// full suite. It is also the cascade re-check.
		const check = runCheck();
		const checksAfter = parseChecks(check.stdout ?? '');
		const turnedRed = newCheckFailures(checksBefore, checksAfter);
		const checkOk = check.status === 0 || (checksAfter.size > 0 && !turnedRed.length);
		// A selectors.ts change that only adds entries reaches just the scripts using them.
		const scripts = join(here, '../scripts');
		const reach = touched.flatMap(p => p === SMOKE && added?.length ? added.map(a => `${SKILL_PREFIX}scripts/${a.helper}`)
			: p === `${SKILL_PREFIX}scripts/selectors.ts` ? selectorUsers(addedKeys(git('diff', '-U0', '--no-color', pre, sha, '--', p)), scripts) ?? [p] : [p]);
		const graph = readGraph(scripts);
		const scoped = postSections(baseline, affectedHelpers(reach, graph), f);
		// The helpers its scripts/ change reaches, for the PR title.
		const reaches = affectedHelpers(reach.filter(p => p.startsWith(`${SKILL_PREFIX}scripts/`)), graph);
		// Cases the fix added can sit past a section's baseline last case, or in a section the baseline did not pick.
		let sections = scoped;
		if (scoped && added?.length) {
			const listing = spawnSync(process.execPath, [join(here, '../test/smoke.ts'), '--list'], { cwd: repo, encoding: 'utf8' });
			try { sections = placeSections(scoped, JSON.parse(listing.stdout), added); } catch { sections = null; }
		}
		const runs = (sections ?? [null]).map((s, i) => ({ until: s?.last, file: join(dir, sections ? `post-${n}-${i + 1}.json` : `post-${n}.json`) }));
		const outputs: string[] = [];
		const results: SmokeResults[] = [];
		let ran = checkOk;
		for (const run of checkOk ? runs : []) {
			rmSync(run.file, { force: true });
			const smoke = spawnSync(process.execPath, [join(here, '../test/smoke.ts'), ...(run.until ? ['--until', run.until] : []), '--results', run.file, '--', ...appArgs], { cwd: repo, encoding: 'utf8' });
			outputs.push(`${smoke.stdout ?? ''}${smoke.stderr ?? ''}`);
			try { results.push(readResults(run.file)); } catch { ran = false; break; }
			if (results.at(-1)!.launch === 'FAIL') { break; }
		}
		writeFileSync(join(dir, 'checks', `post-${n}.txt`), `${check.stdout ?? ''}${check.stderr ?? ''}\n${checkOk ? outputs.join('\n') : '(smoke not run: check.ts failed)'}`);
		const after = ran ? mergeResults(results) : null;
		const reg = after ? regressions(sections ? inSections(baseline, sections.map(s => s.id)) : baseline, after) : [];
		const verdict = !checkOk ? `check.ts failed${turnedRed.length ? `: ${turnedRed.join(', ')}` : ''}`
			: !after || after.launch === 'FAIL' ? 'smoke did not run'
				: reg.length ? `turned red: ${reg.map(c => `${c.name} (${c.problem.slice(0, 160)})`).join('; ')}`
					: f.case && !after.cases.some(c => c.name === f.case && c.status === 'PASS') ? `its own case "${f.case}" still fails`
						: after && added?.length ? newCaseProblems(added, after).join('; ') : '';
		save(addFields(f, { outcome: 'fixed', reason: o.reason, reproductions: [o.reproduction], ...o.plain, checksChanged: changed, commit: sha, ...(sections ? { smokeSections: sections.map(s => s.id) } : {}),
			...(added?.length ? { newCases: added.map(a => a.name) } : {}), ...(o.untestable ? { untestable: o.untestable } : {}),
			...(notes.length ? { review: notes } : {}), ...(revised ? { revised } : {}), ...(reviewVerdict ? { reviewVerdict } : {}),
			reaches: reaches === 'all' ? 'all' : [...reaches].sort(), ...(verdict ? { rejected: verdict } : {}) }));
		if (verdict) {
			discard(pre, false);
			console.log(`fix-loop: ${f.id} fix rejected: ${verdict}`);
			continue;
		}
		accepted++;
		baseline = sections ? replaceCases(baseline, after!) : after!;
		findings = cascade(findings, after!, f.id, after!.startedAt);
		if (o.covers?.length) { findings = applyCovers(findings, f.id, o.covers, after!.startedAt); }
		for (const x of findings) { writeFinding(fdir, x); }
		console.log(`fix-loop: ${f.id} fixed in ${sha.slice(0, 8)}`);
	}

	// Every accepted commit passed its own check, and HEAD is the last of them, so the series is the gate's subject.
	rmSync(join(dir, 'patches'), { recursive: true, force: true });
	if (accepted) { git('format-patch', '-q', '--no-color', '-o', join(dir, 'patches'), `${base}..HEAD`); }
	writeState(dir, { gate: accepted ? 'pass' : 'none', notAttempted: notAttempted.map(f => f.id), ...(outOfTime ? { outOfTime } : {}) });
	console.log(`fix-loop: ${accepted} fix(es) accepted of ${n} session(s)`);
	return failed || scopeViolation ? 1 : 0;
}

if (isMain()) {
	try { process.exitCode = main(); } catch (e) { console.log(`fix-loop: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; }
}
