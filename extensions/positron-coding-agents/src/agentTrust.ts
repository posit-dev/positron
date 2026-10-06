/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';

// Agents ask whether to trust a directory when they start in one they don't
// know, and a menu showing that question discards pasted text. These read the
// agents' own records of the directories they were trusted in. The formats
// are undocumented: when they change, an agent reads as still at its prompt,
// and the prompt goes to a new session rather than being lost.

/**
 * Whether Claude Code is past its folder-trust prompt in a directory, from
 * its `.claude.json`.
 * @param config The contents of `.claude.json`.
 */
export function isPastClaudeCodeTrustPrompt(config: string, directory: string): boolean {
	let projects: Record<string, { hasTrustDialogAccepted?: unknown } | undefined> | undefined;
	try {
		projects = JSON.parse(config)?.projects;
	} catch {
		return false;
	}
	return getSelfAndAncestors(directory).some(candidate => projects?.[candidate]?.hasTrustDialogAccepted === true);
}

/**
 * Whether Codex is past its folder-trust prompt in a directory, from its
 * `config.toml`. Answering the prompt either way adds a project entry.
 * @param config The contents of `config.toml`.
 */
export function isPastCodexTrustPrompt(config: string, directory: string): boolean {
	const projectDirectories = new Set<string>();
	for (const match of config.matchAll(/^\s*\[\s*projects\s*\.\s*(?:(?<basic>"(?:[^"\\]|\\.)*")|'(?<literal>[^']*)')\s*\]/gm)) {
		if (match.groups?.literal !== undefined) {
			projectDirectories.add(match.groups.literal);
			continue;
		}
		try {
			// TOML basic strings use JSON's escapes.
			projectDirectories.add(JSON.parse(match.groups!.basic));
		} catch {
			// Skip a key this can't read.
		}
	}
	return getSelfAndAncestors(directory).some(candidate => projectDirectories.has(candidate));
}

/**
 * A directory and each directory above it. Both agents count trust in a
 * directory as trust in those below it (e.g. a repository's root).
 */
function getSelfAndAncestors(directory: string): string[] {
	const directories = [directory];
	for (let parent = path.dirname(directory); parent !== directories[directories.length - 1]; parent = path.dirname(parent)) {
		directories.push(parent);
	}
	return directories;
}

/**
 * Read an agent's config file and check it.
 * @returns The check's result, or false when the file can't be read: an agent
 *   that hasn't written its config hasn't been through its prompt either.
 */
export function readConfig(file: string, check: (config: string) => boolean): boolean {
	let config: string;
	try {
		config = fs.readFileSync(file, 'utf8');
	} catch {
		return false;
	}
	return check(config);
}
