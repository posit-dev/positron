/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Guards the frontmatter of every skill template against the limits Posit
 * Assistant enforces when it loads a skill.
 *
 * Why this exists: Assistant validates frontmatter in
 * `packages/core/src/skill/skill-loader.ts` and throws `SkillValidationError`
 * on a violation. Its registry catches that error *per skill*, logs it at warn
 * level, and carries on. So a template that breaks one of these rules does not
 * fail loudly -- the skill silently does not exist, and the only symptom is a
 * line in Assistant's log. Nothing else on the Positron side would notice, so
 * the check has to live here.
 *
 * The limits below mirror that file. They are duplicated rather than imported
 * because Assistant is a separate repository; if they drift, this test gets
 * stricter or looser than reality, which is why the numbers carry their source.
 */

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_FILE_DIR, '../../../../../../..');
const SKILLS_ROOT = path.join(REPO_ROOT, 'extensions', 'positron-skills', 'templates');

/** Mirrors `MAX_NAME_LENGTH` in Assistant's skill-loader.ts. */
const MAX_NAME_LENGTH = 64;
/** Mirrors `MAX_DESCRIPTION_LENGTH` in Assistant's skill-loader.ts. */
const MAX_DESCRIPTION_LENGTH = 1024;
/** Mirrors `SKILL_NAME_REGEX` in Assistant's skill-loader.ts. */
const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface SkillFrontmatter {
	/** Directory name under the templates root, e.g. `positron-commands`. */
	readonly directoryName: string;
	/** Path relative to the repo root, for failure messages. */
	readonly relativePath: string;
	readonly name?: string;
	readonly description?: string;
}

/**
 * Extracts `name` and `description` from a SKILL.md's frontmatter the way
 * Assistant's parser does, which is not the way YAML does.
 *
 * Assistant hand-rolls its frontmatter parsing. For a block scalar it treats
 * `>` and `|` identically: continuation lines are collected *raw* and joined
 * with a newline, with no folding and no dedent (contrary to the YAML spec, but
 * it is what runs). The upshot is that every line's leading indentation counts
 * against `MAX_DESCRIPTION_LENGTH`, so measuring folded prose would understate
 * the length by the size of the indentation and let a template through that
 * Assistant then rejects. Hence this deliberately literal re-implementation.
 * @param content The template's full text.
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
	const lines = content.replace(/\r\n?/g, '\n').split('\n');
	if (lines[0]?.trim() !== '---') {
		return {};
	}

	const fields: Record<string, string> = {};
	let currentKey: string | undefined;
	let blockLines: string[] = [];

	const flush = () => {
		if (currentKey !== undefined) {
			fields[currentKey] = blockLines.join('\n');
		}
		currentKey = undefined;
		blockLines = [];
	};

	for (const line of lines.slice(1)) {
		if (line.trim() === '---') {
			break;
		}
		const keyValue = /^(\w[\w-]*):\s*(.*)$/.exec(line);
		if (keyValue) {
			flush();
			const [, key, rawValue] = keyValue;
			const value = rawValue.trim();
			if (value === '>' || value === '|' || value === '') {
				currentKey = key;
			} else {
				fields[key] = value.replace(/^["']|["']$/g, '');
			}
			continue;
		}
		if (currentKey !== undefined && line.trim()) {
			blockLines.push(line);
		}
	}
	flush();

	return { name: fields['name'], description: fields['description'] };
}

/** Every `<name>/SKILL.md` one level under the templates root. */
const skills: SkillFrontmatter[] = fs.existsSync(SKILLS_ROOT)
	? fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => path.join(SKILLS_ROOT, entry.name, 'SKILL.md'))
		.filter(skillPath => fs.existsSync(skillPath))
		.map(skillPath => ({
			directoryName: path.basename(path.dirname(skillPath)),
			relativePath: path.relative(REPO_ROOT, skillPath),
			...parseFrontmatter(fs.readFileSync(skillPath, 'utf8')),
		}))
	: [];

/** Matches the target of a `{{skill_dir}}/...` link, capturing the path after the slash. */
const SKILL_DIR_LINK = /\{\{skill_dir\}\}\/([^)\s]+)/g;

interface SkillLinks {
	readonly directoryName: string;
	/** Every markdown file in the skill, relative to its directory, POSIX-separated. */
	readonly presentPaths: readonly string[];
	/** Every `{{skill_dir}}` target named anywhere in the skill, with the file that named it. */
	readonly links: readonly { readonly target: string; readonly from: string }[];
	/** The `{{skill_dir}}` targets named by `SKILL.md` itself -- the router. */
	readonly routedPaths: readonly string[];
}

/** Recursively collects markdown paths under `dir`, relative to it, POSIX-separated. */
function collectMarkdownPaths(dir: string, prefix = ''): string[] {
	const result: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			result.push(...collectMarkdownPaths(path.join(dir, entry.name), relative));
		} else if (entry.name.endsWith('.md')) {
			result.push(relative);
		}
	}
	return result;
}

function readLinks(target: string): string[] {
	const found: string[] = [];
	let match: RegExpExecArray | null;
	SKILL_DIR_LINK.lastIndex = 0;
	while ((match = SKILL_DIR_LINK.exec(target))) {
		found.push(match[1]);
	}
	return found;
}

const skillLinks: SkillLinks[] = skills.map(skill => {
	const skillDir = path.join(SKILLS_ROOT, skill.directoryName);
	const presentPaths = collectMarkdownPaths(skillDir);
	const links = presentPaths.flatMap(from =>
		readLinks(fs.readFileSync(path.join(skillDir, from), 'utf8')).map(target => ({ target, from })),
	);
	return {
		directoryName: skill.directoryName,
		presentPaths,
		links,
		routedPaths: links.filter(link => link.from === 'SKILL.md').map(link => link.target),
	};
});

describe('agent skill templates', () => {
	// Guards against a broken path calculation making every test below pass
	// vacuously, the same way the drift test guards its own corpus.
	it('found at least one skill template', () => {
		expect(skills.length).toBeGreaterThan(0);
	});

	it.each(skills)('$directoryName has a description within Assistant\'s limit', skill => {
		expect(skill.description, `${skill.relativePath} has no description`).toBeDefined();
		const length = skill.description!.length;
		expect(
			length,
			`${skill.relativePath}: description is ${length} characters, over Assistant's ` +
			`${MAX_DESCRIPTION_LENGTH}-character limit, so the skill would silently fail to ` +
			`load. Note this counts the indentation of each line in the block scalar, ` +
			`not just the prose.`,
		).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
	});

	it.each(skills)('$directoryName has a name matching its directory', skill => {
		// Assistant rejects a mismatch outright, so a rename that misses one of
		// the two sides takes the skill out of service.
		expect(skill.name, `${skill.relativePath} has no name`).toBe(skill.directoryName);
		expect(skill.name!.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
		expect(skill.name).toMatch(SKILL_NAME_REGEX);
	});

	it.each(skills)('$directoryName expands no directives inside its frontmatter', skill => {
		// The length check above measures the template, but Assistant measures
		// the generated output. Those are the same only while no `{{...}}`
		// directive appears in frontmatter -- one that expanded to command
		// metadata could push a passing template over the limit at runtime.
		const frontmatter = `${skill.name ?? ''}\n${skill.description ?? ''}`;
		expect(
			frontmatter,
			`${skill.relativePath}: frontmatter contains a {{...}} directive. The length ` +
			`check above measures the template, so it no longer bounds the generated output.`,
		).not.toMatch(/\{\{/);
	});

	it.each(skillLinks)('$directoryName links only to files that exist', skill => {
		// A `{{skill_dir}}` link expands to a real path on disk that the model is
		// told to read. If the file isn't there the read simply returns nothing,
		// so a typo or a rename costs the model a whole reference file with no
		// error anywhere.
		const present = new Set(skill.presentPaths);
		const broken = skill.links.filter(link => !present.has(link.target));
		expect(
			broken.map(link => `${link.target} (linked from ${link.from})`),
			`${skill.directoryName}: link target(s) missing from the skill directory`,
		).toEqual([]);
	});

	it.each(skillLinks)('$directoryName routes to every one of its reference files', skill => {
		// SKILL.md is the only file the model reads before choosing where to go
		// next, so a reference file it does not name is a file the model never
		// learns exists.
		const routed = new Set(skill.routedPaths);
		const unrouted = skill.presentPaths.filter(
			file => file !== 'SKILL.md' && !routed.has(file),
		);
		expect(
			unrouted,
			`${skill.directoryName}: reference file(s) present but not linked from SKILL.md`,
		).toEqual([]);
	});
});
