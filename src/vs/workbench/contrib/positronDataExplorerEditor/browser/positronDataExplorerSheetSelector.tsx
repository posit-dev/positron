/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Action, IAction } from '../../../../base/common/actions.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ActionBarMenuButton } from '../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronDataExplorerInstance } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { getPositronDataExplorerEditorFromEditorPane } from './positronDataExplorerActions.js';

interface PositronDataExplorerSheetSelectorProps {
	accessor: ServicesAccessor;
}

/**
 * Resolves the data explorer instance backing the active editor.
 * @param editorService The editor service.
 * @param dataExplorerService The data explorer service.
 * @returns The active data explorer instance, or undefined when none is active.
 */
function getActiveInstance(
	editorService: IEditorService,
	dataExplorerService: IPositronDataExplorerService
): IPositronDataExplorerInstance | undefined {
	const editor = getPositronDataExplorerEditorFromEditorPane(editorService.activeEditorPane);
	const identifier = editor?.identifier;
	return identifier ? dataExplorerService.getInstance(identifier) : undefined;
}

/**
 * Reads the worksheet state from a data explorer instance.
 * @param instance The data explorer instance, or undefined when none is active.
 * @returns The available worksheets and the currently selected worksheet.
 */
function getSheetState(instance: IPositronDataExplorerInstance | undefined) {
	return {
		availableSheets: instance?.fileAvailableSheets ?? [],
		selectedSheet: instance?.fileSelectedSheet
	};
}

/**
 * React component that displays a worksheet selector in the data explorer editor
 * action bar. Shows the currently selected worksheet of an Excel workbook and, on
 * click, presents a dropdown of the workbook's worksheets. Selecting a worksheet
 * reloads the data explorer against that worksheet.
 */
export function PositronDataExplorerSheetSelector({ accessor }: PositronDataExplorerSheetSelectorProps) {
	// Get services.
	const editorService = accessor.get(IEditorService);
	const dataExplorerService = accessor.get(IPositronDataExplorerService);

	// State.
	const [instance, setInstance] = React.useState<IPositronDataExplorerInstance | undefined>(
		() => getActiveInstance(editorService, dataExplorerService));
	const [{ availableSheets, selectedSheet }, setSheetState] = React.useState(
		() => getSheetState(getActiveInstance(editorService, dataExplorerService)));

	// Track the active data explorer instance as the active editor changes.
	React.useEffect(() => {
		const disposables = new DisposableStore();

		disposables.add(editorService.onDidActiveEditorChange(() => {
			const activeInstance = getActiveInstance(editorService, dataExplorerService);
			setInstance(activeInstance);
			setSheetState(getSheetState(activeInstance));
		}));

		return () => disposables.dispose();
	}, [editorService, dataExplorerService]);

	// Refresh the worksheet state when the active instance's backend state changes
	// (e.g. once the workbook's worksheets are known, or after a worksheet reload).
	React.useEffect(() => {
		if (!instance) {
			return;
		}

		const disposables = new DisposableStore();
		disposables.add(instance.dataExplorerClientInstance.onDidUpdateBackendState(() => {
			setSheetState(getSheetState(instance));
		}));

		return () => disposables.dispose();
	}, [instance]);

	// Build the dropdown actions, one per worksheet, marking the selected one.
	const getActions = React.useCallback((): IAction[] => {
		if (!instance) {
			return [];
		}

		return availableSheets.map(sheet => {
			const action = new Action(
				`positronDataExplorer.selectSheet.${sheet}`,
				sheet,
				undefined,
				true,
				async () => {
					await instance.applyFileOptions({
						hasHeaderRow: instance.fileHasHeaderRow,
						sheetName: sheet
					});
					setSheetState(getSheetState(instance));
				}
			);
			action.checked = sheet === selectedSheet;
			return action;
		});
	}, [instance, availableSheets, selectedSheet]);

	// Nothing to show until the workbook's worksheets are known, and no need for
	// a selector when there is only a single worksheet to choose from.
	if (availableSheets.length <= 1) {
		return null;
	}

	const label = selectedSheet ?? '';
	const tooltip = localize('positron.dataExplorer.selectSheet', "Select Worksheet");

	return (
		<ActionBarMenuButton
			actions={getActions}
			align='right'
			ariaLabel={tooltip}
			icon={Codicon.file}
			label={label}
			maxTextWidth={150}
			tooltip={tooltip}
		/>
	);
}
