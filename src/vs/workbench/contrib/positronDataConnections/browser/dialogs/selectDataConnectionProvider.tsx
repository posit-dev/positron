/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './selectDataConnectionProvider.css';

// React.
import { useCallback, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DataConnectionActionBar } from './dataConnectionActionBar.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { IDataConnectionDriverMetadata } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

/**
 * SelectDataConnectionProviderProps interface.
 */
interface SelectDataConnectionProviderProps {
	// The renderer.
	renderer: PositronModalReactRenderer;

	// Called when the user selects a driver and clicks Next.
	onNext: (driverId: string) => void;
}

/**
 * SelectDataConnectionProvider component.
 * Displays a dialog with a grid of driver cards that the user can click to select.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const SelectDataConnectionProvider = (props: SelectDataConnectionProviderProps) => {
	// Destructure props for use in hooks.
	const { renderer, onNext } = props;

	// Get the data connections service from the React services context.
	const { positronDataConnectionsService } = usePositronReactServicesContext();

	// State.
	const [drivers, setDrivers] = useState<IDataConnectionDriverMetadata[]>([]);
	const [selectedDriverId, setSelectedDriverId] = useState<string | undefined>(undefined);

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

	// Cancel handler.
	const cancelHandler = useCallback(() => {
		renderer.dispose();
	}, [renderer]);

	// Next handler.
	const nextHandler = useCallback(() => {
		if (selectedDriverId) {
			onNext(selectedDriverId);
		}
	}, [selectedDriverId, onNext]);

	// Render.
	return (
		<PositronModalDialog
			height={400}
			renderer={props.renderer}
			title={localize(
				'positron.selectDataConnectionProvider.title',
				"New Data Connection"
			)}
			width={600}
			onCancel={cancelHandler}
		>
			<ContentArea>
				<div className='select-data-connection-provider'>
					<div className='select-provider-label'>
						{localize(
							'positron.selectDataConnectionProvider.selectProvider',
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
								id={`data-connection-driver-card-${driver.id}`}
								onPressed={() => setSelectedDriverId(driver.id)}
							>
								<div className='driver-card-badge'>
									<img alt='' className='driver-card-icon' src={`data:image/svg+xml;base64,${driver.iconSvg}`} />
								</div>
								<div className='driver-card-name'>{driver.name}</div>
							</Button>
						))}
					</div>
				</div>
			</ContentArea>
			<DataConnectionActionBar
				acceptDisabled={!selectedDriverId}
				acceptLabel={localize('positron.selectDataConnectionProvider.next', "Next")}
				onAccept={nextHandler}
				onCancel={cancelHandler}
			/>
		</PositronModalDialog>
	);
};
