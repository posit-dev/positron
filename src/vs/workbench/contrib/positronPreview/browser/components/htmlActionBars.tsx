/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { kPaddingLeft, kPaddingRight } from './actionBars.js';
import { PreviewHtml } from '../previewHtml.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ITerminalInstance } from '../../../terminal/browser/terminal.js';

const reload = localize('positron.preview.html.reload', "Reload the content");
const clear = localize('positron.preview.html.clear', "Clear the content");
const openInBrowser = localize('positron.preview.html.openInBrowser', "Open the content in the default browser");
const openInEditor = localize('positron.preview.html.openInEditor', "Open the content in an editor tab");
const interruptExecution = localize('positron.preview.html.interruptExecution', "Interrupt execution");

/**
 * HtmlActionBarsProps interface.
 */
export interface HtmlActionBarsProps {

	// The active preview.
	readonly preview: PreviewHtml;
}

export const HtmlActionBars = (props: PropsWithChildren<HtmlActionBarsProps>) => {

	const services = usePositronReactServicesContext();
	const [title, setTitle] = useState(props.preview.html?.title);

	// State hooks for interrupt button
	const [interruptible, setInterruptible] = useState(false);
	const [interrupting, setInterrupting] = useState(false);
	// Track which terminal is running the app displayed in the viewer
	const [sourceTerminal, setSourceTerminal] = useState<ITerminalInstance | undefined>(undefined);

	// Handler for the interrupt button.
	const interruptHandler = async () => {
		// Set the interrupting flag to debounce the button.
		setInterrupting(true);

		// Send Ctrl+C to the source terminal
		if (sourceTerminal && sourceTerminal.hasChildProcesses) {
			// Send Ctrl+C (SIGINT) to the terminal
			sourceTerminal.sendText('\x03', false);
		}
	};

	// Handler for the reload button.
	const reloadHandler = () => {
		props.preview.webview.postMessage({
			channel: 'execCommand',
			data: 'reload-window'
		});
	};

	// Handler for the clear button.
	const clearHandler = () => {
		services.positronPreviewService.clearAllPreviews();
	};

	// Handler for the open in browser button.
	const openInBrowserHandler = () => {
		services.openerService.open(props.preview.uri,
			{ openExternal: true, fromUserGesture: true });
	};

	// Handler for open in editor button
	const openInEditorHandler = () => {
		services.positronPreviewService.openEditor(props.preview.uri, title);
	};

	// Main use effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();
		disposableStore.add(props.preview.webview.onDidLoad((title) => {
			if (title) {
				setTitle(title);
			}
		}));
		return () => disposableStore.dispose();
	}, [props.preview.webview]);

	// useEffect hook to capture the source terminal when preview content changes.
	useEffect(() => {
		// When new preview content appears, assume the active terminal launched it
		const activeTerminal = services.terminalService.activeInstance;
		if (activeTerminal && activeTerminal.hasChildProcesses) {
			setSourceTerminal(activeTerminal);
			setInterruptible(true);
			setInterrupting(false);
		}
	}, [props.preview, services.terminalService]);

	// useEffect hook to track the source terminal's child process state.
	useEffect(() => {
		if (!sourceTerminal) {
			setInterruptible(false);
			return;
		}

		const disposables = new DisposableStore();

		// Set initial state based on source terminal
		setInterruptible(sourceTerminal.hasChildProcesses);
		setInterrupting(false);

		// Listen to child process changes on the source terminal
		disposables.add(
			sourceTerminal.onDidChangeHasChildProcesses((hasChildProcesses: boolean) => {
				setInterruptible(hasChildProcesses);
				// Reset interrupting state when child processes stop
				if (!hasChildProcesses) {
					setInterrupting(false);
					// Clear the source terminal when processes stop
					setSourceTerminal(undefined);
				}
			})
		);

		// Listen for terminal disposal
		disposables.add(
			sourceTerminal.onDisposed(() => {
				setInterruptible(false);
				setInterrupting(false);
				setSourceTerminal(undefined);
			})
		);

		return () => disposables.dispose();
	}, [sourceTerminal]);

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars preview-action-bar'>
				<PositronActionBar borderBottom={true} borderTop={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion location='left'>
						<span className='codicon codicon-file'></span>
					</ActionBarRegion>
					<ActionBarRegion location='center'>
						<span className='preview-title'>{title}</span>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						{interruptible && (
							<>
								<ActionBarButton
									align='right'
									ariaLabel={interruptExecution}
									disabled={interrupting}
									tooltip={interruptExecution}
									onPressed={interruptHandler}>
									<div className='action-bar-button-icon interrupt codicon codicon-positron-interrupt-runtime' />
								</ActionBarButton>
								<ActionBarSeparator />
							</>
						)}
						<ActionBarButton
							align='right'
							ariaLabel={reload}
							icon={ThemeIcon.fromId('positron-refresh')}
							tooltip={reload}
							onPressed={reloadHandler} />
						<ActionBarButton
							align='right'
							ariaLabel={openInBrowser}
							icon={ThemeIcon.fromId('positron-open-in-new-window')}
							tooltip={openInBrowser}
							onPressed={openInBrowserHandler} />
						<ActionBarSeparator />
						<ActionBarButton
							align='right'
							ariaLabel={openInEditor}
							icon={ThemeIcon.fromId('go-to-file')}
							tooltip={openInEditor}
							onPressed={openInEditorHandler} />
						<ActionBarSeparator />
						<ActionBarButton
							align='right'
							ariaLabel={clear}
							icon={ThemeIcon.fromId('clear-all')}
							tooltip={clear}
							onPressed={clearHandler} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
