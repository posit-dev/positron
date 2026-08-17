/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

/**
 * Thin wrapper around `positron.window.showThreeButtonModalDialogPrompt`, matching the
 * wrappers in `common/vscodeApis` so that callers stay unit-testable.
 *
 * @param options The dialog's title, message, and button titles.
 *
 * @returns The title of the button the user clicked, or undefined if they dismissed the dialog.
 */
export function showThreeButtonModalDialogPrompt(
    options: positron.window.ThreeButtonModalDialogPromptOptions,
): Thenable<string | undefined> {
    return positron.window.showThreeButtonModalDialogPrompt(options);
}
