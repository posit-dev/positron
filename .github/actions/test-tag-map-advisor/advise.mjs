#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Asks Claude to advise on likely e2e tags for each dir in MISSING_DIRS_FILE,
// using the existing map as few-shot precedent and each dir's own file
// listing as context. A single Messages API call (not the Agent SDK) --
// this only needs one round of "here's a directory listing, pick from this
// tag list", not autonomous multi-step exploration.
//
// Never blocks the workflow: a missing env var, an API error, or a
// malformed/incomplete model response all fall back to an empty advisory (no
// tag) for every dir rather than throwing, since a human reviews the
// resulting PR either way -- an empty advisory just means more manual
// follow-up, not broken automation. scripts/apply-test-tag-map-fixes.mjs
// separately drops any advised tag that isn't in VALID_TAGS_FILE, so a
// hallucinated tag can never reach the map even if parsing partially
// succeeds.
//
// Output shape: { "<dir>": { "tags": ["@:x", ...], "reason": "..." } }. The
// reason is surfaced in the PR/summary so a reviewer can sanity-check the
// advisory without re-deriving it themselves.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

const MISSING_DIRS_FILE = process.env.MISSING_DIRS_FILE;
const VALID_TAGS_FILE = process.env.VALID_TAGS_FILE;
const MAP_FILE = process.env.MAP_FILE;
const REPO_ROOT = process.env.REPO_ROOT;
const MODEL = process.env.MODEL || 'claude-haiku-4-5-20251001';
const OUTPUT_FILE = process.env.OUTPUT_FILE;

// Per-dir file listing cap: enough for the model to infer a feature area from
// filenames without pulling in a large tree (some Positron dirs, e.g.
// extensions/positron-python/, have thousands of files).
const FILES_PER_DIR = 40;

function emptyAdvisory() {
	return { tags: [], reason: '' };
}

function writeOutput(advisories) {
	writeFileSync(OUTPUT_FILE, JSON.stringify(advisories, null, 2));
	const nonEmpty = Object.values(advisories).filter(v => v.tags.length > 0).length;
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `advisory-count=${nonEmpty}\n`);
	}
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
	// Strip a markdown code fence if the model wrapped its answer in one,
	// then take the outermost {...} block -- tolerant of a stray preamble
	// sentence even though the prompt asks for JSON only.
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

	// Trust only advisories for dirs we actually asked about, in the exact
	// form we asked -- a model response for a dir we didn't request, or a
	// missing entry, defaults to an empty advisory rather than being invented
	// or dropped silently. Same for a malformed per-dir entry (missing/
	// wrong-typed tags or reason).
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
