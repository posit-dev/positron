/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './selectDataConnectionProvider.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { IDataConnectionDriverMetadata } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

/**
 * SelectDataConnectionProviderProps interface.
 */
interface SelectDataConnectionProviderProps {
	// The data connections service, used to load drivers and listen for changes.
	positronDataConnectionsService: IPositronDataConnectionsService;

	// The currently selected driver ID, lifted to the parent for the Next button.
	selectedDriverId: string | undefined;

	// Called when the selection changes.
	onSelectionChanged: (driverId: string) => void;
}

/**
 * SelectDataConnectionProvider component.
 * Displays a grid of driver cards that the user can click to select.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const SelectDataConnectionProvider = ({ positronDataConnectionsService, selectedDriverId, onSelectionChanged }: SelectDataConnectionProviderProps) => {
	// State.
	const [drivers, setDrivers] = useState<IDataConnectionDriverMetadata[]>([]);

	// Load the registered drivers and listen for changes.
	useEffect(() => {
		// Set the initial list of drivers.
		setDrivers(positronDataConnectionsService.driverManager.getDrivers().map(d => d.metadata));

		// Listen for changes to the registered drivers and update the list accordingly.
		const disposable = positronDataConnectionsService.driverManager.onDidChangeDrivers(updatedDrivers => {
			setDrivers(updatedDrivers.map(d => d.metadata));
		});

		// Clean up the listener when the component is unmounted.
		return () => disposable.dispose();
	}, [positronDataConnectionsService.driverManager]);

	// Render.
	return (
		<div className='select-data-connection-provider'>
			<div className='select-provider-label'>
				{localize(
					'positron.dataConnectionModalDialog.selectProvider',
					"Select a provider"
				)}
			</div>
			<div className='driver-grid'>
				{drivers.map(driver => (
					<Button
						key={driver.id}
						className={positronClassNames(
							'driver-card',
							{ 'selected': selectedDriverId === driver.id }
						)}
						id={`data-connection-driver-card-${driver.id}`} // For automated testing purposes.
						onPressed={() => onSelectionChanged(driver.id)}
					>
						<div className='driver-card-badge'>
							<img alt='' className='driver-card-icon' src={`data:image/svg+xml;base64,${driver.iconSvg}`} />
						</div>
						<div className='driver-card-name'>{driver.name}</div>
					</Button>
				))}
			</div>
		</div>
	);
};
