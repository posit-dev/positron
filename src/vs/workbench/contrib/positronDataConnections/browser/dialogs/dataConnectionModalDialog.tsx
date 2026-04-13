/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionModalDialog.css';

// React.
import { useState, useCallback } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ConfigureDataConnection } from './configureDataConnection.js';
import { SelectDataConnectionProvider } from './selectDataConnectionProvider.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { PlatformNativeDialogActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/platformNativeDialogActionBar.js';
import { DataConnectionParameterValues, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

/**
 * DataConnectionMode enumeration.
 */
enum DataConnectionMode {
	SelectDataConnectionProvider,
	ConfigureDataConnection,
}

/**
 * DataConnectionModalDialogProps interface.
 */
interface DataConnectionModalDialogProps {
	// The data connection profile being edited, if applicable. If undefined, we are creating a new
	// data connection.
	dataConnectionProfile?: IDataConnectionProfile;

	// The data connection parameter values that are being edited.
	dataConnectionParameterValues?: DataConnectionParameterValues;

	// The renderer is passed in as a prop so that the dialog can control when it is disposed.
	renderer: PositronModalReactRenderer;

	// The data connections service is used to load the registered drivers and create new connections.
	positronDataConnectionsService: IPositronDataConnectionsService;
}

/**
 * DataConnectionModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const DataConnectionModalDialog = ({
	dataConnectionProfile,
	dataConnectionParameterValues,
	renderer,
	positronDataConnectionsService
}: DataConnectionModalDialogProps) => {
	// State.
	const [mode, setMode] = useState(
		dataConnectionProfile !== undefined ?
			DataConnectionMode.ConfigureDataConnection :
			DataConnectionMode.SelectDataConnectionProvider
	);
	const [selectedDriverId, setSelectedDriverId] = useState<string | undefined>(undefined);

	// Back handler.
	const backHandler = useCallback(() => {
		setMode(DataConnectionMode.SelectDataConnectionProvider);
	}, []);

	// Cancel handler.
	const cancelHandler = useCallback(() => {
		// Dispose of the dialog when the user cancels.
		renderer.dispose();
	}, [renderer]);

	// Accept handler. Requires a selected driver.
	const acceptHandler = useCallback(() => {
		// If no driver is selected, do nothing. The user must select a driver to proceed.
		if (!selectedDriverId) {
			return;
		}

		// TODO: Advance to the connection configuration step.
		switch (mode) {
			case DataConnectionMode.SelectDataConnectionProvider:
				setMode(DataConnectionMode.ConfigureDataConnection);
				break;
			case DataConnectionMode.ConfigureDataConnection:
				// TODO: Create the connection.
				renderer.dispose();
				break;
		}
	}, [mode, selectedDriverId, renderer]);

	// Render.
	return (
		<PositronModalDialog
			height={400}
			renderer={renderer}
			title={localize(
				'positron.dataConnectionModalDialog.title',
				"New Data Connection"
			)}
			width={600}
			onCancel={cancelHandler}
		>
			<ContentArea>
				{mode === DataConnectionMode.SelectDataConnectionProvider && (
					<SelectDataConnectionProvider
						positronDataConnectionsService={positronDataConnectionsService}
						selectedDriverId={selectedDriverId}
						onSelectionChanged={setSelectedDriverId}
					/>
				)}
				{mode === DataConnectionMode.ConfigureDataConnection && selectedDriverId && (
					<ConfigureDataConnection
						driverId={selectedDriverId}
					/>
				)}
			</ContentArea>
			<div className='data-connection-action-bar'>
				<div className='left-actions'>
					{dataConnectionParameterValues === undefined && mode === DataConnectionMode.ConfigureDataConnection && (
						<Button className='action-bar-button' onPressed={backHandler}>
							{localize('positron.dataConnectionModalDialog.back', "Back")}
						</Button>
					)}
				</div>
				<div className='right-actions'>
					<PlatformNativeDialogActionBar
						primaryButton={
							<Button className='action-bar-button default' onPressed={acceptHandler}>
								{localize('positron.dataConnectionModalDialog.next', "Next")}
							</Button>
						}
						secondaryButton={
							<Button className='action-bar-button' onPressed={cancelHandler}>
								{localize('positron.dataConnectionModalDialog.cancel', "Cancel")}
							</Button>
						}
					/>
				</div>
			</div>
		</PositronModalDialog>
	);
};
