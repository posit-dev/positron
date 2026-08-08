/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * The canonical setting for Quarto inline output.
 */
const QUARTO_INLINE_OUTPUT_ENABLED_KEY = 'quarto.inlineOutput.enabled';

/**
 * The deprecated alias for {@link QUARTO_INLINE_OUTPUT_ENABLED_KEY}. Positron
 * keeps this key working during the deprecation window.
 */
const POSITRON_QUARTO_INLINE_OUTPUT_ENABLED_KEY = 'positron.quarto.inlineOutput.enabled';

/**
 * The result of inspecting a boolean setting, narrowed to the levels a user can
 * set from the extension host.
 */
interface BooleanInspection {
    globalValue?: boolean;
    workspaceValue?: boolean;
    workspaceFolderValue?: boolean;
}

/**
 * The subset of {@link vscode.WorkspaceConfiguration} needed to resolve a
 * boolean setting. Declared so tests can supply a plain object.
 */
export interface BooleanConfiguration {
    get(section: string, defaultValue: boolean): boolean;
    inspect(section: string): BooleanInspection | undefined;
}

/**
 * Whether a configuration value has been explicitly set at any level, as opposed
 * to falling back to its registered default.
 */
function isConfigurationSet(inspection: BooleanInspection | undefined): boolean {
    return (
        inspection?.globalValue !== undefined ||
        inspection?.workspaceValue !== undefined ||
        inspection?.workspaceFolderValue !== undefined
    );
}

/**
 * Whether Quarto inline output is enabled.
 *
 * Prefers the canonical `quarto.inlineOutput.enabled` key and falls back to the
 * deprecated `positron.quarto.inlineOutput.enabled` alias when the canonical key
 * has not been explicitly set. Both keys are registered with a default of
 * `false`, so `get()` alone cannot tell an explicit `false` from an unset value,
 * but `inspect()` can. This mirrors `getQuartoConfigValue()` in Positron core
 * and `isInlineOutputEnabled()` in the Quarto extension.
 *
 * @param config The configuration to read from, defaulting to the workspace configuration.
 * @returns true if Quarto inline output is enabled.
 */
export function isQuartoInlineOutputEnabled(
    config: BooleanConfiguration = vscode.workspace.getConfiguration(),
): boolean {
    for (const key of [QUARTO_INLINE_OUTPUT_ENABLED_KEY, POSITRON_QUARTO_INLINE_OUTPUT_ENABLED_KEY]) {
        if (isConfigurationSet(config.inspect(key))) {
            return config.get(key, false);
        }
    }
    return false;
}
