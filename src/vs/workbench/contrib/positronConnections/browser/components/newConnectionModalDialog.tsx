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

enum InputType {
	String = 'string',
	Number = 'number',
	Boolean = 'boolean',
}

interface Input {
	id: string;
	label: string;
	type: InputType;
}

export interface Driver {
	driverId: string;
	languageId: string;
	name: string;
	base64EncodedIconSvg?: string;
	inputs?: Array<Input>;
	generateCode?: (inputs: Map<string, string>) => string;
}

