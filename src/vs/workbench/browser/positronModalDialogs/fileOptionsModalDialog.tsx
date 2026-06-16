/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './fileOptionsModalDialog.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { IPositronDataExplorerInstance } from '../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';
import { Button } from '../../../base/browser/ui/positronComponents/button/button.js';
import { PlatformNativeDialogActionBar } from '../positronComponents/positronModalDialog/components/platformNativeDialogActionBar.js';
import { PositronModalDialog } from '../positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../positronComponents/positronModalDialog/components/contentArea.js';
import { Checkbox } from '../positronComponents/positronModalDialog/components/checkbox.js';
import { DropDownListBox } from '../positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { DropdownEntry } from './components/dropdownEntry.js';

/**
 * Shows the file options modal dialog.
 * @param dataExplorerInstance The data explorer instance.
 * @returns A promise that resolves when the dialog is closed.
 */
export const showFileOptionsModalDialog = async (
	dataExplorerInstance: IPositronDataExplorerInstance,
): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	// Show the file options dialog.
	renderer.render(
		<FileOptionsModalDialog
			dataExplorerInstance={dataExplorerInstance}
			renderer={renderer}
		/>
	);
};

/**
 * FileOptionsDialogProps interface.
 */
interface FileOptionsDialogProps {
	dataExplorerInstance: IPositronDataExplorerInstance;
	renderer: PositronModalReactRenderer;
}

/**
 * FileOptionsModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const FileOptionsModalDialog = (props: FileOptionsDialogProps) => {
	// State hooks - initialize with current values from the instance.
	const initialHasHeaderRow = props.dataExplorerInstance.fileHasHeaderRow;
	const initialSheet = props.dataExplorerInstance.fileSelectedSheet;
	const [hasHeaderRow, setHasHeaderRow] = useState(initialHasHeaderRow);
	const [selectedSheet, setSelectedSheet] = useState(initialSheet);

	// Excel workbooks expose a sheet picker; other sources (CSV/TSV) do not.
	const availableSheets = props.dataExplorerInstance.fileAvailableSheets;
	const showSheetPicker = availableSheets.length > 0;

	// Track if settings have changed.
	const settingsChanged =
		hasHeaderRow !== initialHasHeaderRow || selectedSheet !== initialSheet;

	// Handle applying the options.
	const handleApply = async () => {
		// Only apply if settings have changed.
		if (settingsChanged) {
			await props.dataExplorerInstance.applyFileOptions({
				hasHeaderRow,
				sheetName: selectedSheet
			});
		}
		props.renderer.dispose();
	};

	// Handle cancel.
	const handleCancel = () => {
		props.renderer.dispose();
	};

	const applyButton = (
		<Button className='action-bar-button default' onPressed={handleApply}>
			{localize('positron.fileOptions.apply', "Apply")}
		</Button>
	);

	const cancelButton = (
		<Button className='action-bar-button' onPressed={handleCancel}>
			{localize('positronCancel', "Cancel")}
		</Button>
	);

	// Render.
	return (
		<PositronModalDialog
			height={showSheetPicker ? 260 : 200}
			renderer={props.renderer}
			title={localize('positron.fileOptionsModalDialogTitle', "File Options")}
			width={350}
		>
			<ContentArea>
				<div className='file-options-content'>
					{showSheetPicker &&
						<div className='file-options-sheet'>
							<label className='file-options-label' htmlFor='file-options-sheet-dropdown'>
								{localize('positron.fileOptions.sheet', "Worksheet")}
							</label>
							<DropDownListBox
								className='file-options-sheet-dropdown'
								createItem={(item) => <DropdownEntry title={item.options.identifier} />}
								entries={availableSheets.map(name =>
									new DropDownListBoxItem<string, string>({ identifier: name, value: name })
								)}
								selectedIdentifier={selectedSheet}
								title={selectedSheet ?? localize('positron.fileOptions.selectSheet', "Select a worksheet")}
								onSelectionChanged={item => setSelectedSheet(item.options.value)}
							/>
						</div>
					}
					<Checkbox
						initialChecked={initialHasHeaderRow}
						label={localize('positron.fileOptions.hasHeaderRow', "First row contains column names")}
						onChanged={setHasHeaderRow}
					/>
				</div>
			</ContentArea>
			<div className='ok-cancel-action-bar'>
				<PlatformNativeDialogActionBar primaryButton={applyButton} secondaryButton={cancelButton} />
			</div>
		</PositronModalDialog>
	);
};
