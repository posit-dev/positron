/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Guards the frontmatter of every skill template against Posit Assistant's
 * skill validator, which is the consumer of these files.
 *
 * This exists because the failure is silent and total. When a `SKILL.md` fails
 * validation the Assistant logs one warning to its own output channel and drops
 * the *whole* skill -- every reference file with it -- so the skill simply never
 * appears in the model's skill list. Nothing on the Positron side notices: the
 * files generate cleanly, every `{{command:...}}` directive resolves, and the
 * *Assistant Skills* channel reports success. The only symptom is a model that
 * behaves as though the skill was never written.
 *
 * That is exactly what happened while writing the data connections reference
 * (#15592): a description grown to 1417 characters silently took the skill out,
 * and it was diagnosed only by reading `Platform skill roots: ... -- 0
 * registered` out of the Assistant's log.
 *
 * The limits below mirror that validator. They are duplicated here on purpose --
 * the validator ships inside the Assistant extension, so there is no constant to
 * import -- which means they can drift if the Assistant changes them. Prefer
 * failing here (a build-time nudge to re-check) over shipping a skill that no
 * model can see.
 */

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_FILE_DIR, '../../../../../../..');
const SKILLS_ROOT = path.join(REPO_ROOT, 'extensions', 'positron-skills', 'templates');

/** Longest `description` the Assistant's validator accepts before rejecting the skill. */
const MAX_DESCRIPTION_LENGTH = 1024;

/** Longest `name` the validator accepts. */
const MAX_NAME_LENGTH = 64;

/** The validator's shape for `name`: lowercase, digits, single interior hyphens. */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface SkillFrontmatter {
	/** Skill directory name, which the validator requires `name` to match. */
	readonly directory: string;
	readonly name: string | undefined;
	/** The description as the Assistant's parser reads it, i.e. the string the validator measures. */
	readonly description: string | undefined;
}

/**
 * Reads the `name` and `description` out of a `SKILL.md`'s frontmatter, the way
 * the Assistant's own parser does.
 *
 * Deliberately not a YAML parse, because the validator's isn't either: the
 * Assistant's `parseFrontmatter` (posit-dev/assistant,
 * `packages/core/src/skill/skill-loader.ts`) is a hand-rolled parser that, for
 * a `|` or `>` block scalar, keeps each continuation line as-is -- indentation
 * included -- and joins them with `\n` before trimming. That string is longer
 * than YAML's folded value, so measuring anything else here (real YAML
 * included) under-counts what the validator checks against
 * MAX_DESCRIPTION_LENGTH. Mirroring its exact behavior is the point of this
 * file.
 *
 * The Assistant recognizes only bare `|` and `>` as block-scalar markers.
 * Chomping variants (`>-`, `|-`) are not markers to it: it reads them as the
 * field's literal inline value, silently discarding the block underneath -- so
 * a `>-` marker is treated as inline here too, and asserted against below.
 */
function readFrontmatter(skillMdPath: string): SkillFrontmatter {
	const content = fs.readFileSync(skillMdPath, 'utf8');
	const frontmatter = /^---\n(?<frontmatter>[\s\S]*?)\n---/.exec(content)?.groups?.frontmatter ?? '';
	const lines = frontmatter.split('\n');

	const readField = (field: string): string | undefined => {
		const index = lines.findIndex(line => line.startsWith(`${field}:`));
		if (index === -1) {
			return undefined;
		}
		const inline = lines[index].slice(field.length + 1).trim();
		// Anything other than the two markers the Assistant knows is the value itself.
		if (inline !== '>' && inline !== '|') {
			return inline.replace(/^["']|["']$/g, '');
		}
		// Block scalar: every following indented (or blank) line belongs to this field, up to the
		// next top-level key. Joined raw with newlines and trimmed, the way the Assistant does.
		const continuation: string[] = [];
		for (const line of lines.slice(index + 1)) {
			if (line.trim().length > 0 && !/^[ \t]/.test(line)) {
				break;
			}
			continuation.push(line);
		}
		return continuation.join('\n').trim();
	};

	return {
		directory: path.basename(path.dirname(skillMdPath)),
		name: readField('name'),
		description: readField('description'),
	};
}

/** Every `SKILL.md` under the templates root: one per skill directory. */
const skills: SkillFrontmatter[] = fs.existsSync(SKILLS_ROOT)
	? fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => path.join(SKILLS_ROOT, entry.name, 'SKILL.md'))
		.filter(fs.existsSync)
		.map(readFrontmatter)
	: [];

describe('agent skill frontmatter', () => {
	// Guards against a broken path calculation making every assertion below pass
	// vacuously, the same way the sibling drift test does.
	it('found at least one skill template', () => {
		expect(skills.length).toBeGreaterThan(0);
	});

	it.each(skills.map(skill => [skill.directory, skill] as const))(
		'%s passes the Assistant skill validator',
		(_directory, skill) => {
			expect({
				name: skill.name,
				nameMatchesDirectory: skill.name === skill.directory,
				nameLengthOk: (skill.name?.length ?? 0) <= MAX_NAME_LENGTH,
				nameShapeOk: NAME_PATTERN.test(skill.name ?? ''),
				descriptionLength: skill.description?.length,
				descriptionLengthOk: (skill.description?.length ?? 0) > 0
					&& (skill.description?.length ?? 0) <= MAX_DESCRIPTION_LENGTH,
				// A description starting with `>` or `|` means a block-scalar marker the Assistant
				// doesn't recognize (e.g. the chomping form `>-`): it reads the marker as the literal
				// description and silently discards the block underneath. See readFrontmatter.
				descriptionIsProse: !/^[>|]/.test(skill.description ?? ''),
			}).toEqual({
				name: skill.directory,
				nameMatchesDirectory: true,
				nameLengthOk: true,
				nameShapeOk: true,
				descriptionLength: skill.description?.length,
				descriptionLengthOk: true,
				descriptionIsProse: true,
			});
		},
	);
});
