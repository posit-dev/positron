/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './resumeConnectionModalDialog.css';

// React.
import React, { PropsWithChildren, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { PositronModalReactRenderer } from '../../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { PositronConnectionsServices } from '../positronConnectionsContext.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import Severity from '../../../../../base/common/severity.js';
import { SimpleCodeEditor, SimpleCodeEditorWidget } from './simpleCodeEditor.js';

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
		container: services.layoutService.activeContainer,
	});

	renderer.render(
		<ResumeConnectionModalDialog
			activeInstaceId={activeInstanceId}
			renderer={renderer}
			services={services}
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
	const activeInstance = services.connectionsService.getConnections().find(item => item.id === activeInstaceId);

	const editorRef = useRef<SimpleCodeEditorWidget>(undefined!);

	const code = activeInstance?.metadata.code;
	const language_id = activeInstance?.metadata.language_id;

	if (!activeInstance) {
		// This should never happen.
		return null;
	}

	const copyHandler = async () => {
		const code = editorRef.current?.getValue() || '';
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
		const editor = editorRef.current;

		if (!editor) {
			return;
		}

		editor.focus();
		editor.updateOptions({ readOnly: false, domReadOnly: false, cursorBlinking: 'blink' });
		editor.setScrollTop(0);
	};

	const resumeHandler = async () => {
		if (!activeInstance.connect) {
			return;
		}

		// Acquire code before disposing of the renderer
		const code = editorRef.current?.getValue();

		props.renderer.dispose();
		const handle = services.notificationService.notify({
			message: localize(
				'positron.resumeConnectionModalDialog.connecting',
				"Connecting to data source ({0})...",
				activeInstance.metadata.name
			),
			severity: Severity.Info
		});

		try {
			// Set instance code to the latest value.
			activeInstance.metadata.update({ code: code });
			await activeInstance.connect();
			props.setActiveInstanceId(activeInstance.id);
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
				height={RESUME_CONNECTION_MODAL_DIALOG_HEIGHT}
				renderer={props.renderer}
				title={(() => localize('positron.resumeConnectionModalDialog.title', "Resume Connection"))()}
				width={RESUME_CONNECTION_MODAL_DIALOG_WIDTH}
				onCancel={cancelHandler}
			>
				<ContentArea>
					<div className='content'>
						<div className='title'>{localize('positron.resumeConnectionModalDialog.code', "Connection Code")}</div>
						<div className='code'>
							<SimpleCodeEditor
								ref={editorRef}
								code={code}
								editorOptions={{
									readOnly: true,
									domReadOnly: true,
									cursorBlinking: 'solid',
								}}
								language={language_id}
								services={services}
							></SimpleCodeEditor>
						</div>
						<div className='buttons'>
							<div className='top'>
								<PositronButton
									className='button action-bar-button'
									disabled={!code}
									onPressed={editHandler}
								>
									{(() => localize('positron.resumeConnectionModalDialog.edit', "Edit"))()}
								</PositronButton>
							</div>
							<div className='bottom'>
								<PositronButton
									className='button action-bar-button'
									disabled={!code}
									onPressed={copyHandler}
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
								disabled={!activeInstance.connect}
								onPressed={resumeHandler}
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
