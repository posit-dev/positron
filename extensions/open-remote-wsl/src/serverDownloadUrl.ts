/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The section and key of the unified server download URL setting,
 * `remote.serverDownloadUrlTemplate`.
 *
 * It is registered in core, in
 * `src/vs/workbench/contrib/remote/common/positronRemoteConfiguration.ts`, rather than by
 * any one remote extension, so that it is present whether or not this extension is enabled.
 */
export const UNIFIED_DOWNLOAD_URL_SECTION = 'remote';
export const UNIFIED_DOWNLOAD_URL_KEY = 'serverDownloadUrlTemplate';

/**
 * The part of `vscode.WorkspaceConfiguration.inspect()` that matters here.
 *
 * Declared locally so that this module imports nothing. That keeps it directly unit
 * testable, since a test does not have to stand up the `vscode` module to load it.
 *
 * `defaultValue` is deliberately absent. The extension host fills that field from
 * `config.policy?.value ?? config.default?.value` (see `extHostConfiguration.ts`), so it
 * blends an administrator-enforced value together with the value the manifest ships, and it
 * exposes no `policyValue` that would separate them. Reading it would mean treating the
 * shipped CDN default as a deliberate choice, which is the thing this function exists to
 * avoid. Enforced settings reach Positron through `POSITRON_ENFORCED_SETTINGS`, which is a
 * Posit Workbench mechanism, and all three remote extensions are `"extensionKind": ["ui"]`
 * desktop-only features that a Workbench session never runs. So there is no enforced value
 * to lose here. Please do not "fix" this by folding `defaultValue` into the chain.
 */
export interface IInspectedValue {
	globalValue?: string;
	workspaceValue?: string;
	workspaceFolderValue?: string;
}

/**
 * Picks the server download URL template the user configured, or `undefined` when they
 * configured neither setting.
 *
 * The deprecated setting (`remote.WSL.serverDownloadUrlTemplate`) comes first, so that anyone who
 * already set it keeps the behavior they chose.
 *
 * Both settings are read with `inspect()` rather than `get()` because the deprecated one
 * ships a non-empty default: `get()` cannot tell "the user asked for the CDN URL" apart from
 * "the user asked for nothing", and only the second case may fall through to `product.json`,
 * which is how a local or dev build downloads a server that matches it.
 *
 * Returning `undefined` leaves the caller's existing fall-through to `product.json` and then
 * to a hardcoded default in place.
 */
export function pickConfiguredDownloadUrlTemplate(
	legacy: IInspectedValue | undefined,
	unified: IInspectedValue | undefined
): string | undefined {
	return chosenByUser(legacy) || chosenByUser(unified) || undefined;
}

/**
 * Returns the value the user set for a setting, most specific scope first, matching how VS
 * Code itself resolves one. Both settings are application scoped today, so in practice only
 * `globalValue` is ever set.
 */
function chosenByUser(inspected: IInspectedValue | undefined): string | undefined {
	return inspected?.workspaceFolderValue || inspected?.workspaceValue || inspected?.globalValue || undefined;
}
