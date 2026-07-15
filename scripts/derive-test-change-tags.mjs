/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Derives the minimal additional e2e tag(s) needed to guarantee touched/added
// e2e test files actually run, without over-selecting sibling suites that
// happen to share a broader tag. See
// docs/superpowers/specs/2026-07-09-e2e-test-change-auto-tagging-design.md.
//
// Usage:
//   node scripts/derive-test-change-tags.mjs --changed-files <path> [--selected-tags <csv>] [--list-json <path>]
//
//   changed-files: path to a newline-delimited file of repo-relative changed paths
//   selected-tags: comma-separated tags already selected by earlier derivation
//     steps (author + src-path-map + @:critical + @:ark). Default: empty.
//   feature-tags: comma-separated allowlist of tags eligible to be selected as
//     a cover (the FeatureTags enum -- see scripts/lib/pr-tags-lib.sh
//     feature_enum_tags). Platform/special tags are excluded: they trigger
//     their own CI lanes and adding one to the electron --grep would widen the
//     run without enabling its lane. When omitted or empty, no filtering is
//     applied (all of a touched spec's tags are eligible) -- an empty value is
//     treated the same as omitting the flag, never as an empty allowlist.
//   list-json: test-only override. When given, reads this file instead of
//     invoking `playwright test --list --project e2e-electron --reporter=json`.
//     Its shape must match that command's real JSON output.
//
// Prints newline-separated new tag(s) to stdout (empty output = nothing
// needed). Warnings (e.g. a touched test with no declared tags) go to stderr
// only, never mixed into stdout.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const TOUCHED_FILE_RE = /^test\/e2e\/tests\/.*\.test\.ts$/;
// Above this many candidate tags, fall back to a greedy approximation instead
// of exact brute-force search (2^n subsets). Not expected to trigger in
// practice -- a single PR's touched-file set is small -- but bounds the
// algorithm's worst case rather than leaving it unbounded.
const CANDIDATE_CAP = 20;

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) { args[a.slice(2)] = argv[i + 1]; i++; }
	}
	return args;
}

function fail(message) {
	console.error(`derive-test-change-tags: ${message}`);
	process.exit(1);
}

// Walks a playwright --list --reporter=json tree, collecting every non-skipped
// leaf spec as { file, title, tags: Set<string> }. `file` is repo-relative
// (playwright reports it relative to testDir, which is ./test/e2e -- prefix
// restores the repo-root-relative form used elsewhere in this pipeline).
// Tags are normalized back to "@:xxx" form (playwright's JSON omits the
// leading "@").
function collectSpecs(suite, out) {
	for (const spec of suite.specs ?? []) {
		// Exclude a spec only if EVERY test run is statically skipped. Under the
		// single `--project e2e-electron` listing this script uses there's one
		// run per spec, so .every and .some coincide; .every is the safer
		// semantic if this is ever pointed at a multi-project listing (a spec
		// skipped in one project but live in another should still be covered).
		const tests = spec.tests ?? [];
		const skipped = tests.length > 0 && tests.every(t => t.expectedStatus === 'skipped');
		if (skipped) { continue; }
		out.push({
			file: `test/e2e/${suite.file}`,
			title: spec.title,
			tags: new Set((spec.tags ?? []).map(t => `@${t}`)),
		});
	}
	for (const child of suite.suites ?? []) { collectSpecs(child, out); }
}

function listAllSpecs(listJsonPath) {
	let raw;
	if (listJsonPath) {
		raw = readFileSync(listJsonPath, 'utf8');
	} else {
		try {
			raw = execFileSync(
				'npx',
				['playwright', 'test', '--list', '--project', 'e2e-electron', '--reporter=json'],
				{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
			);
		} catch (e) {
			fail(`playwright test --list failed: ${e.message}`);
		}
	}
	const json = JSON.parse(raw);
	const specs = [];
	for (const suite of json.suites ?? []) { collectSpecs(suite, specs); }
	return specs;
}

// True set-union cost: how many specs, not already in `alreadySelectedIds`,
// would `tagSubset` additionally select. Not a sum of per-tag counts -- two
// candidate tags can both match the same spec, and summing would double-count it.
function additionalCost(tagSubset, idsByTag, alreadySelectedIds) {
	const union = new Set();
	for (const tag of tagSubset) {
		for (const id of idsByTag.get(tag) ?? []) { union.add(id); }
	}
	let cost = 0;
	for (const id of union) { if (!alreadySelectedIds.has(id)) { cost++; } }
	return cost;
}

function covers(tagSubset, touchedUncovered) {
	const chosen = new Set(tagSubset);
	return touchedUncovered.every(s => [...s.tags].some(t => chosen.has(t)));
}

function bruteForceMinCover(candidates, touchedUncovered, idsByTag, alreadySelectedIds) {
	let bestSet = null;
	let bestCost = Infinity;
	const n = candidates.length;
	for (let mask = 1; mask < (1 << n); mask++) {
		const subset = candidates.filter((_, i) => mask & (1 << i));
		if (!covers(subset, touchedUncovered)) { continue; }
		const cost = additionalCost(subset, idsByTag, alreadySelectedIds);
		if (cost < bestCost || (cost === bestCost && (!bestSet || subset.length < bestSet.length))) {
			bestCost = cost;
			bestSet = subset;
		}
	}
	return (bestSet ?? []).sort();
}

// Greedy weighted set-cover fallback for pathologically large candidate sets:
// repeatedly pick the tag that covers the most still-uncovered touched tests
// per unit of marginal additional cost, until everything is covered.
function greedyMinCover(candidates, touchedUncovered, idsByTag, alreadySelectedIds) {
	let remaining = [...touchedUncovered];
	const chosen = [];
	while (remaining.length > 0) {
		let bestTag = null;
		let bestScore = -1;
		const baseCost = additionalCost(chosen, idsByTag, alreadySelectedIds);
		for (const tag of candidates) {
			if (chosen.includes(tag)) { continue; }
			const newlyCovered = remaining.filter(s => s.tags.has(tag)).length;
			if (newlyCovered === 0) { continue; }
			const marginalCost = additionalCost([...chosen, tag], idsByTag, alreadySelectedIds) - baseCost;
			const score = newlyCovered / Math.max(1, marginalCost);
			if (score > bestScore) { bestScore = score; bestTag = tag; }
		}
		if (!bestTag) { break; } // shouldn't happen: candidates is exhaustive over `remaining`'s own tags
		chosen.push(bestTag);
		remaining = remaining.filter(s => !s.tags.has(bestTag));
	}
	return chosen.sort();
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args['changed-files']) { fail('--changed-files is required'); }

	const changedFiles = readFileSync(args['changed-files'], 'utf8')
		.split('\n').map(l => l.trim()).filter(Boolean);
	const touchedFiles = [...new Set(changedFiles.filter(f => TOUCHED_FILE_RE.test(f)))];
	if (touchedFiles.length === 0) { return; }

	const selected = new Set((args['selected-tags'] ?? '').split(',').map(t => t.trim()).filter(Boolean));
	// null = no allowlist (all tags eligible); a non-empty Set = only these tags
	// may be selected as a cover. See --feature-tags in the header. An empty or
	// missing value is treated as null, NOT an empty Set: an empty Set is truthy
	// and would make every tag ineligible, silently killing all derivation.
	const featureTags = (args['feature-tags'] ?? '').split(',').map(t => t.trim()).filter(Boolean);
	const featureAllow = featureTags.length > 0 ? new Set(featureTags) : null;
	const allSpecs = listAllSpecs(args['list-json']);

	const specId = (s, i) => `${s.file}::${i}`;
	const touchedUncovered = [];
	for (const file of touchedFiles) {
		const specsInFile = allSpecs.filter(s => s.file === file);
		for (const spec of specsInFile) {
			if (spec.tags.size === 0) {
				console.error(`derive-test-change-tags: ${file} has no declared tags for "${spec.title}" -- add tags or tag the PR body manually.`);
				continue;
			}
			// Already covered? Check against the spec's ORIGINAL tags: if a
			// platform tag it carries is already selected (e.g. author added
			// @:win), the test genuinely runs in that lane -- nothing to add.
			const covered = [...spec.tags].some(t => selected.has(t));
			if (covered) { continue; }
			// Restrict the cover candidates to feature tags. A spec left with no
			// eligible tag (only platform/special tags, e.g. a @:win-only test)
			// can't be auto-covered -- warn like the untagged case rather than
			// silently miss it or select a lane-triggering tag.
			const eligible = featureAllow ? [...spec.tags].filter(t => featureAllow.has(t)) : [...spec.tags];
			if (eligible.length === 0) {
				console.error(`derive-test-change-tags: ${file} "${spec.title}" is tagged only with platform/non-feature tags (${[...spec.tags].join(', ')}) -- add a feature tag or tag the PR body manually.`);
				continue;
			}
			touchedUncovered.push({ ...spec, tags: new Set(eligible) });
		}
	}
	if (touchedUncovered.length === 0) { return; }

	const candidates = [...new Set(touchedUncovered.flatMap(s => [...s.tags]))].sort();

	const idsByTag = new Map();
	for (const tag of candidates) {
		const ids = new Set();
		allSpecs.forEach((s, i) => { if (s.tags.has(tag)) { ids.add(specId(s, i)); } });
		idsByTag.set(tag, ids);
	}
	const alreadySelectedIds = new Set();
	allSpecs.forEach((s, i) => { if ([...s.tags].some(t => selected.has(t))) { alreadySelectedIds.add(specId(s, i)); } });

	const best = candidates.length <= CANDIDATE_CAP
		? bruteForceMinCover(candidates, touchedUncovered, idsByTag, alreadySelectedIds)
		: greedyMinCover(candidates, touchedUncovered, idsByTag, alreadySelectedIds);

	for (const tag of best) { console.log(tag); }
}

main();
