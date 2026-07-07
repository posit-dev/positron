/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Applies auto-fixable test-tag-paths-map.json drift: removes stale keys and
// appends LLM-advised entries for missing dirs as a new trailing group.
//
// Line-splices rather than JSON round-trips: deletes the stale lines and
// inserts new ones before the closing brace, leaving every other line
// (blank-line grouping included) byte-identical, so the diff is exactly the
// additions and removals. Only complete single-line entries are touched (see
// ENTRY_RE); a multi-line entry is left alone rather than partially deleted.
// As a backstop, the output is parsed and compared against an in-memory
// reference -- any mismatch (e.g. a comma we couldn't add next to a multi-line
// entry) means we refuse to write instead of emitting a broken map.
//
// Usage:
//   node scripts/apply-test-tag-map-fixes.mjs \
//     --map <mapFile> \
//     [--stale <staleKeysJsonFile>] \
//     [--advisory <advisoryJsonFile>] \
//     [--valid-tags <validTagsTextFile>]
//
//   staleKeysJsonFile: JSON array of map keys to remove (from
//     check-test-tag-map.sh --json's "stale" field).
//   advisoryJsonFile: JSON object { "<missing_dir>": { "tags": ["@:tag", ...],
//     "reason": "..." }, ... } (from scripts/tag-map-advisor/advise.mjs;
//     "reason" is ignored here, it's only used for the PR/summary). An empty
//     tags array is a valid advisory (no confident tag).
//   validTagsTextFile: newline-separated valid tag values (from
//     pr-tags-lib.sh's valid_enum_tags). Any advised tag not in this set is
//     dropped with a warning, so a hallucinated tag can never reach the map --
//     worst case a dir is added with fewer tags than advised, never a wrong one.
//
// Prints {"added": [...dirs], "removed": [...keys]} to stdout on success.

import { readFileSync, writeFileSync } from 'node:fs';

// A complete single-line entry: `  "some/dir/": ["@:tag", ...]`, optional
// trailing comma. Group 1 = entry through the `]`, group 2 = the key. A
// multi-line array has no `]` on its opening line, so it never matches.
const ENTRY_RE = /^(\s*"([^"]+)"\s*:\s*\[[^\]]*\])\s*,?\s*$/;

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			args[a.slice(2)] = argv[i + 1];
			i++;
		}
	}
	return args;
}

function readJson(path, fallback) {
	if (!path) { return fallback; }
	return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message) {
	console.error(`apply-test-tag-map-fixes: ${message}`);
	process.exit(1);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.map) { fail('--map is required'); }

	const raw = readFileSync(args.map, 'utf8');
	// Validates the input and gives us the existing keys + the reference the
	// splice is checked against below.
	let reference;
	try {
		reference = JSON.parse(raw);
	} catch (e) {
		fail(`${args.map} is not valid JSON to begin with: ${e.message}`);
	}
	const existingKeys = new Set(Object.keys(reference));

	const staleKeys = new Set(readJson(args.stale, []));
	const advisory = readJson(args.advisory, {});
	const validTags = args['valid-tags']
		? new Set(readFileSync(args['valid-tags'], 'utf8').split('\n').map(s => s.trim()).filter(Boolean))
		: null;

	// Drop the trailing empty string from the final newline; re-added on output.
	const lines = raw.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') { lines.pop(); }

	// Remove: drop each stale entry line. Blank lines, braces, and unrecognized
	// lines stay put, so grouping is preserved with no bookkeeping.
	const removed = [];
	const kept = lines.filter(line => {
		const m = ENTRY_RE.exec(line);
		if (m && staleKeys.has(m[2])) { removed.push(m[2]); return false; }
		return true;
	});
	for (const key of staleKeys) {
		if (!existingKeys.has(key)) { console.error(`Note: stale key already absent, skipping: ${key}`); }
	}

	// Add: build a new trailing group for advised dirs not already mapped,
	// dropping any tag not in the valid set so a hallucinated tag can't land.
	const added = [];
	const finalTagsByDir = {};
	const newEntryLines = [];
	for (const dir of Object.keys(advisory).sort()) {
		if (existingKeys.has(dir) && !staleKeys.has(dir)) {
			console.error(`Note: advised dir already mapped, skipping: ${dir}`);
			continue;
		}
		let tags = Array.isArray(advisory[dir]?.tags) ? advisory[dir].tags : [];
		if (validTags) {
			const dropped = tags.filter(t => !validTags.has(t));
			if (dropped.length > 0) { console.error(`Note: dropped invalid advised tag(s) for ${dir}: ${dropped.join(', ')}`); }
			tags = tags.filter(t => validTags.has(t));
		}
		finalTagsByDir[dir] = tags;
		newEntryLines.push(`  "${dir}": ${JSON.stringify(tags)}`);
		added.push(dir);
	}

	if (added.length === 0 && removed.length === 0) {
		console.log(JSON.stringify({ added, removed }));
		return;
	}

	if (newEntryLines.length > 0) {
		let closeIdx = -1;
		for (let i = kept.length - 1; i >= 0; i--) {
			if (kept[i].trim() === '}') { closeIdx = i; break; }
		}
		if (closeIdx === -1) { fail(`${args.map} has no closing brace; refusing to touch it.`); }
		// Blank line first, to set the new group off from existing entries.
		kept.splice(closeIdx, 0, '', ...newEntryLines);
	}

	// Comma fixup: every entry line gets a trailing comma except the last.
	// Covers both a removed final entry and appended entries in one pass.
	let lastEntryIdx = -1;
	for (let i = 0; i < kept.length; i++) {
		if (ENTRY_RE.test(kept[i])) { lastEntryIdx = i; }
	}
	const output = kept.map((line, i) => {
		const m = ENTRY_RE.exec(line);
		if (!m) { return line; }
		return i === lastEntryIdx ? m[1] : `${m[1]},`;
	}).join('\n') + '\n';

	// Backstop: compare the output against a reference built from parsed JSON +
	// the same operations. A parse failure or mismatch means the splice
	// produced something invalid, so we refuse to write.
	for (const key of removed) { delete reference[key]; }
	for (const dir of added) { reference[dir] = finalTagsByDir[dir]; }

	let actual;
	try {
		actual = JSON.parse(output);
	} catch (e) {
		fail(`generated output is not valid JSON (${e.message}); refusing to write. A stale/neighbouring entry's array may span multiple lines -- fix the map by hand and investigate.`);
	}
	// Key order matches by construction, so a plain stringify compare suffices.
	if (JSON.stringify(actual) !== JSON.stringify(reference)) {
		fail('generated output does not match the expected result; refusing to write. Fix the map by hand and investigate.');
	}

	writeFileSync(args.map, output);
	console.log(JSON.stringify({ added, removed }));
}

main();
