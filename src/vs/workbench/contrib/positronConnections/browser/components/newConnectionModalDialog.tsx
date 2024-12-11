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
import { IDriver } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsDriver';

const NEW_CONNECTION_MODAL_DIALOG_WIDTH = 700;
const NEW_CONNECTION_MODAL_DIALOG_HEIGHT = 630;

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

	const [selectedDriver, setSelectedDriver] = useState<IDriver | undefined>();
	const [languageId, setLanguageId] = useState<string | undefined>(getPreferedLanguageId(props.services));

	const cancelHandler = () => {
		props.renderer.dispose();
	};

	const backHandler = () => {
		// When hitting back, reset the language ID to the previously selected language id
		setLanguageId(selectedDriver?.languageId);
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
							renderer={props.renderer}
							onCancel={cancelHandler}
							onBack={backHandler}
							selectedDriver={selectedDriver} /> :
						<ListDrivers
							services={props.services}
							onCancel={cancelHandler}
							onSelection={(driver) => setSelectedDriver(driver)}
							languageId={languageId}
							setLanguageId={setLanguageId}
						/>}
			</ContentArea>
		</div>
	</PositronModalDialog>;
};

const getPreferedLanguageId = (services: PositronConnectionsServices): string | undefined => {
	// If threre is a foreground session, use its language ID as the preferred language id
	return services.runtimeSessionService.foregroundSession?.runtimeMetadata.languageId;
};
