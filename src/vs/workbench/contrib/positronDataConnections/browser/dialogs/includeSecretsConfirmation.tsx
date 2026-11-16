/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { showDataConnectionConfirmation } from './dataConnectionConfirmation.js';

/**
 * Shows the Include Secrets confirmation dialog, warning the user that embedding secret values in
 * the generated connection code can expose them.
 * @param options.requiredForConnect Whether this connection cannot be run in a console (or, for the
 * "Connect With" menu, cannot even produce a code preview) without secrets, which uses stronger
 * wording than the "Include Secrets" action's own optional opt-in.
 * @returns A promise that resolves to true if the user confirmed, or false if they cancelled.
 */
export function showIncludeSecretsConfirmation(options?: { requiredForConnect?: boolean }): Promise<boolean> {
	return showDataConnectionConfirmation({
		title: localize('positron.includeSecretsConfirmation.title', "Include Secrets?"),
		details: [
			options?.requiredForConnect
				? localize(
					'positron.includeSecretsConfirmation.detailRequired',
					"This connection requires secrets, such as a password, to connect. They will be written into the connection code and may be exposed in console history, the clipboard, or any script you create from it."
				)
				: localize(
					'positron.includeSecretsConfirmation.detail',
					"Passwords and other secrets will be written into the connection code. They may be exposed in console history, the clipboard, or any script you create from this code."
				),
		],
		confirmButtonTitle: localize('positron.includeSecretsConfirmation.confirm', "Include Secrets"),
	});
}
