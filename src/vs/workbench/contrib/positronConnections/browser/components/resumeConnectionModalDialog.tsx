/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { PropsWithChildren, useEffect, useRef } from 'react';
import { localize } from 'vs/nls';
import { ContentArea } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/contentArea';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { PositronConnectionsServices } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/button/positronButton';
import 'vs/css!./resumeConnectionModalDialog';
import Severity from 'vs/base/common/severity';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditor/codeEditorWidget';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from 'vs/workbench/contrib/codeEditor/browser/simpleEditorOptions';
import { Emitter } from 'vs/base/common/event';

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
	const activeInstance = services.connectionsService.getConnections().find(item => item.id === activeInstaceId);

	const editorContainerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<CodeEditorWidget | null>(null);

	const code = activeInstance?.metadata.code;
	const language_id = activeInstance?.metadata.language_id;

	useEffect(() => {
		if (!editorContainerRef.current) {
			return () => { };
		}

		const disposableStore = new DisposableStore();
		const editor = disposableStore.add(services.instantiationService.createInstance(
			CodeEditorWidget,
			editorContainerRef.current,
			{
				...getSimpleEditorOptions(services.configurationService),
				readOnly: true,
				domReadOnly: true,
				cursorBlinking: 'solid',
			},
			getSimpleCodeEditorWidgetOptions()
		));

		const emitter = disposableStore.add(new Emitter<string>);
		const inputModel = disposableStore.add(services.modelService.createModel(
			code || '',
			{ languageId: language_id || '', onDidChange: emitter.event },
			undefined,
			true
		));

		editor.setModel(inputModel);
		editorRef.current = editor;

		return () => {
			disposableStore.dispose();
			editorRef.current = null;
		};
	},
		[
			code, language_id,
			services.instantiationService,
			services.configurationService,
			editorContainerRef,
			services.modelService,
		]);

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
							<div style={{ height: '100%' }} ref={editorContainerRef}></div>
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
								disabled={!activeInstance.connect}
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
