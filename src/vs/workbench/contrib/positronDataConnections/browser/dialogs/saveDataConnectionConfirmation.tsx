/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { dataExplorersClosingDetail, showDataConnectionConfirmation } from './dataConnectionConfirmation.js';

/**
 * Shows the Save Changes confirmation dialog. A connection is opened from the values a profile had
 * at the time, so editing any of them closes it -- and the Data Explorers previewed from it, whose
 * backends die with it. Nothing is lost that cannot be reopened, but the user is not expecting a
 * save to take their grids down, so the dialog says so first.
 * @param connectionName The name of the connection being edited.
 * @param openDataExplorerCount How many Data Explorers previewed from the connection are open, and
 * so will close along with it. Always at least one; a save with none open does not need confirming.
 * @returns A promise that resolves to true if the user confirmed, or false if they cancelled.
 */
export function showSaveDataConnectionConfirmation(
	connectionName: string,
	openDataExplorerCount: number
): Promise<boolean> {
	return showDataConnectionConfirmation({
		title: localize('positron.saveDataConnectionConfirmation.title', "Save Changes?"),
		details: [
			localize(
				'positron.saveDataConnectionConfirmation.detail',
				"These changes close the connection to '{0}' so it can reopen with the new settings.",
				connectionName
			),
			dataExplorersClosingDetail(openDataExplorerCount),
		],
		confirmButtonTitle: localize('positron.saveDataConnectionConfirmation.confirm', "Save"),
	});
}
