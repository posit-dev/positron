/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { localize } from '../../../../../nls.js';
import { PreviewUrl, QUERY_NONCE_PARAMETER } from '../previewUrl.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { URI } from '../../../../../base/common/uri.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { kPaddingLeft, kPaddingRight } from './actionBars.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ITerminalInstance } from '../../../terminal/browser/terminal.js';

// Constants.
const kUrlBarInputName = 'url-bar';

/**
 * UrlActionBarsProps interface.
 */
export interface UrlActionBarsProps {

	// The active preview.
	readonly preview: PreviewUrl;
}

// Localized strings.
const navigateBack = localize('positron.preview.navigateBack', "Navigate back to the previous URL");
const navigateForward = localize('positron.preview.navigateForward', "Navigate back to the next URL");
const reload = localize('positron.preview.reload', "Reload the current URL");
const clear = localize('positron.preview.clear', "Clear the current URL");
const openInBrowser = localize('positron.preview.openInBrowser', "Open the current URL in the default browser");
const currentUrl = localize('positron.preview.currentUrl', "The current URL");
const openInEditor = localize('positron.preview.html.openInEditor', "Open the content in an editor tab");
const interruptExecution = localize('positron.preview.interruptExecution', "Interrupt execution");

/**
 * UrlActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const UrlActionBars = (props: PropsWithChildren<UrlActionBarsProps>) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Save the current URL.
	const currentUri = props.preview.currentUri;

	const urlInputRef = React.useRef<HTMLInputElement>(null);

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

	// Handler for the navigate back button.
	const navigateBackHandler = () => {
		props.preview.webview.postMessage({
			channel: 'execCommand',
			data: 'navigate-back'
		});
	};

	// Handler for the navigate forward button.
	const navigateForwardHandler = () => {
		props.preview.webview.postMessage({
			channel: 'execCommand',
			data: 'navigate-forward'
		});
	};

	// Handler for the reload button.
	const reloadHandler = () => {
		props.preview.webview.postMessage({
			channel: 'execCommand',
			data: 'reload-window'
		});
	};

	const openInEditorHandler = () => {
		services.positronPreviewService.openEditor(currentUri);
	};

	// Handler for the clear button.
	const clearHandler = () => {
		services.positronPreviewService.clearAllPreviews();
	};

	// Handler for the open in browser button.
	const openInBrowserHandler = () => {
		services.openerService.open(props.preview.currentUri,
			{ openExternal: true, fromUserGesture: true });
	};

	// Perform navigation to the given URL.
	const navigateToUrl = (url: string) => {
		// If the URL doesn't start with a scheme, assume it's an HTTP URL.
		if (!url.match(/^[a-zA-Z]+:\/\//)) {
			url = `http://${url}`;
		}

		// Validate the URL.
		let uri: URI;
		try {
			uri = URI.parse(url);
		} catch (e) {
			// Notify the user that the URL is invalid.
			services.notificationService.error(localize('positron.viewer.invalidUrl', "The URL {0} is invalid: {1}", url, e));

			// Restore the old input value.
			if (urlInputRef.current) {
				urlInputRef.current.value = currentUri.toString(true);
			}

			return;
		}

		// Navigate to the URL.
		props.preview.navigateToUri(uri);
	};

	// Handler that runs when the user submits the URL bar form.
	const navigateToHandler = (event: React.FormEvent) => {
		// Prevent default form action
		event.preventDefault();

		// Navigate to the URL.
		if (urlInputRef.current) {
			navigateToUrl(urlInputRef.current.value);
		}
	};

	// useEffect hook for URL navigation updates.
	useEffect(() => {
		const disposables = new DisposableStore();
		disposables.add(props.preview.onDidNavigate(e => {
			if (urlInputRef.current) {
				// Remove the nonce from the URL before updating the input; we
				// use this this for cache busting but the user doesn't need to
				// see it.
				if (e.query) {
					const nonceIndex = e.query.indexOf(`${QUERY_NONCE_PARAMETER}=`);
					if (nonceIndex !== -1) {
						const nonceEnd = e.query.indexOf('&', nonceIndex);
						if (nonceEnd !== -1) {
							e = e.with({
								query: e.query.slice(0, nonceIndex) + e.query.slice(nonceEnd + 1)
							});
						} else {
							e = e.with({
								query: e.query.slice(0, nonceIndex)
							});
						}
					}
				}
				urlInputRef.current.value = e.toString(true);
			}
		}));
		return () => disposables.dispose();
	}, [props.preview]);

	// useEffect hook to capture the source terminal when preview content changes.
	useEffect(() => {
		// Check if the preview has source information indicating it came from a terminal
		const source = props.preview.source;
		if (source && source.type === 'terminal') {
			// Find the terminal with the matching process ID
			const terminalId = parseInt(source.id, 10);

			// Search through all terminals to find the one with the matching process ID
			const terminal = services.terminalService.instances.find(
				instance => instance.processId === terminalId
			);

			if (terminal) {
				setSourceTerminal(terminal);
				if (terminal.hasChildProcesses) {
					setInterruptible(true);
					setInterrupting(false);
				}
			}
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
						<ActionBarButton ariaLabel={navigateBack}
							icon={ThemeIcon.fromId('positron-left-arrow')}
							tooltip={navigateBack}
							onPressed={navigateBackHandler} />
						<ActionBarButton
							ariaLabel={navigateForward}
							icon={ThemeIcon.fromId('positron-right-arrow')}
							tooltip={navigateForward}
							onPressed={navigateForwardHandler} />
					</ActionBarRegion>
					<ActionBarRegion location='center'>
						<form onSubmit={navigateToHandler}>
							<input
								ref={urlInputRef}
								aria-label={currentUrl}
								className='text-input url-bar'
								defaultValue={props.preview.currentUri.toString(true)}
								name={kUrlBarInputName}
								type='text'>
							</input>
						</form>
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
