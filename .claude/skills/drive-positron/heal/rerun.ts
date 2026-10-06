/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Reruns smoke once per group with a failure (--until its last failure, which
// is the group's setup and its cases through there), and writes a finding for
// each case that failed both times. A case that passed there is replayed once
// more from the start: if it fails again, it needs an earlier section's state,
// and is a finding too. From the repo root:
//
//   node .claude/skills/drive-positron/heal/rerun.ts --dir /tmp/heal [-- APP ARGS...]
//
// Reads DIR/smoke-1.json; writes findings/, flakes.json, unconfirmed.json and
// state.json (wholesale). A group whose rerun did not launch leaves its cases
// unconfirmed. Exits 1 when the nightly run or every rerun could not launch the app.

import { spawnSync } from 'child_process';
import { existsSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { flagValue, readResults } from '../test/smoke-lib.ts';
import { writeFinding, writeState as saveState, type State } from './finding.ts';
import { classify, crossSection, lastFailedPerGroup, launchedRuns, smokeFinding, wholesale } from './rerun-lib.ts';

const here = dirname(new URL(import.meta.url).pathname);
const dash = process.argv.indexOf('--');
const own = process.argv.slice(2, dash < 0 ? undefined : dash);
const appArgs = dash < 0 ? [] : process.argv.slice(dash + 1);
const dirArg = flagValue(own, '--dir');
if (typeof dirArg !== 'string') { console.error('rerun: --dir needs a value'); process.exit(2); }
const dir = dirArg;
const writeState = (patch: State) => saveState(dir, patch);

const first = readResults(join(dir, 'smoke-1.json'));
if (first.launch === 'FAIL') { console.log(`rerun: the nightly smoke run did not launch: ${first.launchProblem}`); process.exit(1); }
const lasts = lastFailedPerGroup(first);
if (!lasts.length) { console.log('rerun: smoke had no failures'); writeState({ wholesale: false }); process.exit(0); }

const smoke = resolve(here, '../test/smoke.ts');
const replay = (file: string, args: string[]) => {
	const out = join(dir, file);
	rmSync(out, { force: true });
	const ran = spawnSync(process.execPath, [smoke, ...args, '--results', out, '--', ...appArgs], { stdio: 'inherit' });
	if (ran.status === 2) { console.log(`rerun: smoke rejected its arguments (${args.join(' ')})`); process.exit(1); }
	if (!existsSync(out)) { console.log(`rerun: smoke ${args.join(' ')} wrote no results`); process.exit(1); }
	return readResults(out);
};
const runs = lasts.map((last, i) => replay(`smoke-rerun-${i + 1}.json`, ['--until', last]));
const { merged: second, problems } = launchedRuns(runs, lasts.map(l => `the rerun --until "${l}"`));
for (const p of problems) { console.log(`rerun: ${p} (did not launch; its cases stay unconfirmed)`); }
if (!second) { console.log('rerun: no rerun launched'); process.exit(1); }
writeFileSync(join(dir, 'smoke-rerun.json'), `${JSON.stringify(second, null, '\t')}\n`);

const got = classify(first, second);
for (const p of got.persistent) { writeFinding(join(dir, 'findings'), smokeFinding(p.first, p.second, { first: first.startedAt, second: second.startedAt })); }
if (got.flakes.length) {
	const full = replay('smoke-rerun-full.json', ['--until', got.flakes.at(-1)!.name, '--from-start']);
	if (full.launch === 'FAIL') { console.log(`rerun: the replay from the start did not launch (${full.launchProblem}); its cases stay flakes`); }
	const split = crossSection(got.flakes, full);
	for (const p of split.persistent) { writeFinding(join(dir, 'findings'), smokeFinding(p.first, p.second, { first: first.startedAt, second: full.startedAt }, true)); }
	got.persistent.push(...split.persistent);
	got.flakes = split.flakes;
}
writeFileSync(join(dir, 'flakes.json'), `${JSON.stringify(got.flakes, null, '\t')}\n`);
writeFileSync(join(dir, 'unconfirmed.json'), `${JSON.stringify(got.unconfirmed, null, '\t')}\n`);
const broke = wholesale(got.persistent.length, first.cases.length);
writeState({ wholesale: broke });
console.log(`rerun: ${got.persistent.length} findings, ${got.flakes.length} flakes, ${got.unconfirmed.length} unconfirmed${broke ? '; smoke broke wholesale, no fixer will run' : ''}`);
