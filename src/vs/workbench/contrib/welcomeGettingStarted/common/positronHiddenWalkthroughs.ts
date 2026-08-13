/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Walkthroughs that Positron never registers.
 *
 * These are upstream VS Code walkthroughs whose content is specific to VS Code
 * and does not describe Positron. Rather than editing each definition in place,
 * which would put Positron changes in the middle of upstream code that churns
 * often, we skip them at the single point where every walkthrough registers.
 * See the guard in `gettingStartedService.ts`.
 *
 * Skipping registration hides a walkthrough everywhere at once: the
 * "Open Walkthrough..." quick pick, the welcome page, and step progress
 * tracking. It also means `workbench.action.openWalkthrough <id>` no longer
 * resolves for these IDs, which is intended.
 *
 * Built-in walkthroughs use a bare ID. Walkthroughs contributed by an extension
 * use `<extensionId>#<walkthroughId>`, which is why the Python entries carry the
 * `ms-python.python#` prefix. Keeping the IDs here rather than in the extension
 * manifest means a future re-sync from upstream cannot silently bring them back.
 *
 * Extension IDs in this list must be written in lower case. See `normalize`.
 */
const HIDDEN_WALKTHROUGH_IDS: ReadonlySet<string> = new Set([
	// Upstream "Get started with VS Code", retitled but never rewritten. Its
	// steps are Copilot setup, a theme picker, and a VS Code video tutorial.
	'Setup',
	// The web variant of the same walkthrough.
	'SetupWeb',
	// Upstream "Learn the Fundamentals". Every string in it says "VS Code".
	'Beginner',
	// "Get Started with Python Development". The VS Code migration walkthrough
	// in positron-python covers the same ground for Positron users.
	'ms-python.python#pythonWelcome',
	// "Get Started with Python for Data Science". Already disabled in the
	// extension manifest with `when: false`; listed here so the full set of
	// hidden walkthroughs lives in one place.
	'ms-python.python#pythonDataScienceWelcome',
	// "GitHub Copilot". Sign-in and feature tour for Copilot, which is not how
	// AI assistance is set up or presented in Positron.
	'github.copilot-chat#copilotWelcome',
]);

/**
 * Puts a walkthrough ID into the form used by {@link HIDDEN_WALKTHROUGH_IDS}.
 *
 * Extension identifiers are case insensitive in VS Code, and the casing an
 * extension declares varies (`ms-python.python` against `GitHub.copilot-chat`),
 * so the extension half is lower cased before matching. The walkthrough half is
 * an arbitrary string chosen by the extension and stays case sensitive, as do
 * the IDs of built-in walkthroughs.
 */
function normalize(id: string): string {
	const separator = id.indexOf('#');
	if (separator === -1) {
		return id;
	}
	return id.slice(0, separator).toLowerCase() + id.slice(separator);
}

/**
 * Whether Positron hides the walkthrough with the given ID.
 *
 * @param id The walkthrough ID. Bare for built-in walkthroughs, or
 * `<extensionId>#<walkthroughId>` for extension contributions.
 */
export function isHiddenWalkthrough(id: string): boolean {
	return HIDDEN_WALKTHROUGH_IDS.has(normalize(id));
}
