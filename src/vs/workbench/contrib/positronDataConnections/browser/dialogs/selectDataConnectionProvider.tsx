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
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { IDataConnectionDriverMetadata } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

/**
 * SelectDataConnectionProviderProps interface.
 */
interface SelectDataConnectionProviderProps {
	// The renderer.
	renderer: PositronModalDialogReactRenderer;

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

	// Map of driver card keys to their <button> elements, populated by the Button ref callback below.
	// Used by scrollToFocusedDriverCard to look up a card by key without reaching into the DOM.
	const driverCardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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
	 * @param driverCardKey The `${driver.id}-${index}` key of the driver card to scroll into view.
	 */
	const scrollToFocusedDriverCard = useCallback((driverCardKey: string) => {
		// Look up the card and the container. If either is missing, do nothing.
		const targetDriverCard = driverCardRefs.current.get(driverCardKey);
		const container = gridContainerRef.current;
		if (!targetDriverCard || !container) {
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
		<PositronDynamicModalDialog
			content={
				<div className='select-data-connection-provider'>
					<div className='select-provider-label'>
						{localize(
							'positron.selectDataConnectionProvider.selectProvider',
							"Select a provider"
						)}
					</div>
					<div className={positronClassNames(
						'driver-grid-clip',
						{ 'error': showError }
					)}>
						<div ref={gridContainerRef} className='driver-grid-container' role='group'>
							{drivers.length === 0 ? (
								// No drivers registered yet; extensions providing them may still be loading.
								<div className='driver-grid-placeholder'>
									{localize(
										'positron.selectDataConnectionProvider.loadingProviders',
										"Loading providers..."
									)}
								</div>
							) : (
								<div className='driver-grid'>
									{drivers.map((driver, index) => {
										const driverCardKey = `${driver.id}-${index}`;
										return (
											<Button
												key={driverCardKey}
												ref={element => {
													if (element) {
														driverCardRefs.current.set(driverCardKey, element);
													} else {
														driverCardRefs.current.delete(driverCardKey);
													}
												}}
												className={positronClassNames(
													'driver-card',
													{ 'selected': selectedDriverId === driver.id }
												)}
												id={`data-connection-driver-card-${driverCardKey}`}
												onFocus={() => scrollToFocusedDriverCard(driverCardKey)}
												onPressed={() => {
													scrollToFocusedDriverCard(driverCardKey);
													setSelectedDriverId(driver.id);
													setShowError(false);
												}}
											>
												<div className='driver-card-badge'>
													<img alt='' className='driver-card-icon' src={`data:image/svg+xml;base64,${driver.iconSvg}`} />
												</div>
												<div className='driver-card-name'>{driver.name}</div>
											</Button>
										);
									})}
								</div>
							)}
						</div>
					</div>
				</div>
			}
			footer={
				<TwoButtonFooter
					primaryButtonTitle={localize('positron.selectDataConnectionProvider.next', "Next")}
					secondaryButtonTitle={localize('positron.selectDataConnectionProvider.cancel', "Cancel")}
					onPrimaryButton={nextHandler}
					onSecondaryButton={cancelHandler}
				/>
			}
			renderer={props.renderer}
			title={localize(
				'positron.selectDataConnectionProvider.title',
				"New Data Connection"
			)}
			width={492}
			onCancel={cancelHandler}
		/>
	);
};
