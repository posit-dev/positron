// Holds each script's declared CLI surface and references/scripts.md together.
//
// The reference is the only flag documentation this skill has (there is no
// generated man page), and the skill reads it to decide what to run. When the
// two drift, the failure is silent in both directions: a flag the reference
// omits can never be used, and a flag it invents fails at runtime. Both had
// already happened when this test was written -- find-prior-triage.js had four
// undocumented flags, and the reference documented a --test-id that
// fetch-pattern-evidence.js does not read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { CLI as resolveTestKey } from '../resolve-test-key.js';
import { CLI as triageHistory } from '../triage-history.js';
import { CLI as findPriorTriage } from '../find-prior-triage.js';
import { CLI as fetchPatternEvidence } from '../fetch-pattern-evidence.js';
import { CLI as collectLocalEvidence } from '../collect-local-evidence.js';
import { CLI as checkpoint } from '../checkpoint.js';
import { CLI as recordDiagnosis } from '../record-diagnosis.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '..');
const REFERENCE = path.resolve(HERE, '..', '..', 'references', 'scripts.md');

const CLIS = [
	resolveTestKey, triageHistory, findPriorTriage, fetchPatternEvidence,
	collectLocalEvidence, checkpoint, recordDiagnosis,
];

/**
 * The chunk of scripts.md documenting one script: from its `## \`name.js\``
 * heading to the next `## `. Flags are cited as `--flag` or `--flag <value>`
 * inside backticks, so read the tokens rather than the table structure -- the
 * reference documents some flags in prose and some in a table.
 */
function referenceSection(markdown, scriptName) {
	const heading = new RegExp(`^## \`${scriptName.replace('.', '\\.')}\`$`, 'm');
	const start = markdown.search(heading);
	assert.notEqual(start, -1, `references/scripts.md has no "## \`${scriptName}\`" section`);
	const rest = markdown.slice(start + 1);
	const end = rest.search(/^## /m);
	return end === -1 ? rest : rest.slice(0, end);
}

function flagsCitedIn(section, scriptName) {
	// Only count flags inside backticks -- code spans are the reliable citation.
	// One span can hold several (`--triage-id <id> --init --test-key <key>`), so
	// scan each in full. A span naming a *different* command documents that
	// command, not this one (`npx playwright test --list`, `checkpoint.js --init`).
	const cited = new Set();
	for (const [, span] of section.matchAll(/`([^`]*)`/g)) {
		const otherCommand = [...span.matchAll(/([a-z][a-z-]*\.js)/g)].some(m => m[1] !== scriptName)
			|| /\b(npx|npm|git|gh)\b/.test(span);
		if (otherCommand) { continue; }
		for (const flag of span.matchAll(/--([a-z][a-z-]*)/g)) { cited.add(flag[1]); }
	}
	return cited;
}

const markdown = fs.readFileSync(REFERENCE, 'utf8');

for (const cli of CLIS) {
	test(`${cli.name}: every declared flag is documented in scripts.md`, () => {
		const cited = flagsCitedIn(referenceSection(markdown, cli.name), cli.name);
		const undocumented = cli.flags.map(f => f.name).filter(n => !cited.has(n));
		assert.deepEqual(undocumented, [],
			`${cli.name} accepts flags the reference never mentions, so the skill cannot use them: ` +
			undocumented.map(n => '--' + n).join(', '));
	});

	test(`${cli.name}: scripts.md documents no flag the script ignores`, () => {
		const declared = new Set(cli.flags.map(f => f.name));
		// --help is universal and deliberately not tabulated per script.
		declared.add('help');
		const invented = [...flagsCitedIn(referenceSection(markdown, cli.name), cli.name)].filter(n => !declared.has(n));
		assert.deepEqual(invented, [],
			`${cli.name} is documented as accepting flags it never reads: ` +
			invented.map(n => '--' + n).join(', '));
	});

	test(`${cli.name}: --help prints without needing required flags`, () => {
		// --help is most wanted exactly when the required flags are missing, so it
		// must short-circuit before validation rather than exiting 1 with { error }.
		const out = execFileSync('node', [path.join(SCRIPTS_DIR, cli.name), '--help'], { encoding: 'utf8' });
		assert.match(out, new RegExp(`^${cli.name.replace('.', '\\.')} -- `));
		for (const flag of cli.flags) {
			assert.ok(out.includes(`--${flag.name}`), `${cli.name} --help omits --${flag.name}`);
		}
	});
}

test('boolean flags are exactly the ones declared as type boolean', () => {
	// parseArgs consumes the next argv entry as a value for any flag not in this
	// list, so a boolean missing from it silently swallows the following flag.
	assert.deepEqual(checkpoint.booleanFlags.sort(),
		['force', 'init', 'read', 'status', 'validate']);
	assert.deepEqual(recordDiagnosis.booleanFlags.sort(), ['dry-run', 'secondary']);
	assert.deepEqual(collectLocalEvidence.booleanFlags, ['list']);
	assert.deepEqual(fetchPatternEvidence.booleanFlags, ['keep-raw-logs']);
	assert.deepEqual(triageHistory.booleanFlags, []);
});
