/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Applies auto-fixable test-tag-paths-map.json drift: removes stale keys and
// appends LLM-advised entries for missing dirs as a new trailing group.
//
// Written in Node rather than jq/bash because the map is hand-curated with
// blank-line grouping (feature areas separated visually, see the file itself)
// that a `jq` round-trip would flatten. This does line-level text surgery
// instead, so every untouched line is byte-identical in the output -- the
// diff a reviewer sees is exactly the additions/removals, nothing else. The
// result is still validated by parsing it as JSON and comparing it against an
// object built purely in memory (see checkAgainstReference below) before it's
// ever written to disk, so a source-format assumption that stops holding
// (e.g. a future multi-line array entry) fails loudly instead of silently
// corrupting the file.
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

// Splits the map file's body into an ordered list of {key, valueRaw,
// precededByBlank} entries. Bails (returns null) on anything that doesn't
// match the file's established one-entry-per-line convention, rather than
// guessing at an unfamiliar shape.
function parseMapBody(raw) {
	const lines = raw.split('\n');
	// Drop a single trailing empty string from a final newline so index math
	// below lines up with visible file lines.
	if (lines.length > 0 && lines[lines.length - 1] === '') { lines.pop(); }
	if (lines[0].trim() !== '{') { return null; }
	let closeIdx = -1;
	for (let i = lines.length - 1; i >= 1; i--) {
		if (lines[i].trim() === '}') { closeIdx = i; break; }
	}
	if (closeIdx === -1) { return null; }
	const entryPattern = /^(\s*)"([^"]+)":\s*(\[[^[\]]*\]),?\s*$/;
	const entries = [];
	let precededByBlank = false;
	for (let i = 1; i < closeIdx; i++) {
		const line = lines[i];
		if (line.trim() === '') { precededByBlank = true; continue; }
		const m = entryPattern.exec(line);
		if (!m) { return null; }
		entries.push({ indent: m[1], key: m[2], valueRaw: m[3], precededByBlank });
		precededByBlank = false;
	}
	return entries;
}

function serializeMap(entries) {
	const lines = ['{'];
	entries.forEach((entry, i) => {
		if (i > 0 && entry.precededByBlank) { lines.push(''); }
		const comma = i === entries.length - 1 ? '' : ',';
		lines.push(`${entry.indent}"${entry.key}": ${entry.valueRaw}${comma}`);
	});
	lines.push('}');
	return lines.join('\n') + '\n';
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.map) { fail('--map is required'); }

	const raw = readFileSync(args.map, 'utf8');
	const entries = parseMapBody(raw);
	if (!entries) {
		fail(`${args.map} doesn't match the expected one-entry-per-line format; refusing to touch it. Fix manually.`);
	}

	const staleKeys = new Set(readJson(args.stale, []));
	const advisory = readJson(args.advisory, {});
	const validTags = args['valid-tags']
		? new Set(readFileSync(args['valid-tags'], 'utf8').split('\n').map(s => s.trim()).filter(Boolean))
		: null;

	const existingKeys = new Set(entries.map(e => e.key));
	const removed = [];
	// Removing an entry that opened a blank-line-separated group would
	// otherwise silently merge that group with the previous one (the blank
	// line was recorded as "before this entry", which is gone now) -- carry
	// the flag forward onto the next surviving entry so the visual grouping
	// a reviewer sees survives even when the removed key was a group's first.
	const kept = [];
	let pendingBlank = false;
	for (const e of entries) {
		if (staleKeys.has(e.key)) {
			removed.push(e.key);
			pendingBlank = pendingBlank || e.precededByBlank;
			continue;
		}
		kept.push({ ...e, precededByBlank: e.precededByBlank || pendingBlank });
		pendingBlank = false;
	}
	// A stale key that was already removed by an earlier run (or never
	// existed) is not an error -- the caller's drift snapshot may be stale by
	// the time this runs.
	for (const key of staleKeys) {
		if (!existingKeys.has(key)) { console.error(`Note: stale key already absent, skipping: ${key}`); }
	}

	const added = [];
	const newEntries = [];
	for (const dir of Object.keys(advisory).sort()) {
		if (existingKeys.has(dir) && !staleKeys.has(dir)) {
			console.error(`Note: advised dir already mapped, skipping: ${dir}`);
			continue;
		}
		let tags = Array.isArray(advisory[dir]?.tags) ? advisory[dir].tags : [];
		if (validTags) {
			const filtered = tags.filter(t => validTags.has(t));
			const dropped = tags.filter(t => !validTags.has(t));
			if (dropped.length > 0) { console.error(`Note: dropped invalid advised tag(s) for ${dir}: ${dropped.join(', ')}`); }
			tags = filtered;
		}
		newEntries.push({ indent: '  ', key: dir, valueRaw: JSON.stringify(tags), precededByBlank: false });
		added.push(dir);
	}
	if (newEntries.length > 0) { newEntries[0].precededByBlank = true; }

	const finalEntries = [...kept, ...newEntries];
	const output = serializeMap(finalEntries);

	// Validate the textual surgery against a reference built purely from
	// parsed JSON + the same add/remove operations, independent of line
	// formatting. A mismatch means the line-based edit dropped or altered
	// data and must never be written.
	let reference;
	try {
		reference = JSON.parse(raw);
	} catch (e) {
		fail(`${args.map} is not valid JSON to begin with: ${e.message}`);
	}
	for (const key of removed) { delete reference[key]; }
	for (const dir of added) {
		let tags = Array.isArray(advisory[dir]?.tags) ? advisory[dir].tags : [];
		if (validTags) { tags = tags.filter(t => validTags.has(t)); }
		reference[dir] = tags;
	}

	let actual;
	try {
		actual = JSON.parse(output);
	} catch (e) {
		fail(`generated output is not valid JSON: ${e.message}`);
	}
	// Recursively sort object keys (order-independent top-level dir comparison)
	// while leaving array contents and order untouched (tag arrays must compare
	// exactly), then stringify. Deliberately not a `JSON.stringify(obj,
	// Object.keys(obj).sort())` replacer-array trick: that reads as if it might
	// filter nested array elements too, which invites exactly the kind of
	// "does this actually compare tag arrays" doubt this check exists to remove.
	const canonicalize = (value) => {
		if (Array.isArray(value)) { return value.map(canonicalize); }
		if (value !== null && typeof value === 'object') {
			const sorted = {};
			for (const key of Object.keys(value).sort()) { sorted[key] = canonicalize(value[key]); }
			return sorted;
		}
		return value;
	};
	const normalize = (obj) => JSON.stringify(canonicalize(obj));
	if (normalize(actual) !== normalize(reference)) {
		fail('generated output does not match the expected result; refusing to write. This means a source-format assumption in parseMapBody no longer holds -- fix the map by hand and investigate.');
	}

	if (added.length === 0 && removed.length === 0) {
		console.log(JSON.stringify({ added, removed }));
		return;
	}

	writeFileSync(args.map, output);
	console.log(JSON.stringify({ added, removed }));
}

main();
