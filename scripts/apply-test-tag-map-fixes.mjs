/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Removes stale keys from test-tag-paths-map.json (dirs the map points at that
// no longer match any tracked file). Line-splices rather than JSON round-trips:
// deletes only the stale lines, leaving every other line (blank-line grouping
// included) byte-identical, so the diff is exactly the removals. The output is
// parsed and compared against an in-memory reference before writing; any
// mismatch means we refuse to write instead of emitting a broken map.
//
// Missing dirs are deliberately NOT auto-added -- assigning a tag needs human
// judgment and is handled at PR-review time (see test-tag-map-check-weekly.yml).
//
// Usage:
//   node scripts/apply-test-tag-map-fixes.mjs --map <mapFile> --stale <staleKeysJsonFile>
//
//   staleKeysJsonFile: JSON array of map keys to remove (from
//     check-test-tag-map.sh --json's "stale" field).
//
// Prints {"removed": [...keys]} to stdout on success.

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
	// Validates the input and gives us the reference the splice is checked against.
	let reference;
	try {
		reference = JSON.parse(raw);
	} catch (e) {
		fail(`${args.map} is not valid JSON to begin with: ${e.message}`);
	}
	const existingKeys = new Set(Object.keys(reference));
	const staleKeys = new Set(readJson(args.stale, []));

	// Drop the trailing empty string from the final newline; re-added on output.
	const lines = raw.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') { lines.pop(); }

	// Drop each stale entry line. Blank lines, braces, and unrecognized lines
	// stay put, so grouping is preserved with no bookkeeping.
	const removed = [];
	const kept = lines.filter(line => {
		const m = ENTRY_RE.exec(line);
		if (m && staleKeys.has(m[2])) { removed.push(m[2]); return false; }
		return true;
	});
	for (const key of staleKeys) {
		if (!existingKeys.has(key)) { console.error(`Note: stale key already absent, skipping: ${key}`); }
	}

	if (removed.length === 0) {
		console.log(JSON.stringify({ removed }));
		return;
	}

	// Comma fixup: every entry line gets a trailing comma except the last.
	// Removing the final entry means the new last entry must lose its comma.
	let lastEntryIdx = -1;
	for (let i = 0; i < kept.length; i++) {
		if (ENTRY_RE.test(kept[i])) { lastEntryIdx = i; }
	}
	const output = kept.map((line, i) => {
		const m = ENTRY_RE.exec(line);
		if (!m) { return line; }
		return i === lastEntryIdx ? m[1] : `${m[1]},`;
	}).join('\n') + '\n';

	// Backstop: compare the output against the reference with the same keys
	// removed. A parse failure or mismatch means the splice produced something
	// invalid (e.g. a stale key whose array spanned multiple lines), so we
	// refuse to write.
	for (const key of removed) { delete reference[key]; }

	let actual;
	try {
		actual = JSON.parse(output);
	} catch (e) {
		fail(`generated output is not valid JSON (${e.message}); refusing to write. A stale entry's array may span multiple lines -- fix the map by hand and investigate.`);
	}
	if (JSON.stringify(actual) !== JSON.stringify(reference)) {
		fail('generated output does not match the expected result; refusing to write. Fix the map by hand and investigate.');
	}

	writeFileSync(args.map, output);
	console.log(JSON.stringify({ removed }));
}

main();
