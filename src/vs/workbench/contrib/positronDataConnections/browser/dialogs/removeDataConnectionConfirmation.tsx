/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { dataExplorersClosingDetail, showDataConnectionConfirmation } from './dataConnectionConfirmation.js';

/**
 * Shows the Remove Connection confirmation dialog. Removing a connection deletes its saved settings
 * and stored secrets, and takes down anything still using it, so the dialog spells out what goes
 * with it before the user commits.
 * @param connectionName The name of the connection to be removed.
 * @param openDataExplorerCount How many Data Explorers previewed from the connection are open, and
 * so will close along with it. Zero when none are.
 * @returns A promise that resolves to true if the user confirmed, or false if they cancelled.
 */
export function showRemoveDataConnectionConfirmation(
	connectionName: string,
	openDataExplorerCount: number
): Promise<boolean> {
	return showDataConnectionConfirmation({
		title: localize('positron.removeDataConnectionConfirmation.title', "Remove Connection?"),
		details: [
			localize(
				'positron.removeDataConnectionConfirmation.detail',
				"The saved settings and stored secrets for '{0}' will be deleted. This cannot be undone.",
				connectionName
			),
			dataExplorersClosingDetail(openDataExplorerCount),
		],
		confirmButtonTitle: localize('positron.removeDataConnectionConfirmation.confirm', "Remove"),
		destructive: true,
	});
}
