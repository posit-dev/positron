/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { dataExplorersClosingDetail, showDataConnectionConfirmation } from './dataConnectionConfirmation.js';

/**
 * Shows the Hide Connection confirmation dialog. Hiding a detected connection closes it, and the
 * Data Explorers previewed from it close with it. Show Hidden Connections brings the row back but
 * not the grids, so the dialog says so first.
 * @param connectionName The name of the connection being hidden.
 * @param openDataExplorerCount How many Data Explorers previewed from the connection are open, and
 * so will close along with it. Always at least one; a hide with none open does not need confirming.
 * @returns A promise that resolves to true if the user confirmed, or false if they cancelled.
 */
export function showHideDataConnectionConfirmation(
	connectionName: string,
	openDataExplorerCount: number
): Promise<boolean> {
	return showDataConnectionConfirmation({
		title: localize('positron.hideDataConnectionConfirmation.title', "Hide Connection?"),
		details: [
			localize(
				'positron.hideDataConnectionConfirmation.detail',
				"Hiding '{0}' closes its connection. You can show it again with Show Hidden Connections.",
				connectionName
			),
			dataExplorersClosingDetail(openDataExplorerCount),
		],
		confirmButtonTitle: localize('positron.hideDataConnectionConfirmation.confirm', "Hide"),
	});
}
