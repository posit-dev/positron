/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './plotSizeEditor.css';

// React.
import React, { useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { status } from '../../../../../base/browser/ui/aria/aria.js';
import { ProgressBar } from '../../../../../base/browser/ui/positronComponents/progressBar.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { Checkbox } from '../../../../browser/positronComponents/positronModalDialog/components/checkbox.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { linkedHeight, linkedWidth, ratioOf } from './aspectRatioLock.js';
import { MAX_PLOT_SIZE, MIN_PLOT_SIZE, parsePlotDimension, PlotSizeError, resizeFromDrag, TYPED_SIZE_DELAY_MS } from './plotSizeLimits.js';

/** The state of the preview drawing, as shown under the size boxes. */
export type PlotPreviewStatus = 'idle' | 'waiting' | 'drawing' | 'failed' | 'unavailable';

/** How long a wait or draw runs before its note or progress bar shows, so a quick draw does not flash them. */
export const BUSY_SHOW_DELAY_MS = 400;

/** True once `active` has stayed true for `delayMs`; false as soon as it turns false. */
function useDelayedFlag(active: boolean, delayMs: number): boolean {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		if (!active) {
			setShown(false);
			return;
		}
		const timer = setTimeout(() => setShown(true), delayMs);
		return () => clearTimeout(timer);
	}, [active, delayMs]);
	return active && shown;
}

/** What made a size change: typing in the size boxes, or the drag handle. */
export type PlotSizeCommitSource = 'typed' | 'drag';

export interface PlotSizeEditorHandle {
	/** Commits a typed size or handle key resize still waiting on its timer. */
	commitPending: () => void;
}

export interface PlotSizeEditorProps {
	/** The starting size, which also counts as the first committed size. */
	initialSize: IPlotSize;
	/** Whether "Maintain aspect ratio" starts checked. */
	keepRatio: boolean;
	onKeepRatioChange: (keepRatio: boolean) => void;
	/** The largest size a drag can reach. */
	maxDragSize: IPlotSize;
	previewUri?: string;
	previewAlt: string;
	status: PlotPreviewStatus;
	/** Whether the last draw failed. The frame keeps showing that until a draw succeeds, even while redrawing. */
	drawFailed?: boolean;
	/** Called when the user settles on a new size: after typing stops, on Enter, or on drag release. */
	onCommit: (size: IPlotSize, source: PlotSizeCommitSource) => void;
	/** Called with whether the boxes hold a size that can be copied: valid, and not the size that just failed to draw. */
	onValidityChange: (valid: boolean) => void;
	/** Called with the preview area's size on mount and when the handle changes it, including during a drag. */
	onAreaSizeChange?: (size: IPlotSize) => void;
	ref?: React.Ref<PlotSizeEditorHandle>;
}

const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;

const NO_KEY_LIMIT: IPlotSize = { width: MAX_PLOT_SIZE, height: MAX_PLOT_SIZE };

// Matches the frame's border in plotSizeEditor.css.
const FRAME_BORDER = 1;

const sameSize = (a: IPlotSize, b: IPlotSize) => a.width === b.width && a.height === b.height;

const errorMessage = (error: PlotSizeError | undefined): string | undefined => {
	switch (error) {
		case 'empty':
			return localize('positron.plotSizeEditor.emptyError', "Enter a number.");
		case 'tooSmall':
			return localize('positron.plotSizeEditor.tooSmallError', "Enter at least {0} px.", MIN_PLOT_SIZE);
		case 'tooLarge':
			return localize('positron.plotSizeEditor.tooLargeError', "Enter at most {0} px.", MAX_PLOT_SIZE);
		default:
			return undefined;
	}
};

/** Gets the typed size, if both boxes hold a valid size. */
const typedSize = (widthText: string, heightText: string): IPlotSize | undefined => {
	const width = parsePlotDimension(widthText);
	const height = parsePlotDimension(heightText);
	if (width.error || height.error || width.value === undefined || height.value === undefined) {
		return undefined;
	}
	return { width: width.value, height: height.value };
};

/** Scales a size down to fit within a maximum, keeping its shape. */
export const fitWithin = (size: IPlotSize, max: IPlotSize): IPlotSize => {
	const scale = Math.min(1, max.width / size.width, max.height / size.height);
	return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
};

/** The smallest box a typed size is fitted into, so a small opening size still leaves room. */
const MIN_TYPED_AREA: IPlotSize = { width: 600, height: 400 };

/** The box a typed size is fitted into: the area, at least MIN_TYPED_AREA, within the window. */
const typedAreaFor = (area: IPlotSize, max: IPlotSize): IPlotSize => ({
	width: Math.min(max.width, Math.max(MIN_TYPED_AREA.width, area.width)),
	height: Math.min(max.height, Math.max(MIN_TYPED_AREA.height, area.height)),
});

/**
 * Width and height boxes, a "Maintain aspect ratio" checkbox, and a preview frame with a drag
 * handle. It only reports sizes through onCommit; the caller draws the preview.
 */
export const PlotSizeEditor = (props: PlotSizeEditorProps) => {
	const [widthText, setWidthText] = useState(() => String(props.initialSize.width));
	const [heightText, setHeightText] = useState(() => String(props.initialSize.height));
	// The aspect ratio (width / height) kept while resizing, or undefined when unlocked.
	const [lockedRatio, setLockedRatio] = useState<number | undefined>(
		() => props.keepRatio ? ratioOf(props.initialSize.width, props.initialSize.height) : undefined
	);
	const [lastCommitted, setLastCommitted] = useState<IPlotSize>(props.initialSize);
	// The real size during a drag or a handle key resize, before it commits.
	const [liveSize, setLiveSize] = useState<IPlotSize | undefined>(undefined);
	// The space the preview takes: the committed size, scaled down to fit typedAreaRef or the window.
	const [areaSize, setAreaSize] = useState<IPlotSize>(() => fitWithin(props.initialSize, props.maxDragSize));
	// Set at open and by each drag; typing never changes it, so typed sizes cannot grow the dialog.
	const typedAreaRef = useRef<IPlotSize | undefined>(undefined);
	typedAreaRef.current ??= typedAreaFor(fitWithin(props.initialSize, props.maxDragSize), props.maxDragSize);
	// Hides the handle's tip from a press until the pointer leaves, so it does not flicker during a drag.
	const [tipHidden, setTipHidden] = useState(false);

	// Refs, so timer and pointer callbacks see the latest values.
	const lastCommittedRef = useRef(props.initialSize);
	const onCommitRef = useRef(props.onCommit);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const dragRef = useRef<{ x: number; y: number; start: IPlotSize; moved: boolean; last?: IPlotSize } | undefined>(undefined);
	const pairRef = useRef<HTMLDivElement>(null);
	const handleHintId = useId();
	// An arrow-key resize of the handle that has not committed yet.
	const keyResizeRef = useRef<IPlotSize | undefined>(undefined);

	useEffect(() => {
		onCommitRef.current = props.onCommit;
	}, [props.onCommit]);

	useEffect(() => () => clearTimeout(timerRef.current), []);

	const width = parsePlotDimension(widthText);
	const height = parsePlotDimension(heightText);
	const valid = !width.error && !height.error;


	const clearTimer = () => {
		clearTimeout(timerRef.current);
		timerRef.current = undefined;
		keyResizeRef.current = undefined;
	};

	const commit = (size: IPlotSize, source: PlotSizeCommitSource) => {
		clearTimer();
		if (sameSize(size, lastCommittedRef.current)) {
			return;
		}
		lastCommittedRef.current = size;
		setLastCommitted(size);
		if (source === 'drag') {
			const area = fitWithin(size, props.maxDragSize);
			typedAreaRef.current = typedAreaFor(area, props.maxDragSize);
			setAreaSize(area);
		} else {
			setAreaSize(fitWithin(size, typedAreaRef.current!));
		}
		onCommitRef.current(size, source);
	};

	const setBoxes = (size: IPlotSize) => {
		setWidthText(String(size.width));
		setHeightText(String(size.height));
	};

	// Typing.

	const scheduleTypedCommit = (size: IPlotSize | undefined) => {
		clearTimer();
		setLiveSize(undefined);
		if (size) {
			timerRef.current = setTimeout(() => commit(size, 'typed'), TYPED_SIZE_DELAY_MS);
		}
	};

	const commitTypedNow = () => {
		const size = typedSize(widthText, heightText);
		if (size) {
			commit(size, 'typed');
		} else {
			clearTimer();
		}
	};

	const updateWidth = (text: string) => {
		let linkedText = heightText;
		const value = parsePlotDimension(text).value;
		if (lockedRatio !== undefined && value !== undefined) {
			linkedText = String(linkedHeight(value, lockedRatio));
		}
		setWidthText(text);
		setHeightText(linkedText);
		scheduleTypedCommit(typedSize(text, linkedText));
	};

	const updateHeight = (text: string) => {
		let linkedText = widthText;
		const value = parsePlotDimension(text).value;
		if (lockedRatio !== undefined && value !== undefined) {
			linkedText = String(linkedWidth(value, lockedRatio));
		}
		setHeightText(text);
		setWidthText(linkedText);
		scheduleTypedCommit(typedSize(linkedText, text));
	};

	const pairKeyDownHandler = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			// Keep a host from also acting on Enter (e.g. a dialog's default button).
			e.preventDefault();
			e.stopPropagation();
			commitTypedNow();
		}
	};

	// Moving between the width and height boxes is not leaving the pair.
	const pairBlurHandler = (e: React.FocusEvent) => {
		if (!pairRef.current?.contains(e.relatedTarget as Node | null)) {
			commitTypedNow();
		}
	};

	// The ratio a new lock would capture from the current size, if the size is valid.
	const currentSize = typedSize(widthText, heightText);
	const currentRatio = currentSize ? ratioOf(currentSize.width, currentSize.height) : undefined;

	// A size that just failed to draw would fail again on Copy; typing another size allows it.
	const failedHere = props.status === 'failed' && !!currentSize && sameSize(currentSize, lastCommitted);
	const { onValidityChange } = props;
	useEffect(() => {
		onValidityChange(valid && !failedHere);
	}, [valid, failedHere, onValidityChange]);

	const keepRatioChangedHandler = (checked: boolean) => {
		setLockedRatio(checked ? currentRatio : undefined);
		props.onKeepRatioChange(checked);
	};

	// The frame.

	// During a drag or key resize the area follows the live size; otherwise the committed size is scaled to fit it.
	const shownSize = liveSize ?? lastCommitted;
	const shownArea = liveSize ? fitWithin(liveSize, props.maxDragSize) : areaSize;
	const frameSize = fitWithin(shownSize, shownArea);
	const scaled = !liveSize && !sameSize(frameSize, lastCommitted);

	const onAreaSizeChangeRef = useRef(props.onAreaSizeChange);
	useEffect(() => {
		onAreaSizeChangeRef.current = props.onAreaSizeChange;
	}, [props.onAreaSizeChange]);
	useEffect(() => {
		onAreaSizeChangeRef.current?.({ width: shownArea.width, height: shownArea.height });
	}, [shownArea.width, shownArea.height]);

	// Dragging.

	const pointerDownHandler = (e: React.PointerEvent<HTMLButtonElement>) => {
		if (e.button !== 0) {
			return;
		}
		e.currentTarget.setPointerCapture(e.pointerId);
		setTipHidden(true);
		clearTimer();
		// A drag starts from the frame as drawn, so a scaled size clamps to maxDragSize once it moves.
		dragRef.current = { x: e.clientX, y: e.clientY, start: frameSize, moved: false };
	};

	const dragSize = (e: React.PointerEvent) => {
		const drag = dragRef.current!;
		return resizeFromDrag(drag.start, e.clientX - drag.x, e.clientY - drag.y, lockedRatio, props.maxDragSize);
	};

	const pointerMoveHandler = (e: React.PointerEvent) => {
		if (!dragRef.current) {
			return;
		}
		if (e.clientX === dragRef.current.x && e.clientY === dragRef.current.y && !dragRef.current.moved) {
			return;
		}
		dragRef.current.moved = true;
		const size = dragSize(e);
		dragRef.current.last = size;
		setLiveSize(size);
		setBoxes(size);
	};

	const pointerUpHandler = (e: React.PointerEvent) => {
		if (!dragRef.current) {
			return;
		}
		const drag = dragRef.current;
		const moved = drag.moved || e.clientX !== drag.x || e.clientY !== drag.y;
		const size = dragSize(e);
		dragRef.current = undefined;
		setLiveSize(undefined);
		// A click without movement leaves the size alone.
		if (!moved) {
			return;
		}
		setBoxes(size);
		commit(size, 'drag');
	};

	// A drag that ends without a release (a lost capture) keeps the size last shown, as a release would.
	const pointerCancelHandler = () => {
		const last = dragRef.current?.last;
		dragRef.current = undefined;
		setLiveSize(undefined);
		if (last) {
			setBoxes(last);
			commit(last, 'drag');
		}
	};

	// Commits a pending arrow-key resize at once, so a host acting next sees the new size.
	const flushKeyResize = () => {
		const size = keyResizeRef.current;
		if (size) {
			setLiveSize(undefined);
			commit(size, 'drag');
			status(localize('positron.plotSizeEditor.sizeAnnouncement', "{0} x {1}", size.width, size.height));
		}
	};

	// A host action such as Copy may not take focus, so it commits through this, not on blur.
	useImperativeHandle(props.ref, () => ({
		commitPending: () => {
			if (dragRef.current) {
				return;
			}
			if (keyResizeRef.current) {
				flushKeyResize();
			} else {
				commitTypedNow();
			}
		},
	}));

	const handleKeyDownHandler = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			flushKeyResize();
			return;
		}
		const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
		const deltas: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step],
		};
		const delta = deltas[e.key];
		if (!delta || dragRef.current) {
			return;
		}
		e.preventDefault();
		// Keys step from the real size, so they work on sizes larger than maxDragSize.
		const size = resizeFromDrag(shownSize, delta[0], delta[1], lockedRatio, NO_KEY_LIMIT);
		setLiveSize(size);
		setBoxes(size);
		clearTimer();
		keyResizeRef.current = size;
		timerRef.current = setTimeout(flushKeyResize, TYPED_SIZE_DELAY_MS);
	};

	const showWaiting = useDelayedFlag(props.status === 'waiting', BUSY_SHOW_DELAY_MS);
	const showDrawing = useDelayedFlag(props.status === 'drawing', BUSY_SHOW_DELAY_MS);
	const failedNote = localize('positron.plotSizeEditor.failed', "The plot could not be drawn at this size");
	const showFailed = props.status === 'failed' || !!props.drawFailed;
	let statusNote = '';
	if (showWaiting) {
		statusNote = localize('positron.plotSizeEditor.waiting', "Waiting for the console to finish");
	} else if (props.status === 'failed') {
		statusNote = failedNote;
	} else if (props.status === 'unavailable') {
		statusNote = localize('positron.plotSizeEditor.unavailable', "This plot is no longer available");
	}

	return (
		<div className='plot-size-editor'>
			<div className='plot-size-inputs'>
				{/* Not a control: the wrapper only sees Enter and focus leaving the two boxes in it. */}
				{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
				<div ref={pairRef} className='plot-size-pair' onBlur={pairBlurHandler} onKeyDown={pairKeyDownHandler}>
					<LabeledTextInput
						errorMsg={errorMessage(width.error)}
						label={localize('positron.plotSizeEditor.width', "Width")}
						max={MAX_PLOT_SIZE}
						min={MIN_PLOT_SIZE}
						type='number'
						value={widthText}
						onChange={e => updateWidth(e.target.value)}
					/>
					<LabeledTextInput
						errorMsg={errorMessage(height.error)}
						label={localize('positron.plotSizeEditor.height', "Height")}
						max={MAX_PLOT_SIZE}
						min={MIN_PLOT_SIZE}
						type='number'
						value={heightText}
						onChange={e => updateHeight(e.target.value)}
					/>
				</div>
				<Checkbox
					disabled={lockedRatio === undefined && currentRatio === undefined}
					initialChecked={lockedRatio !== undefined}
					label={localize('positron.plotSizeEditor.maintainAspectRatio', "Maintain aspect ratio")}
					onChanged={keepRatioChangedHandler}
				/>
			</div>
			<div className='plot-size-activity'>
				<div className='plot-size-progress'>
					{showDrawing && <ProgressBar />}
				</div>
				{/* A failure shows in the frame; the live region still announces it. */}
				<div className={'plot-size-status' + (props.status === 'failed' ? ' plot-size-status-offscreen' : '')} role='status'>{statusNote}</div>
			</div>
			<div
				className='plot-size-area'
				style={{ width: shownArea.width + 2 * FRAME_BORDER, height: shownArea.height + 2 * FRAME_BORDER }}
			>
				<div
					className='plot-size-frame'
					data-testid='plot-size-frame'
					style={{ width: frameSize.width, height: frameSize.height }}
				>
					{props.previewUri && !showFailed && <img alt={props.previewAlt} className='plot-size-preview' src={props.previewUri} />}
					{showFailed && <div aria-hidden='true' className='plot-size-failed'>{failedNote}</div>}
					<button
						aria-describedby={handleHintId}
						aria-label={localize('positron.plotSizeEditor.resizePlot', "Resize plot")}
						className='plot-size-handle'
						type='button'
						onBlur={flushKeyResize}
						onKeyDown={handleKeyDownHandler}
						onLostPointerCapture={pointerCancelHandler}
						onPointerCancel={pointerCancelHandler}
						onPointerDown={pointerDownHandler}
						onPointerLeave={() => setTipHidden(false)}
						onPointerMove={pointerMoveHandler}
						onPointerUp={pointerUpHandler}
					>
						<svg aria-hidden='true' fill='none' height='12' stroke='currentColor' strokeLinecap='round' strokeWidth='1.2' viewBox='0 0 12 12' width='12'>
							<path d='M11 3 3 11M11 7 7 11' />
						</svg>
					</button>
					{/* Shown on hover and keyboard focus; also the handle's accessible description. */}
					<span className={'plot-size-handle-tip' + (tipHidden ? ' plot-size-handle-tip-hidden' : '')}>
						<span className='plot-size-handle-tip-text' id={handleHintId}>
							{localize('positron.plotSizeEditor.resizeHint', "Drag or use the arrow keys to resize")}
						</span>
					</span>
				</div>
			</div>
			{scaled && <div className='plot-size-scaled-note'>
				{localize('positron.plotSizeEditor.scaledNote', "Preview scaled down to fit. The plot will be copied at {0} x {1}.", lastCommitted.width, lastCommitted.height)}
			</div>}
		</div>
	);
};
