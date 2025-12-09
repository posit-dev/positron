/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './csvOptionsModalDialog.css';

// React.
import React, { useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { IPositronDataExplorerInstance } from '../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';
import { Button } from '../../../base/browser/ui/positronComponents/button/button.js';
import { PlatformNativeDialogActionBar } from '../positronComponents/positronModalDialog/components/platformNativeDialogActionBar.js';
import { PositronModalDialog } from '../positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../positronComponents/positronModalDialog/components/contentArea.js';
import { Checkbox } from '../positronComponents/positronModalDialog/components/checkbox.js';

/**
 * Shows the CSV options modal dialog.
 * @param dataExplorerInstance The data explorer instance.
 * @returns A promise that resolves when the dialog is closed.
 */
export const showCsvOptionsModalDialog = async (
	dataExplorerInstance: IPositronDataExplorerInstance,
): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	// Show the CSV options dialog.
	renderer.render(
		<CsvOptionsModalDialog
			dataExplorerInstance={dataExplorerInstance}
			renderer={renderer}
		/>
	);
};

/**
 * CsvOptionsDialogProps interface.
 */
interface CsvOptionsDialogProps {
	dataExplorerInstance: IPositronDataExplorerInstance;
	renderer: PositronModalReactRenderer;
}

/**
 * CsvOptionsModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const CsvOptionsModalDialog = (props: CsvOptionsDialogProps) => {
	// State hooks - initialize with current values from the instance.
	const initialHasHeaderRow = props.dataExplorerInstance.csvHasHeaderRow;
	const [hasHeaderRow, setHasHeaderRow] = useState(initialHasHeaderRow);

	// Track if settings have changed.
	const settingsChanged = hasHeaderRow !== initialHasHeaderRow;

	// Handle applying the options.
	const handleApply = async () => {
		// Only apply if settings have changed.
		if (settingsChanged) {
			await props.dataExplorerInstance.toggleCsvHasHeaderRow();
		}
		props.renderer.dispose();
	};

	// Handle cancel.
	const handleCancel = () => {
		props.renderer.dispose();
	};

	const applyButton = (
		<Button className='action-bar-button default' onPressed={handleApply}>
			{localize('positron.csvOptions.apply', "Apply")}
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
			height={200}
			renderer={props.renderer}
			title={localize('positron.csvOptionsModalDialogTitle', "CSV Options")}
			width={350}
		>
			<ContentArea>
				<div className='csv-options-content'>
					<Checkbox
						initialChecked={initialHasHeaderRow}
						label={localize('positron.csvOptions.hasHeaderRow', "First row contains column names")}
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
