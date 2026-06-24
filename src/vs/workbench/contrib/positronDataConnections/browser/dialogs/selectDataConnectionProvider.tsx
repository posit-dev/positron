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
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { IDataConnectionDriver, IDataConnectionDriverMetadata } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * SelectDataConnectionProviderProps interface.
 */
interface SelectDataConnectionProviderProps {
	// The renderer.
	renderer: PositronModalDialogReactRenderer;

	// Called when the user selects a driver and clicks Next.
	onNext: (selectedDriver: IDataConnectionDriver) => void;
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

	// Map of driver card keys to their <label> elements, populated by the label ref callback below.
	// Used by scrollToFocusedDriverCard to look up a card by key without reaching into the DOM.
	const driverCardRefs = useRef<Map<string, HTMLLabelElement>>(new Map());

	// State.
	const [drivers, setDrivers] = useState<IDataConnectionDriverMetadata[]>([]);
	const [selectedDriverId, setSelectedDriverId] = useState<string | undefined>(undefined);
	const [showError, setShowError] = useState(false);

	// Load the registered drivers and listen for changes.
	useEffect(() => {
		// // DEBUG: register clones of each real driver with unique IDs so the grid has enough cards
		// // to exercise scrolling/layout. Each clone is a real registered driver, so onNext ->
		// // driverManager.getDriver(id) resolves and the configure step opens normally. registerDriver
		// // is keyed by id, so re-mounting the dialog just replaces existing clones instead of
		// // compounding. Remove before committing.
		// const cloneCount = 12;
		// for (const d of positronDataConnectionsService.driverManager.getDrivers().filter(d => !d.id.includes('-clone-'))) {
		// 	for (let i = 0; i < cloneCount; i++) {
		// 		const cloneId = `${d.id}-clone-${i}`;
		// 		positronDataConnectionsService.driverManager.registerDriver({
		// 			...d,
		// 			id: cloneId,
		// 			metadata: { ...d.metadata, id: cloneId, name: `${d.metadata.name} ${i + 1}` },
		// 		});
		// 	}
		// }

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

		// The browser's native focus auto-scroll walks every scrollable ancestor of the focused
		// radio input and scrolls each one. We want only the grid container to scroll, so reset
		// scrollTop/scrollLeft on every ancestor above the grid container. (`overflow: hidden`
		// boxes like the dialog box also accept programmatic scrolling, so they get caught up in
		// this too.) Done first so our own scroll math below sees a clean slate.
		for (let parent = container.parentElement; parent; parent = parent.parentElement) {
			if (parent.scrollTop !== 0) {
				parent.scrollTop = 0;
			}
			if (parent.scrollLeft !== 0) {
				parent.scrollLeft = 0;
			}
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
		// If no driver is selected, set the show error flag and do not proceed to the next step.
		if (!selectedDriverId) {
			setShowError(true);
			return;
		}

		// Get the selected driver. This can't fail. If it does, something is very wrong.
		const driver = positronDataConnectionsService.driverManager.getDriver(selectedDriverId);
		if (!driver) {
			console.error(`Selected driver with id ${selectedDriverId} not found`);
			setShowError(true);
			return;
		}

		// Proceed to the next step with the selected driver.
		onNext(driver);
	}, [selectedDriverId, onNext, positronDataConnectionsService.driverManager]);

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
						<div ref={gridContainerRef} className='driver-grid-container' role='radiogroup'>
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
										const driverCardId = `data-connection-driver-card-${driverCardKey}`;
										return (
											<label
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
												htmlFor={driverCardId}
											>
												<input
													checked={selectedDriverId === driver.id}
													className='driver-card-input'
													id={driverCardId}
													name='data-connection-driver'
													type='radio'
													value={driver.id}
													onChange={() => {
														setSelectedDriverId(driver.id);
														setShowError(false);
													}}
													onFocus={() => scrollToFocusedDriverCard(driverCardKey)}
												/>
												<div className='driver-card-badge'>
													<img alt='' className='driver-card-icon' src={`data:image/svg+xml;base64,${driver.iconSvg}`} />
												</div>
												<div className='driver-card-name'>{driver.name}</div>
											</label>
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
				"Add Database"
			)}
			titleBarSize='normal'
			width={492}
			onCancel={cancelHandler}
			onSubmit={nextHandler}
		/>
	);
};
