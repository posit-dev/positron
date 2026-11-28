/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { PreviewWebview } from '../previewWebview.js';
import { POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT, POSITRON_VIEWER_CAN_ZOOM_IN, POSITRON_VIEWER_CAN_ZOOM_OUT, POSITRON_VIEWER_FIT_TO_WIDTH, VIEWER_BROWSER_COMMANDS } from '../positronPreviewActions.js';

const toggleDevTools = localize('positron.preview.toggleDevTools', "Toggle Developer Tools");
const addToAssistant = localize('positron.preview.addToAssistant', "Add to Posit Assistant");
const zoom = localize('positron.preview.zoom', "Zoom");

/**
 * The buttons for content the Viewer shows in the integrated browser: its
 * zoom, its developer tools, and adding what it shows to Posit Assistant.
 */
export const BrowserActionButtons = (props: { readonly preview: PreviewWebview }) => {
	const services = usePositronReactServicesContext();
	const contextKeyService = services.contextKeyService;
	const [canSendToAssistant, setCanSendToAssistant] = useState(() => contextKeyService.contextMatchesRules(POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT));

	useEffect(() => {
		const canSend = () => contextKeyService.contextMatchesRules(POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT);
		const keys = new Set(POSITRON_VIEWER_CAN_SEND_TO_ASSISTANT.keys());
		const disposable = contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(keys)) {
				setCanSendToAssistant(canSend());
			}
		});
		setCanSendToAssistant(canSend());
		return () => disposable.dispose();
	}, [contextKeyService]);

	if (props.preview.surface.kind !== 'browser') {
		return null;
	}

	const run = (id: string) => () => services.commandService.executeCommand(id);
	const assistantActions = (): IAction[] => [
		[VIEWER_BROWSER_COMMANDS.addElement, localize('positron.preview.addElement', "Add Element")],
		[VIEWER_BROWSER_COMMANDS.commentOnElement, localize('positron.preview.commentOnElement', "Comment on Elements")],
		[VIEWER_BROWSER_COMMANDS.addScreenshot, localize('positron.preview.addScreenshot', "Add Screenshot")],
		[VIEWER_BROWSER_COMMANDS.addConsoleLogs, localize('positron.preview.addConsoleLogs', "Add Console Logs")],
	].map(([id, label]) => ({ id, label, tooltip: '', class: undefined, enabled: true, run: run(id) }));
	const zoomActions = (): IAction[] => {
		const action = (id: string, label: string, enabled = true, checked?: boolean): IAction =>
			({ id, label, tooltip: '', class: undefined, enabled, checked, run: run(id) });
		return [
			action(VIEWER_BROWSER_COMMANDS.zoomIn, localize('positron.preview.zoomIn', "Zoom In"), !!POSITRON_VIEWER_CAN_ZOOM_IN.getValue(contextKeyService)),
			action(VIEWER_BROWSER_COMMANDS.zoomOut, localize('positron.preview.zoomOut', "Zoom Out"), !!POSITRON_VIEWER_CAN_ZOOM_OUT.getValue(contextKeyService)),
			action(VIEWER_BROWSER_COMMANDS.resetZoom, localize('positron.preview.resetZoom', "Reset Zoom")),
			new Separator(),
			action(VIEWER_BROWSER_COMMANDS.toggleFitToWidth, localize('positron.preview.fitToWidth', "Fit to Width"), true, !!POSITRON_VIEWER_FIT_TO_WIDTH.getValue(contextKeyService)),
		];
	};

	return (
		<>
			<ActionBarMenuButton
				actions={zoomActions}
				align='right'
				ariaLabel={zoom}
				icon={ThemeIcon.fromId('zoom-in')}
				tooltip={zoom} />
			{canSendToAssistant &&
				<ActionBarMenuButton
					actions={assistantActions}
					align='right'
					ariaLabel={addToAssistant}
					icon={ThemeIcon.fromId('inspect')}
					tooltip={addToAssistant} />
			}
			<ActionBarButton
				align='right'
				ariaLabel={toggleDevTools}
				icon={ThemeIcon.fromId('developer-tools')}
				tooltip={toggleDevTools}
				onPressed={run(VIEWER_BROWSER_COMMANDS.toggleDevTools)} />
		</>
	);
};
