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
 * Instead, every candidate command id extracted from a skill file -- every
 * `{{command:}}` directive, plus prose mentions matching a known prefix (see
 * `extractCandidates`) -- must either fall under an extension-owned prefix
 * (`python.`, `shiny.`), each checked against its own ground truth in a
 * dedicated test below, or be *derivable* from the `src/vs/workbench` source
 * text, either because:
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

/**
 * Prefixes routed to the workbench source scan. The gate is doing real work
 * for *prose* mentions, where a dotted token may just as well be a setting
 * key or a file name; for `{{command:}}` directives the directive-coverage
 * test below keeps this list (plus `EXTENSION_PREFIXES`) exhaustive.
 * `vscode.` is here because the skill documents `vscode.open`: not every
 * command the skill names is Positron's own, and an upstream rename would
 * break the skill just as surely as a Positron one.
 */
const ALLOWED_PREFIXES = ['positron.', 'positronAssistant.', 'positronPackages.', 'positronSettings.', 'positronVariables.', 'vscode.', 'workbench.'];

/**
 * Id prefixes owned by extensions rather than `src/vs/workbench`. Each has
 * its own ground-truth test below (extension manifest or pinned snapshot)
 * instead of the workbench source scan. `positron.runApp.` overlaps the
 * workbench-scanned `positron.` prefix, so the workbench test excludes these
 * before scanning.
 */
const EXTENSION_PREFIXES = ['python.', 'shiny.', 'positron.runApp.'];

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

/** Every `{{command:<id>}}` expansion directive across the templates, unfiltered. */
function extractDirectives(skills: readonly SkillFile[]): Candidate[] {
	const candidates: Candidate[] = [];
	const directivePattern = /\{\{command:([^}]+)\}\}/g;
	for (const skill of skills) {
		let match: RegExpExecArray | null;
		directivePattern.lastIndex = 0;
		while ((match = directivePattern.exec(skill.content))) {
			candidates.push({ id: match[1].trim(), skillName: skill.name });
		}
	}
	return candidates;
}

/**
 * Every command id a template references whose id begins with one of
 * `prefixes`, from two sources:
 *
 * 1. `{{command:<id>}}` expansion directives -- unambiguous command
 *    references. The directive-coverage test below asserts every directive
 *    falls under *some* checked prefix, so the filter here cannot silently
 *    drop coverage for a new command family whose prefix nobody remembered to
 *    add (which is exactly what happened to `positronPackages.*`).
 * 2. Backtick-delimited, dotted-identifier-shaped tokens -- prose mentions,
 *    where the prefix gate is needed because a dotted token may be a setting
 *    key or file name instead.
 */
function extractCandidates(skills: readonly SkillFile[], prefixes: readonly string[]): Candidate[] {
	const candidates: Candidate[] = extractDirectives(skills);
	const backtickPattern = /`([^`]+)`/g;
	for (const skill of skills) {
		// Drop fenced code blocks before the inline-backtick scan: a ``` fence
		// is an odd number of backticks, so leaving it in shifts every
		// subsequent pairing and silently unmatches the rest of the file.
		const prose = stripFencedCodeBlocks(skill.content);
		let match: RegExpExecArray | null;
		backtickPattern.lastIndex = 0;
		while ((match = backtickPattern.exec(prose))) {
			const token = match[1];
			if (CANDIDATE_ID_PATTERN.test(token)) {
				candidates.push({ id: token, skillName: skill.name });
			}
		}
	}
	return candidates.filter(candidate => prefixes.some(prefix => candidate.id.startsWith(prefix)));
}

/** Remove ```-fenced code blocks, keeping every line outside them. */
function stripFencedCodeBlocks(content: string): string {
	const kept: string[] = [];
	let inFence = false;
	for (const line of content.split('\n')) {
		if (line.trimStart().startsWith('```')) {
			inFence = !inFence;
			continue;
		}
		if (!inFence) {
			kept.push(line);
		}
	}
	return kept.join('\n');
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

/**
 * The `shiny.*` command and setting ids the skills rely on, verified by hand
 * against the shiny-vscode release pinned as `posit.shiny` in product.json.
 * The skills document these ids by hand (the extension lives out of repo, so
 * nothing generates them), and this snapshot is the drift guard: when the pin
 * is bumped, the version assertion below fails until someone confirms each id
 * below still exists in the new release's `contributes.commands` /
 * `contributes.configuration` (`package.json` at that tag of
 * https://github.com/posit-dev/shiny-vscode) and updates `verifiedAgainst`.
 * Only ids a skill template names belong here.
 */
const SHINY_COMMANDS_SNAPSHOT = {
	verifiedAgainst: '1.4.2',
	commandIds: [
		'shiny.python.runApp',
		'shiny.python.debugApp',
		'shiny.r.runApp',
		'shiny.stopApp',
	],
	settingIds: [
		'shiny.previewType',
	],
};

/** Every id in the shiny snapshot, command and setting alike. */
const SHINY_SNAPSHOT_IDS = [...SHINY_COMMANDS_SNAPSHOT.commandIds, ...SHINY_COMMANDS_SNAPSHOT.settingIds];

function reportDrift(unresolved: readonly Candidate[], where: string): void {
	if (unresolved.length > 0) {
		const lines = unresolved.map(c => `  - \`${c.id}\` (from ${c.skillName})`);
		expect.fail(
			`${unresolved.length} command id(s) named in a skill file have no match ` +
			`in ${where}. This usually means a command was renamed or removed but the ` +
			`skill documenting it was not updated:\n${lines.join('\n')}`
		);
	}
}

describe('agent skill / command drift', () => {
	it('every command id named in a skill file is derivable from workbench source', () => {
		// Extension-owned prefixes overlap `positron.` (positron.runApp.*), so
		// exclude them here; their manifest tests below are the ground truth.
		const candidates = extractCandidates(skillFiles, ALLOWED_PREFIXES)
			.filter(candidate => !EXTENSION_PREFIXES.some(prefix => candidate.id.startsWith(prefix)));
		const unresolved = candidates.filter(candidate => !isResolvable(candidate.id));
		reportDrift(unresolved, `src/vs/workbench (literal or ${'${CONST}'}.suffix template)`);
	});

	it('every positron.runApp.* id named in a skill file appears in the positron-run-app manifest', () => {
		// These are setting keys (and any future commands) declared in the
		// run-app extension's manifest; a literal search covers both.
		const runAppManifest = fs.readFileSync(
			path.join(REPO_ROOT, 'extensions', 'positron-run-app', 'package.json'), 'utf8');
		const candidates = extractCandidates(skillFiles, ['positron.runApp.']);
		const unresolved = candidates.filter(c => !runAppManifest.includes(`"${c.id}"`));
		reportDrift(unresolved, 'extensions/positron-run-app/package.json');
	});

	it('every python.* command id named in a skill file is contributed by positron-python', () => {
		// The Python extension declares its commands in contributes.commands, so a
		// literal search of its manifest is the ground truth for these ids.
		const pythonManifest = fs.readFileSync(
			path.join(REPO_ROOT, 'extensions', 'positron-python', 'package.json'), 'utf8');
		const candidates = extractCandidates(skillFiles, ['python.']);
		const unresolved = candidates.filter(c => !pythonManifest.includes(`"command": "${c.id}"`));
		reportDrift(unresolved, 'extensions/positron-python/package.json');
	});

	it('every shiny.* id named in a skill file exists in the pinned shiny-vscode version', () => {
		const candidates = extractCandidates(skillFiles, ['shiny.']);
		const known = new Set(SHINY_SNAPSHOT_IDS);
		const unresolved = candidates.filter(c => !known.has(c.id));
		reportDrift(unresolved, `the shiny-vscode ${SHINY_COMMANDS_SNAPSHOT.verifiedAgainst} snapshot in this test`);
	});

	// A snapshot entry is a hand-verification burden at every pin bump; one no
	// template references anymore is pure staleness and should be deleted.
	it('every shiny snapshot id is still referenced by some template', () => {
		const referenced = new Set(extractCandidates(skillFiles, ['shiny.']).map(candidate => candidate.id));
		const stale = SHINY_SNAPSHOT_IDS.filter(id => !referenced.has(id));
		expect(stale).toEqual([]);
	});

	it('the shiny command snapshot has been verified against the posit.shiny version pinned in product.json', () => {
		const product = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'product.json'), 'utf8')) as {
			bootstrapExtensions?: { name: string; version: string }[];
		};
		const shiny = product.bootstrapExtensions?.find(extension => extension.name === 'posit.shiny');
		expect(shiny, 'posit.shiny bootstrap pin not found in product.json').toBeDefined();
		if (shiny!.version !== SHINY_COMMANDS_SNAPSHOT.verifiedAgainst) {
			expect.fail(
				`product.json pins posit.shiny ${shiny!.version}, but the positron-commands skill's ` +
				`shiny command ids were last verified against ${SHINY_COMMANDS_SNAPSHOT.verifiedAgainst}. ` +
				`To fix (about a minute): open package.json at the v${shiny!.version} tag of ` +
				`https://github.com/posit-dev/shiny-vscode, confirm each id in SHINY_COMMANDS_SNAPSHOT ` +
				`(in this test file) still exists in contributes.commands, then set verifiedAgainst to ` +
				`'${shiny!.version}'. If an id was renamed or removed, update the skill templates under ` +
				`extensions/positron-skills/templates that document it.`
			);
		}
	});

	// Guards against a broken path/glob calculation making the tests above pass vacuously.
	it('found skill files and extracted a plausible number of candidate ids', () => {
		expect(skillFiles.length).toBeGreaterThan(0);
		expect(extractCandidates(skillFiles, ALLOWED_PREFIXES).length).toBeGreaterThanOrEqual(10);
		expect(extractCandidates(skillFiles, ['python.']).length).toBeGreaterThanOrEqual(3);
		expect(extractCandidates(skillFiles, ['shiny.']).length).toBeGreaterThanOrEqual(3);
	});

	// A directive is a command reference by definition, so every one must fall
	// under a prefix some test above checks -- otherwise a new command family
	// would be silently uncovered.
	it('every {{command:}} directive id falls under a checked prefix', () => {
		const checked = [...ALLOWED_PREFIXES, ...EXTENSION_PREFIXES];
		const uncovered = extractDirectives(skillFiles)
			.filter(candidate => !checked.some(prefix => candidate.id.startsWith(prefix)));
		expect(uncovered).toEqual([]);
	});
});
