/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback, useEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { OKCancelActionBar } from '../../../../browser/positronComponents/positronModalDialog/components/okCancelActionBar.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IOneTimeRender } from '../../../../services/languageRuntime/common/positronPlotRenderQueue.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { intrinsicSizeInPixels } from './aspectRatioLock.js';
import { fitWithin, PlotPreviewStatus, PlotSizeCommitSource, PlotSizeEditor, PlotSizeEditorHandle } from './plotSizeEditor.js';
import { MAX_PLOT_SIZE, MIN_PLOT_SIZE, maxDragSize } from './plotSizeLimits.js';
import { BASE_DPI } from './savePlotModalDialog.js';
import { usePlotPreview } from './usePlotPreview.js';

export interface CopyPlotOptions {
	plotClient: PlotClientInstance;
	/** Whether "Maintain aspect ratio" starts checked. */
	keepRatio: boolean;
	onKeepRatioChange: (keepRatio: boolean) => void;
	/** Puts the drawn image (a data URI) on the clipboard. */
	onCopy: (uri: string) => Promise<void>;
	/** The element to show the dialog in; defaults to the active window's. */
	container?: HTMLElement;
}

/** The size used when the plot has no known size. */
const FALLBACK_SIZE: IPlotSize = { width: 640, height: 480 };
/** The dialog space around the preview frame: title bar, size boxes, status, action bar. */
const CHROME_WIDTH = 36;
const CHROME_HEIGHT = 280;
const MIN_DIALOG_WIDTH = 480;
/** Room beyond what maxDragSize leaves, so the dialog and its gutters fit in the window. */
const EXTRA_ROOM: IPlotSize = { width: 20, height: 160 };

/** The pixel ratio the copy is drawn at: the screen's, so the copy is as sharp as the Plots pane. */
export function getCopyPixelRatio(targetWindow: Window): number {
	return targetWindow.devicePixelRatio;
}

/** Shows the Copy Plot dialog, which copies a dynamic plot at a size the user picks. */
export const showCopyPlotModalDialog = (options: CopyPlotOptions) => {
	const renderer = new PositronModalReactRenderer({ container: options.container });
	renderer.render(<CopyPlotModalDialog options={options} renderer={renderer} />);
};

interface CopyPlotModalDialogProps {
	options: CopyPlotOptions;
	renderer: PositronModalReactRenderer;
}

const withinLimits = (value: number) => value >= MIN_PLOT_SIZE && value <= MAX_PLOT_SIZE;

const sameSize = (a: IPlotSize | undefined, b: IPlotSize) => !!a && a.width === b.width && a.height === b.height;

const CopyPlotModalDialog = ({ options, renderer }: CopyPlotModalDialogProps) => {
	const { plotClient } = options;

	const [initialSize] = useState<IPlotSize>(() => {
		const size = plotClient.lastRender?.size
			?? (plotClient.intrinsicSize ? intrinsicSizeInPixels(plotClient.intrinsicSize, BASE_DPI) : undefined);
		// A size outside the limits would open the dialog with an error, so start from the fallback.
		return size && withinLimits(size.width) && withinLimits(size.height) ? size : FALLBACK_SIZE;
	});
	const [pixelRatio] = useState(() => getCopyPixelRatio(DOM.getWindow(renderer.container)));
	const [maxDrag] = useState(() => maxDragSize({
		width: renderer.container.clientWidth - EXTRA_ROOM.width,
		height: renderer.container.clientHeight - EXTRA_ROOM.height,
	}));
	const [frameSize, setFrameSize] = useState(() => fitWithin(initialSize, maxDrag));
	const [centerKey, setCenterKey] = useState(0);
	const [valid, setValid] = useState(true);
	const [copying, setCopying] = useState(false);
	// The status of a draw started by Copy, which shows in place of the preview status.
	const [copyStatus, setCopyStatus] = useState<PlotPreviewStatus | undefined>(undefined);

	// The committed size, in a ref so Copy sees a commit made by the same click (on blur).
	const sizeRef = useRef(initialSize);
	const copyingRef = useRef(false);
	const copyRenderRef = useRef<IOneTimeRender | undefined>(undefined);
	const mountedRef = useRef(true);
	const editorRef = useRef<PlotSizeEditorHandle>(null);

	const preview = usePlotPreview(plotClient, pixelRatio);
	const status: PlotPreviewStatus = preview.status === 'unavailable' ? 'unavailable' : (copyStatus ?? preview.status);
	const copyDisabled = !valid || status === 'unavailable' || copying;

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			copyRenderRef.current?.cancel();
		};
	}, []);

	const commitHandler = (size: IPlotSize, source: PlotSizeCommitSource) => {
		sizeRef.current = size;
		if (source === 'typed') {
			// Re-center with the new frame size in the same render.
			setFrameSize(fitWithin(size, maxDrag));
			setCenterKey(key => key + 1);
		}
		// A commit made by Copy itself is drawn by Copy, not as a preview too.
		if (!copyingRef.current) {
			preview.request(size);
		}
	};

	/** Draws the plot at the committed size, reusing a preview or a pending preview draw of that size. */
	const drawForCopy = async (size: IPlotSize): Promise<string> => {
		if (sameSize(preview.preview?.size, size) && preview.preview!.pixel_ratio === pixelRatio) {
			return preview.preview!.uri;
		}
		if (preview.pending && sameSize(preview.pending.size, size)) {
			return (await preview.pending.render.promise).uri;
		}
		const render = plotClient.renderOnce(size, pixelRatio);
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
		try {
			const uri = await drawForCopy(sizeRef.current);
			await options.onCopy(uri);
			renderer.dispose();
		} catch (error) {
			// A cancelled draw means the plot closed; the dialog already shows it as unavailable.
			if (mountedRef.current && !isCancellationError(error)) {
				const message = error instanceof Error ? error.message : String(error);
				renderer.services.notificationService.error(localize('positron.copyPlotModalDialog.copyError', "Error copying plot: {0}", message));
				preview.request(sizeRef.current);
			}
		} finally {
			copyingRef.current = false;
			if (mountedRef.current) {
				setCopying(false);
			}
		}
	};

	// Enter in the size boxes redraws (the editor handles it); Enter anywhere else copies.
	const copyHandlerRef = useRef(copyHandler);
	copyHandlerRef.current = copyHandler;
	useEffect(() => {
		const targetWindow = DOM.getWindow(renderer.container);
		let timer: number | undefined;
		const disposable = renderer.onKeyDown(e => {
			if (e.key !== 'Enter') {
				return;
			}
			if (DOM.isHTMLElement(e.target) && e.target.closest('.plot-size-pair, .quick-input-widget')) {
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

	const frameSizeChangeHandler = useCallback((size: IPlotSize) => setFrameSize(size), []);
	const validityChangeHandler = useCallback((isValid: boolean) => setValid(isValid), []);

	const cancelHandler = () => renderer.dispose();

	return (
		<PositronModalDialog
			enterHandledByCaller
			centerKey={centerKey}
			height={frameSize.height + CHROME_HEIGHT}
			renderer={renderer}
			title={localize('positron.copyPlotModalDialog.title', "Copy Plot")}
			width={Math.max(MIN_DIALOG_WIDTH, frameSize.width + CHROME_WIDTH)}
			onCancel={cancelHandler}
		>
			<ContentArea>
				<PlotSizeEditor
					ref={editorRef}
					initialSize={initialSize}
					keepRatio={options.keepRatio}
					maxDragSize={maxDrag}
					previewAlt={localize('positron.copyPlotModalDialog.previewAlt', "Plot preview")}
					previewUri={preview.preview?.uri ?? plotClient.lastRender?.uri}
					status={status}
					onCommit={commitHandler}
					onFrameSizeChange={frameSizeChangeHandler}
					onKeepRatioChange={options.onKeepRatioChange}
					onValidityChange={validityChangeHandler}
				/>
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
