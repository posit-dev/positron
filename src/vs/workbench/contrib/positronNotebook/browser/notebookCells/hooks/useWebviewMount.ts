/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { getWindow, addDisposableListener } from '../../../../../../base/browser/dom.js';
import { INotebookOutputWebview } from '../../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { isHTMLOutputWebviewMessage } from '../../../../positronWebviewPreloads/browser/notebookOutputUtils.js';
import { useNotebookInstance } from '../../NotebookInstanceProvider.js';
import { useServices } from '../../ServicesProvider.js';
import { IOverlayWebview } from '../../../../webview/browser/webview.js';
import { IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { useNotebookVisibility } from '../../NotebookVisibilityContext.js';
import { Event } from '../../../../../../base/common/event.js';


export function useWebviewMount(webview: Promise<INotebookOutputWebview>) {
	const [isLoading, setIsLoading] = React.useState(true);
	const [error, setError] = React.useState<Error | null>(null);
	const containerRef = React.useRef<HTMLDivElement>(null);
	const notebookInstance = useNotebookInstance();
	const visibilityObservable = useNotebookVisibility();
	const { editorService, layoutService } = useServices();

	React.useEffect(() => {
		const controller = new AbortController();
		let webviewElement: IOverlayWebview | undefined;
		let scrollDisposable: IDisposable | undefined;
		let visibilityObserver: IDisposable | undefined;
		let containerBlurDisposable: IDisposable | undefined;
		let editorChangeDisposable: IDisposable | undefined;
		let resizeObserver: ResizeObserver | undefined;

		/**
		 * Updates the layout of the webview element if both the webview and container are available
		 */
		// Track if there's a pending layout update
		let layoutTimeout: number | undefined;
		function updateWebviewLayout(immediate = false) {
			if (!webviewElement || !containerRef.current) { return; }

			// Clear any pending layout update
			if (layoutTimeout !== undefined) {
				window.clearTimeout(layoutTimeout);
				layoutTimeout = undefined;
			}

			const doLayout = () => {
				if (!containerRef.current || !notebookInstance.cellsContainer) {
					return;
				}

				webviewElement?.layoutWebviewOverElement(
					containerRef.current,
					undefined,
					notebookInstance.cellsContainer
				);
			};

			if (immediate) {
				doLayout();
			} else {
				// Add a small delay to ensure the layout has settled
				layoutTimeout = window.setTimeout(doLayout, 50);
			}
		}

		function claimWebview() {
			if (!webviewElement || !containerRef.current) { return; }
			webviewElement.claim(
				containerRef,
				getWindow(containerRef.current),
				undefined
			);
		}

		function releaseWebview() {
			webviewElement?.release(containerRef)
		}

		async function mountWebview() {
			const emptyDisposable = toDisposable(() => { });
			try {
				// If not visible, don't mount the webview
				if (!visibilityObservable) {
					return emptyDisposable;
				}

				const resolvedWebview = await webview;

				if (controller.signal.aborted || !containerRef.current) {
					return emptyDisposable;
				}

				setIsLoading(false);
				webviewElement = resolvedWebview.webview;

				claimWebview();

				// Initial layout
				updateWebviewLayout();

				// Update layout on scroll and visibility changes
				scrollDisposable = notebookInstance.onDidScrollCellsContainer(() => updateWebviewLayout(true));

				// Update layout when focus leaves the notebook container
				if (notebookInstance.cellsContainer) {
					containerBlurDisposable = addDisposableListener(notebookInstance.cellsContainer, 'focusout', (e) => {
						// Only update if focus is moving outside the notebook container
						if (!notebookInstance.cellsContainer?.contains(e.relatedTarget as Node)) {
							updateWebviewLayout(true);
						}
					});
				}

				webviewElement.onMessage((x) => {
					const { message } = x;
					if (!isHTMLOutputWebviewMessage(message) || !containerRef.current) { return; }
					// Set the height of the webview to the height of the content
					// Don't allow the webview to be taller than 1000px
					const maxHeight = 1000;
					let boundedHeight = Math.min(message.bodyScrollHeight, maxHeight);
					if (boundedHeight === 150) {
						// 150 is a default size that we want to avoid, otherwise we'll get
						// empty outputs that are 150px tall
						boundedHeight = 0;
					}
					containerRef.current.style.height = `${boundedHeight}px`;
				});

				// Listen for all editor and layout changes that might affect the webview
				const handleLayoutChange = () => updateWebviewLayout(false);
				editorChangeDisposable = Event.any(
					editorService.onDidActiveEditorChange,
					editorService.onDidVisibleEditorsChange, // Catches editor group changes
					layoutService.onDidLayoutMainContainer, // Listen for main container layout changes
					layoutService.onDidLayoutContainer, // Listen for any container layout changes
					layoutService.onDidLayoutActiveContainer, // Listen for active container layout changes
					layoutService.onDidChangePartVisibility,
					layoutService.onDidChangeZenMode,
					layoutService.onDidChangeWindowMaximized,
					layoutService.onDidChangePanelAlignment,
					layoutService.onDidChangePanelPosition,
					layoutService.onDidChangeMainEditorCenteredLayout // Listen for main editor centered layout changes
				)(handleLayoutChange);

				// Create and setup resize observer for layout changes
				resizeObserver = new ResizeObserver(() => {
					updateWebviewLayout(true);
				});

				if (notebookInstance.cellsContainer) {
					resizeObserver.observe(notebookInstance.cellsContainer);
				}

				// Update layout when focus leaves the notebook container
				if (notebookInstance.cellsContainer) {
					containerBlurDisposable = addDisposableListener(notebookInstance.cellsContainer, 'focusout', (e) => {
						// Only update if focus is moving outside the notebook container
						if (!notebookInstance.cellsContainer?.contains(e.relatedTarget as Node)) {
							updateWebviewLayout(true);
						}
					});
				}

				return scrollDisposable;

			} catch (err) {
				setError(err instanceof Error ? err : new Error('Failed to mount webview'));
				setIsLoading(false);
				return emptyDisposable;
			}
		}


		Event.fromObservable(visibilityObservable)((isVisible) => {
			if (isVisible) {
				claimWebview();
			} else {
				releaseWebview();
			}
		});

		mountWebview();

		return () => {
			controller.abort();
			if (layoutTimeout !== undefined) {
				window.clearTimeout(layoutTimeout);
				layoutTimeout = undefined;
			}
			releaseWebview();
			scrollDisposable?.dispose();
			containerBlurDisposable?.dispose();
			visibilityObserver?.dispose();
			editorChangeDisposable?.dispose();
			resizeObserver?.disconnect();
		};
	}, [webview, notebookInstance, visibilityObservable]);

	return { containerRef, isLoading, error };
}
