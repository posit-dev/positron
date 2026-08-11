/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * List of extension IDs that conflict with Positron built-in features and are
 * blocked from installation. Please use lower case for everything in here.
 */
export const POSITRON_BLOCKED_EXTENSIONS: readonly string[] = [
	'ikuyadeu.r',
	'reditorsupport.r-lsp',
	'reditorsupport.r',
	'rdebugger.r-debugger',
	'mikhail-arkhipov.r',
	'vscode.r',
	'jeanp413.open-remote-ssh',
	'ms-python.python',
	'ms-python.vscode-python-envs',
	'github.copilot-chat'
];

/**
 * The subset of POSITRON_BLOCKED_EXTENSIONS that Positron ships as an in-tree
 * built-in extension under the same ID. A third-party extension may declare a
 * dependency on one of these and still work, because the built-in satisfies the
 * dependency. Keep in sync with extensions/<dir>/package.json publisher and
 * name; scripts/check-bootstrap-extension-deps.mjs verifies this nightly.
 */
export const POSITRON_BLOCKED_EXTENSIONS_WITH_BUILTIN: readonly string[] = [
	'github.copilot-chat',		// extensions/copilot
	'jeanp413.open-remote-ssh',	// extensions/open-remote-ssh
	'ms-python.python',			// extensions/positron-python
	'vscode.r'					// extensions/r
];

/**
 * Check whether an extension ID is blocked from installation in Positron.
 * @param extensionId Extension ID in publisher.name form
 * @returns true if the extension conflicts with Positron built-in features
 */
export function isBlockedExtension(extensionId: string): boolean {
	return POSITRON_BLOCKED_EXTENSIONS.includes(extensionId.toLowerCase());
}

/**
 * Check whether a declared extension dependency can never be satisfied in
 * Positron: the ID is blocked from installation and Positron does not provide a
 * built-in under that ID. A candidate version that declares such a dependency
 * installs but can never activate (see #15118).
 * @param extensionId Extension ID in publisher.name form
 * @returns true if the dependency can never be satisfied
 */
export function isUnsatisfiableDependency(extensionId: string): boolean {
	const id = extensionId.toLowerCase();
	return POSITRON_BLOCKED_EXTENSIONS.includes(id) && !POSITRON_BLOCKED_EXTENSIONS_WITH_BUILTIN.includes(id);
}
