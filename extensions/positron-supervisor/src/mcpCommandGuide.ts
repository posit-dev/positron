/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';

/** The skill the supervisor serves to agents as its command guide. */
const GUIDE_SKILL = 'positron-commands';

/**
 * Read the command guide from the first skill root that has it, as markdown
 * pages keyed by their path within the skill (`SKILL.md`,
 * `references/files.md`). Empty when no root has it.
 *
 * The generated pages link to each other by absolute path. An agent reaches
 * them through the supervisor rather than the filesystem, so links are made
 * relative to the skill, which leaves each one naming a page it can ask for.
 */
export async function readCommandGuide(roots: readonly string[]): Promise<Record<string, string>> {
	for (const root of roots) {
		const dir = path.join(root, GUIDE_SKILL);
		const entries = await fs.readdir(dir, { recursive: true }).catch(() => [] as string[]);
		const pages = entries.filter(entry => entry.endsWith('.md'));
		if (!pages.includes('SKILL.md')) {
			continue;
		}
		const guide: Record<string, string> = {};
		for (const page of pages) {
			const text = await fs.readFile(path.join(dir, page), 'utf8');
			guide[page.split(path.sep).join('/')] = text.split(`${dir}/`).join('');
		}
		return guide;
	}
	return {};
}
