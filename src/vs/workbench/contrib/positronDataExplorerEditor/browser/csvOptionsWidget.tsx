/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ActionBarButton } from '../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronActionBarWidgetRegistry } from '../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { PositronDataExplorerUri } from '../../../services/positronDataExplorer/common/positronDataExplorerUri.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PositronDataExplorerEditorInput } from './positronDataExplorerEditorInput.js';
import { POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR, POSITRON_DATA_EXPLORER_IS_PLAINTEXT } from './positronDataExplorerContextKeys.js';
import { showCsvOptionsModalDialog } from '../../../browser/positronModalDialogs/csvOptionsModalDialog.js';

/**
 * Localized strings.
 */
const csvOptionsButtonLabel = localize('positron.csvOptionsButtonLabel', "CSV Options");
const csvOptionsButtonTooltip = localize('positron.csvOptionsButtonTooltip', "CSV import options");

/**
 * Registers the CSV Options widget in the Editor Action Bar.
 * This button appears when viewing CSV/TSV files in the Data Explorer and opens
 * a modal dialog for configuring CSV import options (e.g., header row setting).
 */
export function registerCsvOptionsWidget(): void {
	PositronActionBarWidgetRegistry.registerWidget({
		id: 'positronDataExplorer.csvOptions',
		menuId: MenuId.EditorActionsLeft,
		order: 0, // Before other actions
		when: ContextKeyExpr.and(
			POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR,
			POSITRON_DATA_EXPLORER_IS_PLAINTEXT
		),
		selfContained: true,
		componentFactory: (accessor) => {
			const editorService = accessor.get(IEditorService);
			const dataExplorerService = accessor.get(IPositronDataExplorerService);

			return () => {
				// Get the active editor to find the data explorer instance.
				const activeEditor = editorService.activeEditor;
				if (!(activeEditor instanceof PositronDataExplorerEditorInput)) {
					return null;
				}

				// Parse the identifier from the resource URI.
				const identifier = PositronDataExplorerUri.parse(activeEditor.resource);
				if (!identifier) {
					return null;
				}

				// Get the data explorer instance.
				const instance = dataExplorerService.getInstance(identifier);
				if (!instance) {
					return null;
				}

				// Handler for button press - opens the CSV options modal dialog.
				const handlePressed = async () => {
					await showCsvOptionsModalDialog(instance);
				};

				return (
					<ActionBarButton
						ariaLabel={csvOptionsButtonTooltip}
						icon={Codicon.settingsGear}
						label={csvOptionsButtonLabel}
						tooltip={csvOptionsButtonTooltip}
						onPressed={handlePressed}
					/>
				);
			};
		}
	});
}
