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
import { DisposableStore, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { useNotebookVisibility } from '../../NotebookVisibilityContext.js';
import { Event } from '../../../../../../base/common/event.js';

// Constants
const MAX_OUTPUT_HEIGHT = 1000;
const EMPTY_OUTPUT_HEIGHT = 150;

/**
 * Custom error class for webview-specific errors
 */
export class WebviewMountError extends Error {
	constructor(message: string, public override readonly cause?: Error) {
		super(message);
		this.name = 'WebviewMountError';
	}
}

/**
 * A custom React hook that mounts and manages a notebook output webview. It:
 *  1. Claims and releases the webview on visibility changes
 *  2. Sets up layout, scroll, and blur listeners to position the webview
 *  3. Cleans up listeners and disposables on unmount
 *
 * @param webview A promise resolving to an INotebookOutputWebview
 * @returns An object with a containerRef for rendering, a loading state, and an error
 *
 * @example
 * const { containerRef, isLoading, error } = useWebviewMount(myWebview);
 *
 * @throws {WebviewMountError} When the webview fails to mount or during layout operations
 */
export function useWebviewMount(webview: Promise<INotebookOutputWebview>) {
	// State tracking: loading or error
	const [isLoading, setIsLoading] = React.useState<boolean>(true);
	const [error, setError] = React.useState<WebviewMountError | null>(null);

	// References to the container DOM element
	const containerRef = React.useRef<HTMLDivElement>(null);

	// Retrieve relevant context
	const notebookInstance = useNotebookInstance();
	const visibilityObservable = useNotebookVisibility();
	const { editorService, layoutService } = useServices();

	// Memoize the webview message handler
	const handleWebviewMessage = React.useCallback(({ message }: { message: unknown }) => {
		if (!isHTMLOutputWebviewMessage(message) || !containerRef.current) {
			return;
		}
		let boundedHeight = Math.min(message.bodyScrollHeight, MAX_OUTPUT_HEIGHT);
		// Avoid undesired default 150px "empty output" height
		if (boundedHeight === EMPTY_OUTPUT_HEIGHT) {
			boundedHeight = 0;
		}
		containerRef.current.style.height = `${boundedHeight}px`;
	}, []);

	React.useEffect(() => {
		// Abort controller for canceling ongoing tasks if needed
		const controller = new AbortController();

		// Webview references
		let webviewElement: IOverlayWebview | undefined;

		// Create a disposable store to manage all disposables
		const disposables = new DisposableStore();
		let resizeObserver: ResizeObserver | undefined;

		/**
		 * Manages layout calls for the webview using requestAnimationFrame for better performance
		 *
		 * @param immediate If true, layout occurs in the current frame
		 */
		let layoutFrame: number | undefined;
		function updateWebviewLayout(immediate = false): void {
			if (!webviewElement || !containerRef.current) {
				return;
			}

			// Clear any pending layout update
			if (layoutFrame !== undefined) {
				window.cancelAnimationFrame(layoutFrame);
				layoutFrame = undefined;
			}

			const doLayout = () => {
				try {
					if (!containerRef.current || !notebookInstance.cellsContainer) {
						return;
					}
					webviewElement?.layoutWebviewOverElement(
						containerRef.current,
						undefined,
						notebookInstance.cellsContainer
					);
				} catch (err) {
					setError(new WebviewMountError('Failed to layout webview', err instanceof Error ? err : undefined));
				}
			};

			if (immediate) {
				doLayout();
			} else {
				layoutFrame = window.requestAnimationFrame(doLayout);
				disposables.add(toDisposable(() => {
					if (layoutFrame !== undefined) {
						window.cancelAnimationFrame(layoutFrame);
						layoutFrame = undefined;
					}
				}));
			}
		}

		/**
		 * Claims the webview, instructing it to position itself over our container.
		 */
		function claimWebview(): void {
			if (!webviewElement || !containerRef.current) {
				return;
			}
			try {
				// We're using the base ref here because it's a constant reference and thus
				// will avoid unnecessary mismatches for claiming and releasing the webview
				// across multiple renders.
				webviewElement.claim(containerRef, getWindow(containerRef.current), undefined);
			} catch (err) {
				setError(new WebviewMountError('Failed to claim webview', err instanceof Error ? err : undefined));
			}
		}

		/**
		 * Releases the webview, e.g., on hidden state or unmount.
		 */
		function releaseWebview(): void {
			try {
				webviewElement?.release(containerRef);
			} catch (err) {
				setError(new WebviewMountError('Failed to release webview', err instanceof Error ? err : undefined));
			}
		}

		/**
		 * Asynchronously mounts the webview if visible.
		 * Sets up listeners for resizing, scrolling, focus changes, etc.
		 */
		async function mountWebview() {
			const emptyDisposable = toDisposable(() => { /* no-op */ });

			try {
				// If not visible, don't mount the webview
				if (!visibilityObservable) {
					return emptyDisposable;
				}

				// Wait for the INotebookOutputWebview instance
				const resolvedWebview = await webview;
				if (controller.signal.aborted || !containerRef.current) {
					return emptyDisposable;
				}

				setIsLoading(false);
				webviewElement = resolvedWebview.webview;

				// Position it initially
				claimWebview();
				updateWebviewLayout();

				// Scroll listener: reposition the webview if the notebook container scrolls
				disposables.add(notebookInstance.onDidScrollCellsContainer(() =>
					updateWebviewLayout(true)
				));

				// When focus leaves the notebook container, update layout to ensure correct size
				if (notebookInstance.cellsContainer) {
					disposables.add(addDisposableListener(
						notebookInstance.cellsContainer,
						'focusout',
						(e) => {
							if (
								notebookInstance.cellsContainer &&
								!notebookInstance.cellsContainer.contains(e.relatedTarget as Node)
							) {
								updateWebviewLayout(true);
							}
						}
					));
				}

				// Listen for messages from the webview; adjust container height if needed
				disposables.add(toDisposable(() => webviewElement!.onMessage(handleWebviewMessage).dispose()));

				// React to editor or layout changes
				const handleLayoutChange = () => updateWebviewLayout(false);
				disposables.add(Event.any(
					editorService.onDidActiveEditorChange,
					editorService.onDidVisibleEditorsChange,
					layoutService.onDidLayoutMainContainer,
					layoutService.onDidLayoutContainer,
					layoutService.onDidLayoutActiveContainer,
					layoutService.onDidChangePartVisibility,
					layoutService.onDidChangeWindowMaximized,
					layoutService.onDidChangePanelAlignment,
					layoutService.onDidChangePanelPosition,
					layoutService.onDidChangeMainEditorCenteredLayout
				)(handleLayoutChange));

				// Watch for container resize
				resizeObserver = new ResizeObserver(() => {
					updateWebviewLayout(true);
				});
				if (notebookInstance.cellsContainer) {
					resizeObserver.observe(notebookInstance.cellsContainer);
					disposables.add(toDisposable(() => resizeObserver?.disconnect()));
				}

				return emptyDisposable;
			} catch (err) {
				const mountError = new WebviewMountError(
					'Failed to mount webview',
					err instanceof Error ? err : undefined
				);
				setError(mountError);
				setIsLoading(false);
				return emptyDisposable;
			}
		}

		// Listen for changes in visibility, claiming or releasing the webview
		if (visibilityObservable) {
			disposables.add(
				Event.fromObservable(visibilityObservable)((isVisible) => {
					if (isVisible) {
						claimWebview();
					} else {
						releaseWebview();
					}
				})
			);
		}

		// Actually start the mounting process
		mountWebview();

		// Cleanup callback: abort tasks, release the webview, and dispose of all listeners
		return () => {
			controller.abort();
			releaseWebview();
			disposables.dispose();
		};
	}, [webview, notebookInstance, visibilityObservable, handleWebviewMessage]);

	// Return the container reference plus loading/error states
	return {
		containerRef,
		isLoading,
		error
	};
}
