/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './selectDataConnectionProvider.css';

// React.
import { useCallback, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { OKCancelActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/okCancelActionBar.js';
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

	// Refs.
	const gridContainerRef = useRef<HTMLDivElement>(undefined!);

	// State.
	const [drivers, setDrivers] = useState<IDataConnectionDriverMetadata[]>([]);
	const [selectedDriverId, setSelectedDriverId] = useState<string | undefined>(undefined);
	const [showError, setShowError] = useState(false);

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

	/**
	 * Cancel handler.
	 */
	const cancelHandler = useCallback(() => {
		// Dispose the renderer, which will close the dialog.
		renderer.dispose();
	}, [renderer]);

	/**
	 * Scrolls the grid container to keep the focused driver card visible with proper padding.
	 * @param targetDriverCard The driver card that received focus.
	 */
	const scrollToFocusedDriverCard = useCallback((targetDriverCard: HTMLButtonElement) => {
		// Get the container element. If we can't find it, do nothing.
		const container = gridContainerRef.current;
		if (!container) {
			return;
		}

		// Calculate the top and bottom of the target card relative to the container.
		const padding = 8;
		const cardRect = targetDriverCard.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		const borderTop = container.clientTop;
		const cardTop = cardRect.top - containerRect.top - borderTop + container.scrollTop;
		const cardBottom = cardTop + targetDriverCard.offsetHeight;

		// If the top of the card is above the visible area of the container, scroll up to show it with padding.
		// If the bottom of the card is below the visible area of the container, scroll down to show it with padding.
		if (cardTop - padding < container.scrollTop) {
			container.scrollTop = cardTop - padding;
		} else if (cardBottom + padding > container.scrollTop + container.clientHeight) {
			container.scrollTop = cardBottom + padding - container.clientHeight;
		}
	}, []);

	// Next handler.
	const nextHandler = useCallback(() => {
		if (selectedDriverId) {
			onNext(selectedDriverId);
		} else {
			setShowError(true);
		}
	}, [selectedDriverId, onNext]);

	// Render.
	return (
		<PositronModalDialog
			height={382}
			renderer={props.renderer}
			title={localize(
				'positron.selectDataConnectionProvider.title',
				"New Data Connection"
			)}
			width={492}
			onCancel={cancelHandler}
		>
			<ContentArea>
				<div className='select-data-connection-provider'>
					<div className={positronClassNames(
						'select-provider-label',
						{ 'error': showError }
					)}>
						{localize(
							'positron.selectDataConnectionProvider.selectProvider',
							"Select a provider"
						)}
					</div>
					<div className='driver-grid-clip'>
						<div ref={gridContainerRef} className='driver-grid-container' role='group'>
							<div className='driver-grid'>
								{drivers.map((driver, index) => (
									<Button
										key={`${driver.id}-${index}`}
										className={positronClassNames(
											'driver-card',
											{ 'selected': selectedDriverId === driver.id }
										)}
										id={`data-connection-driver-card-${driver.id}-${index}`}
										onFocus={htmlButtonElement => scrollToFocusedDriverCard(htmlButtonElement)}
										onPressed={(_, htmlButtonElement) => {
											scrollToFocusedDriverCard(htmlButtonElement);
											setSelectedDriverId(driver.id);
											setShowError(false);
										}}
									>
										<div className='driver-card-badge'>
											<img alt='' className='driver-card-icon' src={`data:image/svg+xml;base64,${driver.iconSvg}`} />
										</div>
										<div className='driver-card-name'>{driver.name}</div>
									</Button>
								))}
							</div>
						</div>
					</div>
				</div>
			</ContentArea>
			<OKCancelActionBar
				okButtonTitle={localize('positron.selectDataConnectionProvider.next', "Next")}
				onAccept={nextHandler}
				onCancel={cancelHandler}
			/>
		</PositronModalDialog>
	);
};
