/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { IAction } from '../../../../../base/common/actions.js';
import { localize } from '../../../../../nls.js';
import { PreviewUrl } from '../previewUrl.js';
import { PreviewHtml } from '../previewHtml.js';
import { PreviewWebview } from '../previewWebview.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { URI } from '../../../../../base/common/uri.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { kPaddingLeft, kPaddingRight } from './actionBars.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ITerminalInstance } from '../../../terminal/browser/terminal.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE, PreviewOpenTarget } from '../positronPreviewSevice.js';
import { BrowserActionButtons } from './browserActionButtons.js';
import { PositronOpenUrlInViewerAction } from '../positronPreviewActions.js';

// Constants.
const kUrlBarInputName = 'url-bar';

/**
 * PreviewActionBarsProps interface.
 */
export interface PreviewActionBarsProps {

	// The active preview; when there is none, the URL bar opens a new one.
	readonly preview?: PreviewWebview;
}

// Localized strings.
const navigateBack = localize('positron.preview.navigateBack', "Go back");
const navigateForward = localize('positron.preview.navigateForward', "Go forward");
const reload = localize('positron.preview.reload', "Reload the content");
const clear = localize('positron.preview.clear', "Clear the content");
const stop = localize('positron.preview.stop', "Stop the preview");
const currentContent = localize('positron.preview.currentContent', "The content showing");
const openInBrowserLabel = localize('positron.preview.openInBrowser.menu', "Open in Browser");
const openInEditorLabel = localize('positron.preview.openInEditor.menu', "Open in Editor Tab");
const openInDropdownLabel = localize('positron.preview.openInDropdown', "Select where to open");
const currentUrl = localize('positron.preview.currentUrl', "The current URL");
const enterUrl = localize('positron.preview.enterUrl', "Enter a URL to preview");
const interruptExecution = localize('positron.preview.interruptExecution', "Interrupt execution");

/**
 * The title to show for content without a URL, before its page loads.
 */
function initialTitle(preview: PreviewWebview): string | undefined {
	if (preview instanceof PreviewHtml) {
		return preview.html?.title;
	}
	if (preview.viewType === POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE) {
		return localize('positron.preview.output', "{0} output", preview.name);
	}
	return preview.name;
}

/**
 * PreviewActionBars component: navigation through the Viewer's history, the
 * URL of the content or its title when it has none, and actions on it.
 * @param props A PreviewActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const PreviewActionBars = (props: PropsWithChildren<PreviewActionBarsProps>) => {
	// Context hooks.
	const services = usePositronReactServicesContext();
	const previewService = services.positronPreviewService;

	const content = props.preview;
	const urlPreview = content instanceof PreviewUrl ? content : undefined;

	const [canGoBack, setCanGoBack] = useState(previewService.canGoBack);
	const [canGoForward, setCanGoForward] = useState(previewService.canGoForward);
	const [title, setTitle] = useState(() => content && (content.surface.title ?? initialTitle(content)));

	const urlInputRef = React.useRef<HTMLInputElement>(null);

	// State hooks for interrupt button
	const [interruptible, setInterruptible] = useState(false);
	const [interrupting, setInterrupting] = useState(false);

	// The app source is either a terminal or a runtime session, never both.
	type AppSource =
		| { readonly type: 'terminal'; readonly terminal: ITerminalInstance }
		| { readonly type: 'runtime'; readonly sessionId: string };
	const [appSource, setAppSource] = useState<AppSource | undefined>(undefined);
	const sourceTerminal = appSource?.type === 'terminal' ? appSource.terminal : undefined;
	const sourceSessionId = appSource?.type === 'runtime' ? appSource.sessionId : undefined;

	// Handler for the interrupt button.
	const interruptHandler = async () => {
		// Immediately hide the button to provide instant feedback
		setInterruptible(false);

		if (sourceSessionId) {
			await services.runtimeSessionService.interruptSession(sourceSessionId);
		} else if (sourceTerminal && sourceTerminal.hasChildProcesses) {
			// Send Ctrl+C (SIGINT) to the terminal
			sourceTerminal.sendText('\x03', false);

			// Poll after 3 seconds to check if the process actually stopped
			const terminalToCheck = sourceTerminal;
			setTimeout(() => {
				// Check if the process is still running
				if (terminalToCheck && !terminalToCheck.isDisposed && terminalToCheck.hasChildProcesses) {
					services.notificationService.error(
						localize('positron.preview.interruptFailed', "Failed to interrupt the running process. The process may need to be terminated manually from the terminal.")
					);
				}
			}, 3000);
		}
	};

	// Handler for the reload button.
	const reloadHandler = () => content?.surface.reload();

	// State for the remembered "Open in..." target. Persisted via the preview
	// service so it survives remounts and reloads.
	const [rememberedOpenTarget, setRememberedOpenTarget] = useState<PreviewOpenTarget>(() =>
		services.positronPreviewService.getDefaultOpenTarget()
	);

	const openInEditorHandler = () => {
		if (!content?.address) {
			return;
		}
		setRememberedOpenTarget(PreviewOpenTarget.EditorTab);
		services.positronPreviewService.setDefaultOpenTarget(PreviewOpenTarget.EditorTab);
		services.positronPreviewService.openEditor(content.address, urlPreview ? undefined : title);
	};

	// Handler for the clear button.
	const clearHandler = () => {
		services.positronPreviewService.clearAllPreviews();
	};

	// Handler for the open in browser button.
	const openInBrowserHandler = () => {
		if (!content?.address) {
			return;
		}
		setRememberedOpenTarget(PreviewOpenTarget.Browser);
		services.positronPreviewService.setDefaultOpenTarget(PreviewOpenTarget.Browser);
		services.openerService.open(content.address,
			{ openExternal: true, fromUserGesture: true });
	};

	// Builds the dropdown actions. The "checked" action is the remembered
	// target, which is what the split-button's primary click repeats.
	const openInActions = (): IAction[] => [
		{
			id: 'positron.preview.openInBrowser',
			label: openInBrowserLabel,
			tooltip: '',
			class: undefined,
			checked: rememberedOpenTarget === PreviewOpenTarget.Browser,
			enabled: true,
			run: openInBrowserHandler,
		},
		{
			id: 'positron.preview.openInEditor',
			label: openInEditorLabel,
			tooltip: '',
			class: undefined,
			checked: rememberedOpenTarget === PreviewOpenTarget.EditorTab,
			enabled: true,
			run: openInEditorHandler,
		},
	];

	// Perform navigation to the given URL.
	const navigateToUrl = (url: string) => {
		// With no URL preview, open one; the command validates the URL.
		if (!urlPreview) {
			services.commandService.executeCommand(PositronOpenUrlInViewerAction.ID, url).catch(e =>
				services.notificationService.error(e));
			return;
		}

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
				urlInputRef.current.value = urlPreview.currentUri.toString(true);
			}

			return;
		}

		// Navigate to the URL.
		urlPreview.navigateToUri(uri);
	};

	// Handler that runs when the user submits the URL bar form.
	const navigateToHandler = (event: React.FormEvent) => {
		// Prevent default form action
		event.preventDefault();

		// Navigate to the URL.
		if (urlInputRef.current?.value) {
			navigateToUrl(urlInputRef.current.value);
		}
	};

	// Track whether back and forward go anywhere.
	useEffect(() => {
		const disposable = previewService.onDidChangeNavigationState(() => {
			setCanGoBack(previewService.canGoBack);
			setCanGoForward(previewService.canGoForward);
		});
		setCanGoBack(previewService.canGoBack);
		setCanGoForward(previewService.canGoForward);
		return () => disposable.dispose();
	}, [previewService]);

	// Track the title of content without a URL.
	useEffect(() => {
		if (!content || urlPreview) {
			return;
		}
		const disposable = content.surface.onDidLoad(title => {
			if (title) {
				setTitle(title);
			}
		});
		return () => disposable.dispose();
	}, [content, urlPreview]);

	// useEffect hook for URL navigation updates.
	useEffect(() => {
		if (!urlPreview) {
			return;
		}
		const disposable = urlPreview.onDidNavigate(e => {
			if (urlInputRef.current) {
				urlInputRef.current.value = e.toString(true);
			}
		});
		return () => disposable.dispose();
	}, [urlPreview]);

	// useEffect hook to capture the source when preview content changes.
	useEffect(() => {
		const source = urlPreview?.source;
		if (!source) {
			setAppSource(undefined);
			setInterruptible(false);
			setInterrupting(false);
			return;
		}

		if (source.type === 'terminal') {
			// Find the terminal with the matching process ID
			const terminalId = parseInt(source.id, 10);

			// Search through all terminals to find the one with the matching process ID
			const terminal = services.terminalService.instances.find(
				instance => instance.processId === terminalId
			);

			if (terminal) {
				setAppSource({ type: 'terminal', terminal });
				if (terminal.hasChildProcesses) {
					setInterruptible(true);
					setInterrupting(false);
				}
			}
		} else if (source.type === 'runtime') {
			const session = services.runtimeSessionService.getSession(source.id);
			if (session) {
				setAppSource({ type: 'runtime', sessionId: source.id });
				setInterruptible(session.getRuntimeState() === RuntimeState.Busy);
				setInterrupting(false);
			}
		}
	}, [urlPreview, services.terminalService, services.runtimeSessionService]);

	// useEffect hook to track the source terminal's child process state.
	useEffect(() => {
		if (!sourceTerminal) {
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
					// Clear the viewer when the process stops
					services.positronPreviewService.clearAllPreviews();
					// Clear the source terminal when processes stop
					setAppSource(undefined);
				}
			})
		);

		// Listen for terminal disposal
		disposables.add(
			sourceTerminal.onDisposed(() => {
				setInterruptible(false);
				setInterrupting(false);
				setAppSource(undefined);
			})
		);

		return () => disposables.dispose();
	}, [sourceTerminal, services.positronPreviewService]);

	// Track the source runtime session's state for the stop button
	useEffect(() => {
		if (!sourceSessionId) {
			return;
		}

		const disposables = new DisposableStore();

		disposables.add(
			services.runtimeSessionService.onDidChangeRuntimeState(e => {
				if (e.session_id !== sourceSessionId) {
					return;
				}

				const busy = e.new_state === RuntimeState.Busy;
				setInterruptible(busy);
				if (!busy) {
					setInterrupting(false);
				}

				if (e.new_state === RuntimeState.Exited) {
					setAppSource(undefined);
				}
			})
		);

		return () => disposables.dispose();
	}, [sourceSessionId, services.runtimeSessionService]);

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars preview-action-bar'>
				<PositronActionBar borderBottom={true} borderTop={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion location='left'>
						<ActionBarButton ariaLabel={navigateBack}
							disabled={!canGoBack}
							icon={ThemeIcon.fromId('positron-left-arrow')}
							tooltip={navigateBack}
							onPressed={() => previewService.goBack()} />
						<ActionBarButton
							ariaLabel={navigateForward}
							disabled={!canGoForward}
							icon={ThemeIcon.fromId('positron-right-arrow')}
							tooltip={navigateForward}
							onPressed={() => previewService.goForward()} />
					</ActionBarRegion>
					<ActionBarRegion location='center' minWidth={0}>
						<form onSubmit={navigateToHandler}>
							{content && !urlPreview ?
								// Content without a URL shows its title, which can't be edited.
								<input
									aria-label={currentContent}
									className='text-input url-bar'
									disabled={true}
									title={title}
									type='text'
									value={title ?? ''}>
								</input> :
								<input
									ref={urlInputRef}
									aria-label={currentUrl}
									className='text-input url-bar'
									defaultValue={urlPreview?.currentUri.toString(true)}
									name={kUrlBarInputName}
									placeholder={enterUrl}
									type='text'>
								</input>
							}
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
							</>
						)}
						{content?.stoppable &&
							<ActionBarButton
								align='right'
								ariaLabel={stop}
								tooltip={stop}
								onPressed={() => content.requestStop()}>
								<div className='action-bar-button-icon interrupt codicon codicon-positron-interrupt-runtime' />
							</ActionBarButton>
						}
						{content && <>
							<BrowserActionButtons preview={content} />
							{content.address && <>
								<ActionBarButton
									align='right'
									ariaLabel={reload}
									icon={ThemeIcon.fromId('refresh')}
									tooltip={reload}
									onPressed={reloadHandler} />
								<ActionBarMenuButton
									actions={openInActions}
									align='right'
									ariaLabel={openInDropdownLabel}
									dropdownAriaLabel={openInDropdownLabel}
									dropdownIndicator='enabled-split'
									dropdownTooltip={openInDropdownLabel}
									icon={ThemeIcon.fromId('positron-open-in-new-window')}
									tooltip={openInDropdownLabel} />
							</>}
							<ActionBarSeparator />
							<ActionBarButton
								align='right'
								ariaLabel={clear}
								icon={ThemeIcon.fromId('clear-all')}
								tooltip={clear}
								onPressed={clearHandler} />
						</>}
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
