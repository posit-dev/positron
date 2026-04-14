/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './configureDataConnection.css';

// React.
import { useCallback } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DataConnectionActionBar } from './dataConnectionActionBar.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

/**
 * ConfigureDataConnectionProps interface.
 */
interface ConfigureDataConnectionProps {
	// The renderer.
	renderer: PositronModalReactRenderer;

	// The data connection profile being configured.
	dataConnectionProfile: IDataConnectionProfile;

	// Called when the user clicks Back to return to the select provider dialog.
	onBack?: () => void;
}

/**
 * ConfigureDataConnection component.
 * Displays a dialog with the connection configuration form for the selected driver.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ConfigureDataConnection = (props: ConfigureDataConnectionProps) => {
	// Destructure props for use in hooks.
	const { renderer, onBack } = props;

	// Cancel handler.
	const cancelHandler = useCallback(() => {
		// Dispose the renderer, which will close the dialog.
		renderer.dispose();
	}, [renderer]);

	// Back handler.
	const backHandler = useCallback(() => {
		if (onBack) {
			onBack();
		}
	}, [onBack]);

	// Accept handler.
	const acceptHandler = useCallback(() => {
		// TODO: Save the connection.
		renderer.dispose();
	}, [renderer]);

	// Render.
	return (
		<PositronModalDialog
			height={400}
			renderer={props.renderer}
			title={localize(
				'positron.configureDataConnection.title',
				"Configure Data Connection"
			)}
			width={600}
			onCancel={cancelHandler}
		>
			<ContentArea>
				<div className='configure-data-connection'>
				</div>
			</ContentArea>
			<DataConnectionActionBar
				acceptLabel={localize('positron.configureDataConnection.create', "Create")}
				onAccept={acceptHandler}
				onBack={backHandler}
				onCancel={cancelHandler}
			/>
		</PositronModalDialog>
	);
};
