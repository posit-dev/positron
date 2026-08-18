/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Guards against skill/command drift: a command id named in any markdown
 * template under the `positron-skills` extension that no longer exists (renamed
 * or removed) in `src/vs/workbench`.
 *
 * This deliberately does NOT assert against `CommandsRegistry` -- nothing in a
 * vitest run imports Positron's contribution modules, so the registry is
 * empty (the sibling `agentAllowedCommandsService.vitest.ts` only works
 * because it registers commands by hand in `beforeEach`). It also does NOT
 * assert against `getAgentAllowedCommands()` -- that allowlist is a curated
 * pair of worked examples for the system prompt, not the full set of ids the
 * skills document.
 *
 * Instead, every candidate command id extracted from a skill file must be
 * *derivable* from the `src/vs/workbench` source text, either because:
 *   (a) the id literally appears in the source, or
 *   (b) the id is assembled from a `${CONST}.suffix` template, where `CONST`
 *       is an exported constant whose value is the id's prefix. For example
 *       `workbench.panel.positronPlots.focus` is registered as
 *       `` id: `${POSITRON_PLOTS_VIEW_ID}.focus` `` with
 *       `export const POSITRON_PLOTS_VIEW_ID = 'workbench.panel.positronPlots'`
 *       -- a pure literal search finds zero hits for that id even though it
 *       genuinely exists.
 */

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_FILE_DIR, '../../../../../../..');
const WORKBENCH_SRC_ROOT = path.join(REPO_ROOT, 'src', 'vs', 'workbench');
const SKILLS_ROOT = path.join(REPO_ROOT, 'extensions', 'positron-skills', 'templates');

/** Dotted-identifier shape, e.g. `workbench.action.foo` or `positron.help.lookupHelpTopic`. */
const CANDIDATE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
const ALLOWED_PREFIXES = ['positron.', 'positronVariables.', 'workbench.'];

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Recursively collects every `.ts` file under `dir`, skipping directories named `test`. */
function collectTsFiles(dir: string): string[] {
	const result: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (entry.name === 'test') {
				continue;
			}
			result.push(...collectTsFiles(path.join(dir, entry.name)));
		} else if (entry.isFile() && entry.name.endsWith('.ts')) {
			result.push(path.join(dir, entry.name));
		}
	}
	return result;
}

/**
 * Concatenated text of every non-test `.ts` file under `src/vs/workbench`.
 * Built once and cached at module scope -- this corpus is large, so it must
 * not be rebuilt per assertion.
 */
const sourceCorpus: string = collectTsFiles(WORKBENCH_SRC_ROOT)
	.map(file => fs.readFileSync(file, 'utf8'))
	.join('\n');

interface SkillFile {
	readonly name: string;
	readonly content: string;
}

/** Every markdown file under the templates root, recursively, cached at module load. */
function collectMarkdownFiles(dir: string): string[] {
	const result: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			result.push(...collectMarkdownFiles(full));
		} else if (entry.name.endsWith('.md')) {
			result.push(full);
		}
	}
	return result;
}

/**
 * Every markdown template under the templates root, cached at module load.
 *
 * Recursive on purpose: a skill's command documentation may live in
 * `references/*.md` rather than in `SKILL.md` itself, and scanning only
 * `SKILL.md` would silently check nothing.
 */
const skillFiles: SkillFile[] = fs.existsSync(SKILLS_ROOT)
	? collectMarkdownFiles(SKILLS_ROOT).map(absPath => ({
		name: path.relative(REPO_ROOT, absPath),
		content: fs.readFileSync(absPath, 'utf8'),
	}))
	: [];

interface Candidate {
	readonly id: string;
	readonly skillName: string;
}

/** Backtick-delimited, dotted-identifier-shaped tokens beginning with a known command prefix. */
function extractCandidates(skills: readonly SkillFile[]): Candidate[] {
	const candidates: Candidate[] = [];
	const backtickPattern = /`([^`]+)`/g;
	for (const skill of skills) {
		let match: RegExpExecArray | null;
		backtickPattern.lastIndex = 0;
		while ((match = backtickPattern.exec(skill.content))) {
			const token = match[1];
			if (!CANDIDATE_ID_PATTERN.test(token)) {
				continue;
			}
			if (!ALLOWED_PREFIXES.some(prefix => token.startsWith(prefix))) {
				continue;
			}
			candidates.push({ id: token, skillName: skill.name });
		}
	}
	return candidates;
}

/** Every `export const NAME = '...'` (or `"..."`) binding found in the corpus, name -> string value. */
function extractExportedConstants(corpus: string): Map<string, string> {
	const constants = new Map<string, string>();
	const pattern = /export const ([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[^=]+)?\s*=\s*(['"])((?:(?!\2).)*)\2/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(corpus))) {
		constants.set(match[1], match[3]);
	}
	return constants;
}

const exportedConstants = extractExportedConstants(sourceCorpus);

/**
 * Whether `id` is assembled as `` `${CONST}.suffix` `` for some split of `id`
 * into `prefix` + `.` + `suffix`, where `CONST` is an exported constant whose
 * value equals `prefix`.
 */
function isTemplateComposed(id: string): boolean {
	const parts = id.split('.');
	for (let i = 1; i < parts.length; i++) {
		const prefix = parts.slice(0, i).join('.');
		const suffix = parts.slice(i).join('.');
		// Require a non-identifier boundary after the suffix so e.g. `focus`
		// doesn't spuriously match a template ending in `focusFoo`. Global: several
		// different constants may share the same `.suffix` (e.g. multiple
		// `${SOME_VIEW_ID}.focus` registrations), so every occurrence must be
		// checked rather than just the first.
		const templatePattern = new RegExp('\\$\\{(\\w+)\\}\\.' + escapeRegExp(suffix) + '(?![A-Za-z0-9_])', 'g');
		let match: RegExpExecArray | null;
		while ((match = templatePattern.exec(sourceCorpus))) {
			if (exportedConstants.get(match[1]) === prefix) {
				return true;
			}
		}
	}
	return false;
}

function isResolvable(id: string): boolean {
	return sourceCorpus.includes(id) || isTemplateComposed(id);
}

describe('agent skill / command drift', () => {
	it('every command id named in a skill file is derivable from workbench source', () => {
		const candidates = extractCandidates(skillFiles);
		const unresolved = candidates.filter(candidate => !isResolvable(candidate.id));

		if (unresolved.length > 0) {
			const lines = unresolved.map(c => `  - \`${c.id}\` (from ${c.skillName})`);
			expect.fail(
				`${unresolved.length} command id(s) named in a skill file have no matching source ` +
				`in src/vs/workbench (literal or ${'${CONST}'}.suffix template). This usually means a ` +
				`command was renamed or removed but the skill documenting it was not updated:\n${lines.join('\n')}`
			);
		}
	});

	// Guards against a broken path/glob calculation making the test above pass vacuously.
	it('found skill files and extracted a plausible number of candidate ids', () => {
		expect(skillFiles.length).toBeGreaterThan(0);
		expect(extractCandidates(skillFiles).length).toBeGreaterThanOrEqual(10);
	});
});
