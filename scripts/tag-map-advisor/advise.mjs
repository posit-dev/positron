#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Asks Claude for likely e2e tags for each dir in MISSING_DIRS_FILE, using the
// existing map as precedent and each dir's file listing as context. Output:
// { "<dir>": { "tags": ["@:x", ...], "reason": "..." } } -- reason is shown in
// the PR/summary for reviewers.
//
// Never blocks the workflow: any failure (missing env var, API error, bad
// response) falls back to an empty advisory, since a human reviews the PR
// anyway. apply-test-tag-map-fixes.mjs drops any tag not in VALID_TAGS_FILE,
// so a hallucination can't reach the map.
//
// Env in: MISSING_DIRS_FILE, VALID_TAGS_FILE, MAP_FILE, REPO_ROOT, OUTPUT_FILE,
// ANTHROPIC_API_KEY (optional MODEL). See test-tag-map-check-weekly.yml.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

const MISSING_DIRS_FILE = process.env.MISSING_DIRS_FILE;
const VALID_TAGS_FILE = process.env.VALID_TAGS_FILE;
const MAP_FILE = process.env.MAP_FILE;
const REPO_ROOT = process.env.REPO_ROOT;
const MODEL = process.env.MODEL || 'claude-haiku-4-5-20251001';
const OUTPUT_FILE = process.env.OUTPUT_FILE;

// Per-dir file cap: enough to infer a feature area without pulling a huge tree
// (some dirs have thousands of files).
const FILES_PER_DIR = 40;

function emptyAdvisory() {
	return { tags: [], reason: '' };
}

function writeOutput(advisories) {
	writeFileSync(OUTPUT_FILE, JSON.stringify(advisories, null, 2));
	const nonEmpty = Object.values(advisories).filter(v => v.tags.length > 0).length;
	console.log(`Wrote ${Object.keys(advisories).length} advisory(-ies) (${nonEmpty} non-empty) to ${OUTPUT_FILE}`);
}

function listFiles(dir) {
	try {
		const out = execFileSync('find', [dir, '-type', 'f'], { cwd: REPO_ROOT, encoding: 'utf8' });
		return out.split('\n').filter(Boolean).slice(0, FILES_PER_DIR);
	} catch {
		return [];
	}
}

function extractJson(text) {
	// Strip a code fence if present, then take the outermost {...} block --
	// tolerant of a stray preamble the prompt asked the model to omit.
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = fenced ? fenced[1] : text;
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) { throw new Error('no JSON object found in model response'); }
	return JSON.parse(body.slice(start, end + 1));
}

async function main() {
	const missingDirs = JSON.parse(readFileSync(MISSING_DIRS_FILE, 'utf8'));
	const emptyAdvisories = Object.fromEntries(missingDirs.map(d => [d, emptyAdvisory()]));

	if (missingDirs.length === 0) {
		writeOutput({});
		return;
	}
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error('ANTHROPIC_API_KEY not set; leaving an empty advisory for all missing dirs.');
		writeOutput(emptyAdvisories);
		return;
	}

	const validTags = readFileSync(VALID_TAGS_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
	const existingMap = readFileSync(MAP_FILE, 'utf8');
	const dirListings = missingDirs.map(dir => `${dir}\n${listFiles(dir).map(f => `  ${f}`).join('\n') || '  (no tracked files found)'}`).join('\n\n');

	const prompt = `You are helping maintain test-tag-paths-map.json, which maps Positron source directories to e2e test tags (defined in test-tags.ts). A tag groups the e2e tests that exercise a feature; a dir maps to [] when it has no dedicated e2e coverage.

Here is the current map, for precedent on how granular and how conservative to be (many dirs legitimately map to []; do not force a tag just to avoid an empty array):

${existingMap}

Valid tags (use ONLY these, exactly as written, or an empty array):
${validTags.join(', ')}

The following dirs are missing from the map. For each, a file listing is given (repo-relative paths, truncated to ${FILES_PER_DIR} entries). Advise on the most likely tag(s) based on the dir's name, its place in the file tree, and its file names. If nothing in the valid tag list plausibly fits, or you are not confident, use an empty array -- an empty array is a normal, correct advisory, not a failure.

${dirListings}

Respond with ONLY a JSON object mapping each dir (exactly as given, including the trailing slash) to an object { "tags": [...], "reason": "..." }. "reason" is a 1-2 sentence explanation of why those tags fit (or why you chose an empty array) -- write it for someone reviewing the advisory, not for yourself. No prose outside the JSON, no markdown fence.`;

	const client = new Anthropic();
	let advisories;
	try {
		const message = await client.messages.create({
			model: MODEL,
			max_tokens: 4096,
			messages: [{ role: 'user', content: prompt }],
		});
		const textBlock = message.content.find(b => b.type === 'text');
		if (!textBlock) { throw new Error('no text block in model response'); }
		advisories = extractJson(textBlock.text);
	} catch (e) {
		console.error(`Advising failed (${e.message}); falling back to an empty advisory for all missing dirs.`);
		writeOutput(emptyAdvisories);
		return;
	}

	// Keep only dirs we asked about; a missing or malformed entry becomes an
	// empty advisory rather than being invented or dropped silently.
	const finalAdvisories = {};
	for (const dir of missingDirs) {
		const entry = advisories[dir];
		const tags = Array.isArray(entry?.tags) ? entry.tags : [];
		const reason = typeof entry?.reason === 'string' ? entry.reason : '';
		finalAdvisories[dir] = { tags, reason };
	}
	writeOutput(finalAdvisories);
}

main();
