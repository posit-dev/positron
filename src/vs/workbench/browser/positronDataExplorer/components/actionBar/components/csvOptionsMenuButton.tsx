/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState } from 'react';
import { localize } from '../../../../../../nls.js';
import { IAction } from '../../../../../../base/common/actions.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { usePositronDataExplorerContext } from '../../../positronDataExplorerContext.js';
import { ActionBarMenuButton } from '../../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { PositronDataExplorerDuckDBBackend } from '../../../../../services/positronDataExplorer/common/positronDataExplorerDuckDBBackend.js';

export const CsvOptionsMenuButton = () => {
	const context = usePositronDataExplorerContext();
	const [hasHeaderRow, setHasHeaderRow] = useState(true);

	const backendClient = context.instance.dataExplorerClientInstance?.backendClient;
	if (!(backendClient instanceof PositronDataExplorerDuckDBBackend)) {
		return null;
	}

	const actions = (): IAction[] => [{
		id: 'HasHeaderRow',
		label: localize('positron.hasHeaderRowLabel', "Has Header Row"),
		tooltip: '',
		class: undefined,
		enabled: true,
		checked: hasHeaderRow,
		run: async () => {
			const newValue = !hasHeaderRow;
			try {
				await backendClient.setDatasetImportOptions({ has_header_row: newValue });
				setHasHeaderRow(newValue);
			} catch (err) {
				console.error('Failed to update CSV import options:', err);
			}
		}
	}];

	return (
		<ActionBarMenuButton
			actions={actions}
			ariaLabel={localize('positron.csvOptionsButtonDescription', "CSV import options")}
			icon={ThemeIcon.fromId('settings-gear')}
			label={localize('positron.csvOptionsButtonTitle', "CSV Options")}
			tooltip={localize('positron.csvOptionsButtonDescription', "CSV import options")}
		/>
	);
};
