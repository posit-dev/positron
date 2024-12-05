/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import React, { PropsWithChildren, useState } from 'react';
import { localize } from 'vs/nls';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { PositronConnectionsServices } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import 'vs/css!./newConnectionModelDialog';
import { ContentArea } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/contentArea';
import { CreateConnection } from 'vs/workbench/contrib/positronConnections/browser/components/newConnectionModalDialog/createConnectionState';
import { ListDrivers } from 'vs/workbench/contrib/positronConnections/browser/components/newConnectionModalDialog/listDriversState';

const NEW_CONNECTION_MODAL_DIALOG_WIDTH = 700;
const NEW_CONNECTION_MODAL_DIALOG_HEIGHT = 430;

export const showNewConnectionModalDialog = (services: PositronConnectionsServices) => {

	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService: services.keybindingService,
		layoutService: services.layoutService,
		container: services.layoutService.activeContainer,
	});

	renderer.render(
		<NewConnectionModalDialog
			renderer={renderer}
			services={services}
		/>
	);
};

interface NewConnectionModalDialogProps {
	readonly renderer: PositronModalReactRenderer;
	readonly services: PositronConnectionsServices;
}

const NewConnectionModalDialog = (props: PropsWithChildren<NewConnectionModalDialogProps>) => {

	const [selectedDriver, setSelectedDriver] = useState<Driver | undefined>();

	const cancelHandler = () => {
		props.renderer.dispose();
	};

	const backHandler = () => {
		setSelectedDriver(undefined);
	};

	return <PositronModalDialog
		renderer={props.renderer}
		title={(() => localize('positron.newConnectionModalDialog.title', "Create New Connection"))()}
		width={NEW_CONNECTION_MODAL_DIALOG_WIDTH}
		height={NEW_CONNECTION_MODAL_DIALOG_HEIGHT}
		onCancel={cancelHandler}
	>
		<div className='connections-new-connection-modal'>
			<ContentArea>
				{
					selectedDriver ?
						<CreateConnection
							services={props.services}
							onCancel={cancelHandler}
							onBack={backHandler}
							selectedDriver={selectedDriver} /> :
						<ListDrivers
							services={props.services}
							onCancel={cancelHandler}
							onSelection={(driver) => setSelectedDriver(driver)}
						/>}
			</ContentArea>
		</div>
	</PositronModalDialog>;
};

export enum InputType {
	String = 'string',
	Number = 'number',
	Boolean = 'boolean',
}

export interface Input {
	// The unique identifier for the input.
	id: string;
	// A human-readable label for the input.
	label: string;
	// The type of the input.
	type: InputType;
}

export interface Driver {
	// The unique identifier for the driver.
	driverId: string;
	// The language identifier for the driver.
	// Drivers are grouped by language, not by runtime.
	languageId: string;
	// A human-readable name for the driver.
	name: string;
	// The base64-encoded SVG icon for the driver.
	base64EncodedIconSvg?: string;
	// The inputs required to create a connection.
	// For instance, a connection might require a username
	// and password.
	inputs: Array<Input>;
	// Generates the connection code based on the inputs.
	generateCode?: (inputs: Array<Input>) => string;
	// Checks if the dependencies for the driver are installed
	// and functioning.
	checkDependencies?: () => Promise<boolean>;
	// Installs the dependencies for the driver.
	// For instance, R packages would install the required
	// R packages, and or other dependencies.
	installDependencies?: () => Promise<boolean>;
}

