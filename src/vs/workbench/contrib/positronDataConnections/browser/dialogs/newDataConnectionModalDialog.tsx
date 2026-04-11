/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newDataConnectionModalDialog.css';

// React.
import { useState, useEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { OKCancelActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/okCancelActionBar.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { IDataConnectionDriverMetadata } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

/**
 * NewDataConnectionModalDialogProps interface.
 */
interface NewDataConnectionModalDialogProps {
	renderer: PositronModalReactRenderer;
	dataConnectionsService: IPositronDataConnectionsService;
}

/**
 * NewDataConnectionModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const NewDataConnectionModalDialog = (props: NewDataConnectionModalDialogProps) => {
	// State.
	const [drivers, setDrivers] = useState<IDataConnectionDriverMetadata[]>([]);

	/**
	 * Cancel handler.
	 */
	const cancelHandler = () => {
		props.renderer.dispose();
	};

	/**
	 * Accept handler.
	 */
	const acceptHandler = () => {
		props.renderer.dispose();
	};

	// Load the registered drivers.
	useEffect(() => {
		// Get the registered drivers from the service and store them in state.
		const registeredDrivers = props.dataConnectionsService.driverManager.getDrivers();

		// Set the drivers in state so we can render them.
		setDrivers(registeredDrivers.map(d => d.metadata));
	}, [props.dataConnectionsService]);

	// Render.
	return (
		<PositronModalDialog
			height={400}
			renderer={props.renderer}
			title={localize(
				'positron.newDataConnectionModalDialog.title',
				"New Data Connection"
			)}
			width={600}
			onCancel={cancelHandler}
		>
			<ContentArea>
				<div>Select a provider</div>
				{drivers.map(driver => (
					<div key={driver.id}>
						{driver.name} - {driver.description}
					</div>
				))}
			</ContentArea>
			<OKCancelActionBar
				okButtonTitle={localize('positron.newDataConnectionModalDialog.next', "Next")}
				onAccept={acceptHandler}
				onCancel={cancelHandler}
			/>
		</PositronModalDialog>
	);
};
