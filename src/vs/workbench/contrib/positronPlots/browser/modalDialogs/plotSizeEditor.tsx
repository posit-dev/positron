/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './plotSizeEditor.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ProgressBar } from '../../../../../base/browser/ui/positronComponents/progressBar.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { Checkbox } from '../../../../browser/positronComponents/positronModalDialog/components/checkbox.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { linkedHeight, linkedWidth, ratioOf } from './aspectRatioLock.js';
import { MAX_PLOT_SIZE, MIN_PLOT_SIZE, parsePlotDimension, PlotSizeError, resizeFromDrag, TYPED_SIZE_DELAY_MS } from './plotSizeLimits.js';

/** The state of the preview drawing, as shown under the size boxes. */
export type PlotPreviewStatus = 'idle' | 'waiting' | 'drawing' | 'unavailable';

/** What made a size change: typing in the size boxes, or the drag handle. */
export type PlotSizeCommitSource = 'typed' | 'drag';

export interface PlotSizeEditorProps {
	/** The starting size, which also counts as the first committed size. */
	initialSize: IPlotSize;
	/** Whether "Maintain aspect ratio" starts checked. */
	keepRatio: boolean;
	onKeepRatioChange: (keepRatio: boolean) => void;
	/** The largest size a drag can reach; larger committed sizes are shown scaled down. */
	maxDragSize: IPlotSize;
	previewUri?: string;
	previewAlt: string;
	status: PlotPreviewStatus;
	/** Called when the user settles on a new size: after typing stops, on Enter, or on drag release. */
	onCommit: (size: IPlotSize, source: PlotSizeCommitSource) => void;
	onValidityChange: (valid: boolean) => void;
	/** Called with the size the frame is drawn at, on mount and whenever it changes, including during a drag. */
	onFrameSizeChange?: (size: IPlotSize) => void;
}

const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;

const NO_KEY_LIMIT: IPlotSize = { width: MAX_PLOT_SIZE, height: MAX_PLOT_SIZE };

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

	// Refs, so timer and pointer callbacks see the latest values.
	const lastCommittedRef = useRef(props.initialSize);
	const onCommitRef = useRef(props.onCommit);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const dragRef = useRef<{ x: number; y: number; start: IPlotSize; moved: boolean } | undefined>(undefined);
	const pairRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		onCommitRef.current = props.onCommit;
	}, [props.onCommit]);

	useEffect(() => () => clearTimeout(timerRef.current), []);

	const width = parsePlotDimension(widthText);
	const height = parsePlotDimension(heightText);
	const valid = !width.error && !height.error;

	const { onValidityChange } = props;
	useEffect(() => {
		onValidityChange(valid);
	}, [valid, onValidityChange]);

	const clearTimer = () => {
		clearTimeout(timerRef.current);
		timerRef.current = undefined;
	};

	const commit = (size: IPlotSize, source: PlotSizeCommitSource) => {
		clearTimer();
		if (sameSize(size, lastCommittedRef.current)) {
			return;
		}
		lastCommittedRef.current = size;
		setLastCommitted(size);
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

	const keepRatioChangedHandler = (checked: boolean) => {
		setLockedRatio(checked ? currentRatio : undefined);
		props.onKeepRatioChange(checked);
	};

	// The frame.

	// The frame shows the real size, scaled down to fit maxDragSize.
	const shownSize = liveSize ?? lastCommitted;
	const frameSize = fitWithin(shownSize, props.maxDragSize);
	const scaled = !liveSize && !sameSize(frameSize, lastCommitted);

	const onFrameSizeChangeRef = useRef(props.onFrameSizeChange);
	useEffect(() => {
		onFrameSizeChangeRef.current = props.onFrameSizeChange;
	}, [props.onFrameSizeChange]);
	useEffect(() => {
		onFrameSizeChangeRef.current?.({ width: frameSize.width, height: frameSize.height });
	}, [frameSize.width, frameSize.height]);

	// Dragging.

	const pointerDownHandler = (e: React.PointerEvent<HTMLButtonElement>) => {
		if (e.button !== 0) {
			return;
		}
		e.currentTarget.setPointerCapture(e.pointerId);
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

	const pointerCancelHandler = () => {
		if (!dragRef.current) {
			return;
		}
		dragRef.current = undefined;
		setLiveSize(undefined);
		setBoxes(lastCommittedRef.current);
	};

	const handleKeyDownHandler = (e: React.KeyboardEvent) => {
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
		timerRef.current = setTimeout(() => {
			setLiveSize(undefined);
			commit(size, 'drag');
		}, TYPED_SIZE_DELAY_MS);
	};

	let statusNote = '';
	if (props.status === 'waiting') {
		statusNote = localize('positron.plotSizeEditor.waiting', "Waiting for the console to finish");
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
					{props.status === 'drawing' && <ProgressBar />}
				</div>
				<div className='plot-size-status' role='status'>{statusNote}</div>
			</div>
			<div
				className='plot-size-frame'
				data-testid='plot-size-frame'
				style={{ width: frameSize.width, height: frameSize.height }}
			>
				{props.previewUri && <img alt={props.previewAlt} className='plot-size-preview' src={props.previewUri} />}
				<button
					aria-label={localize('positron.plotSizeEditor.resizePlot', "Resize plot")}
					className='plot-size-handle'
					type='button'
					onKeyDown={handleKeyDownHandler}
					onLostPointerCapture={pointerCancelHandler}
					onPointerCancel={pointerCancelHandler}
					onPointerDown={pointerDownHandler}
					onPointerMove={pointerMoveHandler}
					onPointerUp={pointerUpHandler}
				>
					<span aria-hidden='true' className='codicon codicon-gripper' />
				</button>
			</div>
			{scaled && <div className='plot-size-scaled-note'>
				{localize('positron.plotSizeEditor.scaledNote', "Preview scaled to fit. The copy is {0} x {1} px.", lastCommitted.width, lastCommitted.height)}
			</div>}
		</div>
	);
};
