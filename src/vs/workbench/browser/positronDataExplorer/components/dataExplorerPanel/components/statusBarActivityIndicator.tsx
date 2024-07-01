/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./statusBarActivityIndicator';

// React.
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { usePositronDataExplorerContext } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { DataExplorerClientStatus } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * StatusBarActivityIndicator component.
 * @returns The rendered component.
 */
export const StatusBarActivityIndicator = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// State hooks.
	const [dataExplorerClientStatus, setDataExplorerClientStatus] = useState(
		context.instance.dataExplorerClientInstance.status
	);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Set up onDidStatusUpdate event handler.
		let debounceTimeout: NodeJS.Timeout | undefined = undefined;
		disposableStore.add(context.instance.dataExplorerClientInstance.onDidStatusUpdate(
			newDataExplorerClientStatus => {
				// If there is a debounce timeout in flight, clear it.
				if (debounceTimeout) {
					clearTimeout(debounceTimeout);
					debounceTimeout = undefined;
				}

				// When transitioning from idle to something else, update the data explorer client
				// status immediately. Otherwise, debounce the status update.
				if (dataExplorerClientStatus === DataExplorerClientStatus.Idle &&
					dataExplorerClientStatus !== newDataExplorerClientStatus
				) {
					setDataExplorerClientStatus(newDataExplorerClientStatus);
				} else {
					debounceTimeout = setTimeout(
						() => setDataExplorerClientStatus(newDataExplorerClientStatus),
						250
					);
				}
			}
		));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context.instance.dataExplorerClientInstance, dataExplorerClientStatus]);

	// Set the status text.
	const statusText = (() => {
		switch (dataExplorerClientStatus) {
			case DataExplorerClientStatus.Idle:
				return localize('positron.dataExplorer.idle', 'Idle');

			case DataExplorerClientStatus.Computing:
				return localize('positron.dataExplorer.computing', 'Computing');

			case DataExplorerClientStatus.Disconnected:
				return localize('positron.dataExplorer.disconnected', 'Disconnected');

			case DataExplorerClientStatus.Error:
				return localize('positron.dataExplorer.error', 'Error');
		}
	})();

	// Set the status class name.
	const statusClassName = (() => {
		switch (dataExplorerClientStatus) {
			case DataExplorerClientStatus.Idle:
				return 'idle';

			case DataExplorerClientStatus.Computing:
				return 'computing';

			case DataExplorerClientStatus.Disconnected:
				return 'disconnected';

			case DataExplorerClientStatus.Error:
				return 'error';
		}
	})();

	// Render.
	return (
		<div className='status-bar-indicator'>
			<div className={`icon ${statusClassName}`} title={statusText} aria-label={statusText} />
		</div>
	);
};
