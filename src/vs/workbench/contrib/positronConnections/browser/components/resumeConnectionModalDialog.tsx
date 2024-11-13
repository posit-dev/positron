/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { PropsWithChildren } from 'react';
import { localize } from 'vs/nls';
import { ContentArea } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/contentArea';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { PositronConnectionsServices } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/button/positronButton';
import 'vs/css!./resumeConnectionModalDialog';
import Severity from 'vs/base/common/severity';

const RESUME_CONNECTION_MODAL_DIALOG_WIDTH = 700;
const RESUME_CONNECTION_MODAL_DIALOG_HEIGHT = 430;

export const showResumeConnectionModalDialog = (
	services: PositronConnectionsServices,
	activeInstanceId: string,
	setActiveInstanceId: (id: string) => void
) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService: services.keybindingService,
		layoutService: services.layoutService,
		container: services.layoutService.activeContainer
	});

	renderer.render(
		<ResumeConnectionModalDialog
			renderer={renderer}
			services={services}
			activeInstaceId={activeInstanceId}
			setActiveInstanceId={setActiveInstanceId}
		/>
	);
};

interface ResumeConnectionModalDialogProps {
	readonly renderer: PositronModalReactRenderer;
	readonly services: PositronConnectionsServices;
	readonly activeInstaceId: string;
	readonly setActiveInstanceId: (id: string) => void;
}

const ResumeConnectionModalDialog = (props: PropsWithChildren<ResumeConnectionModalDialogProps>) => {

	const { services, activeInstaceId } = props;
	const activeInstace = services.connectionsService.getConnections().find(item => item.id === activeInstaceId);

	if (!activeInstace) {
		// This should never happen.
		return null;
	}

	const code = activeInstace.metadata.code;

	const copyHandler = async () => {
		if (!code) {
			// The button is disabled when no code is available.
			return;
		}
		await services.clipboardService.writeText(code);
		props.renderer.dispose();

		const handle = services.connectionsService.notify(localize(
			'positron.resumeConnectionModalDialog.codeCopied',
			"Connection code copied to clipboard"
		), Severity.Info);
		// close the notification after 2 seconds
		setTimeout(() => handle.close(), 2000);
	};

	const editHandler = async () => {
		if (!code) {
			return;
		}

		props.renderer.dispose();
		await services.editorService.openEditor({
			resource: undefined,
			contents: code,
			languageId: activeInstace.metadata.language_id
		});
	};

	const resumeHandler = async () => {
		if (!activeInstace.connect) {
			return;
		}

		props.renderer.dispose();
		const handle = services.notificationService.notify({
			message: localize(
				'positron.resumeConnectionModalDialog.connecting',
				"Connecting to data source ({0})...",
				activeInstace.metadata.name
			),
			severity: Severity.Info
		});

		try {
			await activeInstace.connect();
			props.setActiveInstanceId(activeInstace.id);
		} catch (err) {
			services.notificationService.error(err);
		}

		handle.close();
	};

	const cancelHandler = () => {
		props.renderer.dispose();
	};

	return (
		<div className='connections-resume-connection-modal'>
			<PositronModalDialog
				width={RESUME_CONNECTION_MODAL_DIALOG_WIDTH}
				height={RESUME_CONNECTION_MODAL_DIALOG_HEIGHT}
				title={(() => localize('positron.resumeConnectionModalDialog.title', "Resume Connection"))()}
				onCancel={cancelHandler}
				renderer={props.renderer}
			>
				<ContentArea>
					<div className='content'>
						<div className='title'>{localize('positron.resumeConnectionModalDialog.code', "Connection Code")}</div>
						<div className='code'>
							<code>{code}</code>
						</div>
						<div className='buttons'>
							<div className='top'>
								<PositronButton
									className='button action-bar-button'
									onPressed={editHandler}
									disabled={!code}
								>
									{(() => localize('positron.resumeConnectionModalDialog.edit', "Edit"))()}
								</PositronButton>
							</div>
							<div className='bottom'>
								<PositronButton
									className='button action-bar-button'
									onPressed={copyHandler}
									disabled={!code}
								>
									{(() => localize('positron.resumeConnectionModalDialog.copy', "Copy"))()}
								</PositronButton>
								<PositronButton
									className='button action-bar-button'
									onPressed={cancelHandler}
								>
									{(() => localize('positron.resumeConnectionModalDialog.cancel', "Cancel"))()}
								</PositronButton>
							</div>
						</div>
						<div className='footer'>
							<PositronButton
								className='button action-bar-button default'
								onPressed={resumeHandler}
								disabled={!activeInstace.connect}
							>
								{(() => localize('positron.resumeConnectionModalDialog.resume', "Resume Connection"))()}
							</PositronButton>
						</div>
					</div>
				</ContentArea>
			</PositronModalDialog>
		</div>
	);
};
