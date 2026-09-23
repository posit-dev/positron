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
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { IDataConnectionDriver, IDataConnectionDriverMetadata } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * The width the dialog box is drawn at. Matches the Configure LLM Providers modal, whose row
 * layout this list mirrors: a name and a one-line description need the room a card grid did not.
 */
const MODAL_WIDTH = 600;

/**
 * The height of the provider list area. Passed as both the minimum and the maximum, so the dialog
 * is one fixed size: a short list leaves empty space below it and a long one scrolls, but the box
 * never resizes. That is deliberate. The list arrives asynchronously -- extensions register their
 * drivers after the dialog mounts -- and the dialog centers itself once, on mount. A box sized to
 * its content would be centered against an empty list and then grow downward off the bottom of a
 * short window.
 *
 * Six rows. Eight drivers ship by default, so the stock list scrolls: the height is chosen for the
 * proportions of the box rather than to fit any particular list, and no list is short enough to be
 * worth sizing to -- a machine with ODBC drivers configured registers more than the eight anyway.
 *
 * Sized so the list never ends on a sliver of the row below: six 36px rows and their five 20px
 * gaps, plus the list's 4px top padding and a closing 20px that matches a gap, is 340px of list;
 * the content area scrolls its own 16px top padding with the content, so the height that shows
 * exactly that much is 340 - 16. The seventh row begins precisely at the fold and is entirely out
 * of sight.
 *
 * Every term above is a whole row, so this only holds while a row is exactly 36px. Both the icon
 * plate and the name/description stack are pinned to that height in the CSS -- change either and
 * this number has to move with it.
 */
const LIST_CONTENT_HEIGHT = 324;

/**
 * SelectDataConnectionProviderProps interface.
 */
interface SelectDataConnectionProviderProps {
	// The renderer.
	renderer: PositronModalReactRenderer;

	// Called when the user picks a driver.
	onNext: (selectedDriver: IDataConnectionDriver) => void;
}

/**
 * SelectDataConnectionProvider component.
 * Displays a dialog with a vertical list of driver rows, each with its own Connect button that
 * advances the flow. Modeled on the Configure LLM Providers modal: the row itself is not
 * clickable, and there is no footer -- the row's button is the action, and the title bar's close
 * button dismisses the dialog.
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
	const [showError, setShowError] = useState(false);

	// Load the registered drivers and listen for changes.
	useEffect(() => {
		// Sorts driver metadata alphabetically by display name so the provider list has a stable,
		// predictable order regardless of the order drivers registered in.
		const byName = (metadata: IDataConnectionDriverMetadata[]) => [...metadata].sort((a, b) => a.name.localeCompare(b.name));

		// Set the initial list of drivers.
		setDrivers(byName(positronDataConnectionsService.driverManager.getDrivers().map(d => d.metadata)));

		// Listen for changes to the registered drivers and update the list accordingly. The error
		// below is about a driver that was in the list and is not in the registry; a new list makes
		// that message stale no matter which way the registration went, so retire it here.
		const disposable = positronDataConnectionsService.driverManager.onDidChangeDrivers(updatedDrivers => {
			setDrivers(byName(updatedDrivers.map(d => d.metadata)));
			setShowError(false);
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

	// Resolves the given driver id and advances to the next step.
	const proceedWithDriver = useCallback((driverId: string) => {
		// Get the driver. This can't fail. If it does, something is very wrong.
		const driver = positronDataConnectionsService.driverManager.getDriver(driverId);
		if (!driver) {
			console.error(`Selected driver with id ${driverId} not found`);
			setShowError(true);
			return;
		}

		// Proceed to the next step with the selected driver.
		onNext(driver);
	}, [onNext, positronDataConnectionsService.driverManager]);

	// Render.
	return (
		<PositronDynamicModalDialog
			content={
				<div className='select-data-connection-provider'>
					{/*
						role='alert' so a screen reader announces this the moment it appears. A
						failed Connect gives no other feedback -- the dialog stays where it is and
						focus stays on the button -- and the message renders above the list, away
						from that focus, so nothing would otherwise carry it to a screen reader.
					*/}
					{showError &&
						<div className='provider-list-error' role='alert'>
							{localize(
								'positron.selectDataConnectionProvider.providerUnavailable',
								"That provider is no longer available."
							)}
						</div>
					}
					{drivers.length === 0 ? (
						// No drivers registered yet; extensions providing them may still be loading.
						<div className='provider-list-placeholder'>
							{localize(
								'positron.selectDataConnectionProvider.loadingProviders',
								"Loading providers..."
							)}
						</div>
					) : (
						drivers.map(driver => (
							<div key={driver.id} className='provider-row'>
								<div className='provider-row-icon'>
									<img alt='' className='provider-row-logo' src={`data:image/svg+xml;base64,${driver.iconSvg}`} />
								</div>
								<div className='provider-row-text'>
									<div className='provider-row-name'>{driver.name}</div>
									{driver.description &&
										<div className='provider-row-desc'>{driver.description}</div>
									}
								</div>
								<div className='provider-row-actions'>
									<button
										aria-label={localize(
											'positron.selectDataConnectionProvider.connectTo',
											"Connect to {0}",
											driver.name
										)}
										className='provider-row-action'
										type='button'
										onClick={() => proceedWithDriver(driver.id)}
									>
										<span aria-hidden='true' className='codicon codicon-add' />
										{localize('positron.selectDataConnectionProvider.connect', "Connect")}
									</button>
								</div>
							</div>
						))
					)}
				</div>
			}
			contentMaxHeight={LIST_CONTENT_HEIGHT}
			contentMinHeight={LIST_CONTENT_HEIGHT}
			renderer={props.renderer}
			title={localize(
				'positron.selectDataConnectionProvider.title',
				"Add Data Connection"
			)}
			titleDescription={localize(
				'positron.selectDataConnectionProvider.selectProvider',
				"Select a provider"
			)}
			width={MODAL_WIDTH}
			onCancel={cancelHandler}
		/>
	);
};
