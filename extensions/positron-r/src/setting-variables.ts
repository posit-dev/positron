/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const WORKSPACE_FOLDER = '${workspaceFolder}';

/**
 * Why a path from a setting could not be resolved.
 * - `noFolder`: the path uses `${workspaceFolder}` and no folder is open.
 * - `unsupported`: the path uses a variable other than `${workspaceFolder}`.
 */
export type UnresolvedReason = 'noFolder' | 'unsupported';

export type SubstitutionResult =
	| { resolved: true; value: string }
	| { resolved: false; variable: string; reason: UnresolvedReason };

/**
 * Replaces `${workspaceFolder}` in a path from a setting.
 *
 * `${workspaceFolder}` is the only supported variable. A path that uses any other `${...}`
 * variable, or uses `${workspaceFolder}` with no folder open, is reported as unresolved
 * rather than returned with the variable left in or replaced by a guess.
 *
 * @param value The path from the setting
 * @param workspaceFolder Path of the first workspace folder, or undefined when no folder is open
 * @returns The substituted path, or the variable that could not be resolved
 */
export function substituteWorkspaceFolder(value: string, workspaceFolder: string | undefined): SubstitutionResult {
	const parts = value.split(WORKSPACE_FOLDER);

	const rest = parts.join('');
	const start = rest.indexOf('${');
	if (start !== -1) {
		const end = rest.indexOf('}', start);
		const variable = end === -1 ? rest.slice(start) : rest.slice(start, end + 1);
		return { resolved: false, variable, reason: 'unsupported' };
	}

	if (parts.length === 1) {
		return { resolved: true, value };
	}
	if (workspaceFolder === undefined) {
		return { resolved: false, variable: WORKSPACE_FOLDER, reason: 'noFolder' };
	}
	return { resolved: true, value: parts.join(workspaceFolder) };
}
