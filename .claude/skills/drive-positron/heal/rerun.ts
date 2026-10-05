/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Reruns smoke once, from the first case through the last that failed, and
// writes a finding for each case that failed both times. From the repo root:
//
//   node .claude/skills/drive-positron/heal/rerun.ts --dir /tmp/heal [-- APP ARGS...]
//
// Reads DIR/smoke-1.json; writes findings/, flakes.json, unconfirmed.json and
// state.json (wholesale). Exits 1 when either run could not launch the app.

import { spawnSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { readResults } from '../test/smoke-lib.ts';
import { writeFinding, writeState as saveState, type State } from './finding.ts';
import { classify, lastFailed, smokeFinding, wholesale } from './rerun-lib.ts';

const here = dirname(new URL(import.meta.url).pathname);
const dash = process.argv.indexOf('--');
const own = process.argv.slice(2, dash < 0 ? undefined : dash);
const appArgs = dash < 0 ? [] : process.argv.slice(dash + 1);
const dir = own.includes('--dir') ? own[own.indexOf('--dir') + 1] : '/tmp/heal';
const writeState = (patch: State) => saveState(dir, patch);

const first = readResults(join(dir, 'smoke-1.json'));
if (first.launch === 'FAIL') { console.log(`rerun: the nightly smoke run did not launch: ${first.launchProblem}`); process.exit(1); }
const last = lastFailed(first);
if (!last) { console.log('rerun: smoke had no failures'); writeState({ wholesale: false }); process.exit(0); }

const smoke = resolve(here, '../test/smoke.ts');
const out = join(dir, 'smoke-rerun.json');
spawnSync(process.execPath, [smoke, '--until', last, '--results', out, '--', ...appArgs], { stdio: 'inherit' });
if (!existsSync(out)) { console.log('rerun: smoke wrote no results'); process.exit(1); }
const second = readResults(out);
if (second.launch === 'FAIL') { console.log(`rerun: the rerun did not launch: ${second.launchProblem}`); process.exit(1); }

const got = classify(first, second);
for (const p of got.persistent) { writeFinding(join(dir, 'findings'), smokeFinding(p.first, p.second, { first: first.startedAt, second: second.startedAt })); }
writeFileSync(join(dir, 'flakes.json'), `${JSON.stringify(got.flakes, null, '\t')}\n`);
writeFileSync(join(dir, 'unconfirmed.json'), `${JSON.stringify(got.unconfirmed, null, '\t')}\n`);
const broke = wholesale(got.persistent.length, first.cases.length);
writeState({ wholesale: broke });
console.log(`rerun: ${got.persistent.length} findings, ${got.flakes.length} flakes, ${got.unconfirmed.length} unconfirmed${broke ? '; smoke broke wholesale, no fixer will run' : ''}`);
