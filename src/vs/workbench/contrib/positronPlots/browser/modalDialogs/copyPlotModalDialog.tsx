/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { OKCancelActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/okCancelActionBar.js';
import { DropDownListBox } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IOneTimeRender } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { intrinsicSizeInPixels } from './aspectRatioLock.js';
import { fitWithin, PlotPreviewStatus, PlotSizeEditor, PlotSizeEditorHandle } from './plotSizeEditor.js';
import { MAX_PLOT_SIZE, MIN_PLOT_SIZE, maxDragSize } from './plotSizeLimits.js';
import { BASE_DPI } from './savePlotModalDialog.js';
import { defaultSaveResolution, normalizeSaveResolutions, SaveResolutionsConfigKey } from './saveResolution.js';
import { usePlotPreview } from './usePlotPreview.js';
import { usePositronHoverManager } from '../../../../../platform/positronActionBar/browser/usePositronHoverManager.js';

export interface CopyPlotOptions {
	plotClient: PlotClientInstance;
	/** Whether "Maintain aspect ratio" starts checked. */
	keepRatio: boolean;
	onKeepRatioChange: (keepRatio: boolean) => void;
	/** The resolution the user last picked, if any. */
	resolution?: number;
	/** Called when the user picks a resolution. */
	onResolutionChange: (resolution: number) => void;
	/** Puts the drawn image (a data URI) on the clipboard. */
	onCopy: (uri: string) => Promise<void>;
	/** The element to show the dialog in; defaults to the active window's. */
	container?: HTMLElement;
}

/** The size used when the plot has no known size. */
const FALLBACK_SIZE: IPlotSize = { width: 640, height: 480 };
/** The dialog space around the preview frame: title bar, size boxes, status, action bar. */
const CHROME_WIDTH = 36;
/** An estimate for the first layout; the measured content height replaces it. */
const CHROME_HEIGHT = 255;
/** The dialog around its content: title bar, content padding, action bar. */
const DIALOG_FRAME_HEIGHT = 128;
const MIN_DIALOG_WIDTH = 480;
/** Room beyond what maxDragSize leaves, so the dialog and its gutters fit in the window. */
const EXTRA_ROOM: IPlotSize = { width: 20, height: 160 };

/** Shows the Copy Plot dialog, which copies a dynamic plot at a size the user picks. */
export const showCopyPlotModalDialog = (options: CopyPlotOptions) => {
	const renderer = new PositronModalReactRenderer({ container: options.container });
	renderer.render(<CopyPlotModalDialog options={options} renderer={renderer} />);
};

interface CopyPlotModalDialogProps {
	options: CopyPlotOptions;
	renderer: PositronModalReactRenderer;
}

/** A readable message for a failed draw; the runtime rejects with a plain object that has a message. */
const errorMessage = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	const message = (error as { message?: unknown } | undefined)?.message;
	return typeof message === 'string' ? message : String(error);
};


const sameSize = (a: IPlotSize | undefined, b: IPlotSize) => !!a && a.width === b.width && a.height === b.height;

const CopyPlotModalDialog = ({ options, renderer }: CopyPlotModalDialogProps) => {
	const { plotClient } = options;

	// The resolution multiplies the size into pixels, as in the Save Plot dialog.
	const [resolutions] = useState(() => normalizeSaveResolutions(
		renderer.services.configurationService.getValue(SaveResolutionsConfigKey)));
	const [resolution, setResolution] = useState(() => defaultSaveResolution(
		resolutions, DOM.getWindow(renderer.container).devicePixelRatio, options.resolution));
	// Cap the size where the drawn image stays within MAX_PLOT_SIZE.
	const maxSize = Math.min(MAX_PLOT_SIZE, Math.floor(MAX_PLOT_SIZE / resolution));
	const withinLimits = (value: number) => value >= MIN_PLOT_SIZE && value <= maxSize;
	const [initialSize] = useState<IPlotSize>(() => {
		const size = plotClient.lastRender?.size
			?? (plotClient.intrinsicSize ? intrinsicSizeInPixels(plotClient.intrinsicSize, BASE_DPI) : undefined);
		// A size outside the limits would open the dialog with an error, so start from the fallback.
		return size && withinLimits(size.width) && withinLimits(size.height) ? size : FALLBACK_SIZE;
	});
	const [room] = useState(() => ({
		width: renderer.container.clientWidth - EXTRA_ROOM.width,
		height: renderer.container.clientHeight - EXTRA_ROOM.height,
	}));
	const maxDrag = useMemo(() => maxDragSize(room, maxSize), [room, maxSize]);
	const [frameSize, setFrameSize] = useState(() => fitWithin(initialSize, maxDrag));
	const [valid, setValid] = useState(true);
	const [copying, setCopying] = useState(false);
	// The status of a draw started by Copy, which shows in place of the preview status.
	const [copyStatus, setCopyStatus] = useState<PlotPreviewStatus | undefined>(undefined);

	// The committed size, in a ref so Copy sees a commit made by the same click (on blur).
	const sizeRef = useRef(initialSize);
	const copyingRef = useRef(false);
	const copyRenderRef = useRef<IOneTimeRender | undefined>(undefined);
	const mountedRef = useRef(true);
	const closedRef = useRef(false);
	const editorRef = useRef<PlotSizeEditorHandle>(null);
	const hoverManager = usePositronHoverManager();
	const contentRef = useRef<HTMLDivElement>(null);
	const [contentHeight, setContentHeight] = useState<number>();

	// Size the dialog to its content, which changes with the frame, notes and errors.
	useLayoutEffect(() => {
		const content = contentRef.current;
		const targetWindow = DOM.getWindow(renderer.container);
		if (!content || !targetWindow.ResizeObserver) {
			return;
		}
		const measure = () => setContentHeight(content.offsetHeight || undefined);
		measure();
		const observer = new targetWindow.ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, [renderer]);

	const preview = usePlotPreview(plotClient, resolution);
	const status: PlotPreviewStatus = preview.status === 'unavailable' ? 'unavailable' : (copyStatus ?? preview.status);
	const copyDisabled = !valid || status === 'unavailable' || copying;

	useEffect(() => {
		const disposable = plotClient.onDidClose(() => closedRef.current = true);
		return () => disposable.dispose();
	}, [plotClient]);

	// The last render is the preview only when it is the opening size; otherwise draw one.
	const openedRef = useRef(false);
	const requestPreview = preview.request;
	useEffect(() => {
		if (!openedRef.current) {
			openedRef.current = true;
			if (!sameSize(plotClient.lastRender?.size, initialSize)) {
				requestPreview(initialSize);
			}
		}
	}, [plotClient, initialSize, requestPreview]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			copyRenderRef.current?.cancel();
		};
	}, []);

	const commitHandler = (size: IPlotSize) => {
		sizeRef.current = size;
		// A commit made by Copy itself is drawn by Copy, not as a preview too.
		if (!copyingRef.current) {
			preview.request(size);
		}
	};

	/** Draws the plot at the committed size, reusing a preview or a pending preview draw of that size. */
	const reusedPendingRef = useRef(false);
	const drawForCopy = async (size: IPlotSize): Promise<string> => {
		if (sameSize(preview.preview?.size, size) && preview.preview!.pixel_ratio === resolution) {
			return preview.preview!.uri;
		}
		if (preview.pending && sameSize(preview.pending.size, size) && preview.pending.pixelRatio === resolution) {
			// The preview hook already shows this draw's failure.
			reusedPendingRef.current = true;
			return (await preview.pending.render.promise).uri;
		}
		const render = plotClient.renderOnce(size, resolution);
		copyRenderRef.current = render;
		setCopyStatus('waiting');
		try {
			// `started` never resolves for a cancelled render, so race it with `promise`.
			await Promise.race([render.started, render.promise]);
			if (mountedRef.current) {
				setCopyStatus('drawing');
			}
			return (await render.promise).uri;
		} finally {
			copyRenderRef.current = undefined;
			if (mountedRef.current) {
				setCopyStatus(undefined);
			}
		}
	};

	const copyHandler = async () => {
		if (copyDisabled || copyingRef.current) {
			return;
		}
		copyingRef.current = true;
		setCopying(true);
		// The Copy button keeps focus in a size box, so commit what was typed there.
		editorRef.current?.commitPending();
		reusedPendingRef.current = false;
		const size = sizeRef.current;
		let drawn = false;
		try {
			const uri = await drawForCopy(size);
			drawn = true;
			await options.onCopy(uri);
			renderer.dispose();
		} catch (error) {
			// A draw cancelled because the plot closed needs no error; the dialog shows it as unavailable.
			if (mountedRef.current && !(isCancellationError(error) && closedRef.current)) {
				let message: string;
				if (isCancellationError(error)) {
					message = localize('positron.copyPlotModalDialog.drawCancelled', "The plot was not drawn because the draw was cancelled.");
				} else if (!drawn) {
					// The runtime's error is a backtrace, so it goes to the log, not the toast.
					renderer.services.logService.error(`Copy Plot: drawing at ${size.width} x ${size.height} failed: ${errorMessage(error)}`);
					message = localize('positron.copyPlotModalDialog.drawFailed', "The plot could not be drawn at {0} x {1}.", size.width, size.height);
				} else {
					message = errorMessage(error);
				}
				renderer.services.notificationService.error(localize('positron.copyPlotModalDialog.copyError', "Error copying plot: {0}", message));
				if (!drawn && !reusedPendingRef.current) {
					preview.request(sizeRef.current);
				}
			}
		} finally {
			copyingRef.current = false;
			if (mountedRef.current) {
				setCopying(false);
			}
		}
	};

	// Enter in the size boxes redraws (the editor handles it), Enter on a button activates it, and Enter anywhere else copies.
	const copyHandlerRef = useRef(copyHandler);
	copyHandlerRef.current = copyHandler;
	useEffect(() => {
		const targetWindow = DOM.getWindow(renderer.container);
		let timer: number | undefined;
		const disposable = renderer.onKeyDown(e => {
			if (e.key !== 'Enter') {
				return;
			}
			// The size boxes and other buttons handle their own Enter.
			if (DOM.isHTMLElement(e.target) && e.target.closest('.plot-size-pair, .quick-input-widget, .drop-down-list-box, button:not(.plot-size-handle)')) {
				return;
			}
			e.preventDefault();
			if (DOM.isHTMLElement(e.target) && e.target.closest('.plot-size-handle')) {
				// Let the handle commit a pending arrow-key resize first, then copy that size.
				timer = targetWindow.setTimeout(() => void copyHandlerRef.current());
				return;
			}
			e.stopPropagation();
			void copyHandlerRef.current();
		});
		return () => {
			disposable.dispose();
			targetWindow.clearTimeout(timer);
		};
	}, [renderer]);

	const areaSizeChangeHandler = useCallback((size: IPlotSize) => setFrameSize(size), []);
	const validityChangeHandler = useCallback((isValid: boolean) => setValid(isValid), []);

	const cancelHandler = () => renderer.dispose();

	return (
		<PositronModalDialog
			enterHandledByCaller
			keepPosition
			height={contentHeight !== undefined ? contentHeight + DIALOG_FRAME_HEIGHT : frameSize.height + CHROME_HEIGHT}
			renderer={renderer}
			title={localize('positron.copyPlotModalDialog.title', "Copy Plot")}
			width={Math.max(MIN_DIALOG_WIDTH, frameSize.width + CHROME_WIDTH)}
			onCancel={cancelHandler}
		>
			<ContentArea>
				<div ref={contentRef}>
					<PlotSizeEditor
						ref={editorRef}
						drawFailed={preview.failed}
						hoverManager={hoverManager}
						initialSize={initialSize}
						keepRatio={options.keepRatio}
						maxDragSize={maxDrag}
						maxSize={maxSize}
						previewAlt={localize('positron.copyPlotModalDialog.previewAlt', "Plot preview")}
						previewUri={preview.preview?.uri ?? plotClient.lastRender?.uri}
						resolution={resolution}
						status={status}
						onAreaSizeChange={areaSizeChangeHandler}
						onCommit={commitHandler}
						onKeepRatioChange={options.onKeepRatioChange}
						onValidityChange={validityChangeHandler}
					>
						<label className='plot-size-extra'>{localize('positron.copyPlotModalDialog.resolution', "Resolution")}
							<DropDownListBox
								entries={resolutions.map(r => new DropDownListBoxItem<number, number>({
									identifier: r,
									title: localize('positron.copyPlotModalDialog.resolutionMultiplier', "{0}x", r),
									value: r,
								}))}
								selectedIdentifier={resolution}
								title={localize('positron.copyPlotModalDialog.resolution', "Resolution")}
								onSelectionChanged={item => {
									setResolution(item.options.identifier);
									options.onResolutionChange(item.options.identifier);
								}}
							/>
						</label>
					</PlotSizeEditor>
				</div>
			</ContentArea>
			<OKCancelActionBar
				okButtonTitle={localize('positron.copyPlotModalDialog.copy', "Copy")}
				okDisabled={copyDisabled}
				onAccept={() => void copyHandler()}
				onCancel={cancelHandler}
			/>
		</PositronModalDialog>
	);
};
