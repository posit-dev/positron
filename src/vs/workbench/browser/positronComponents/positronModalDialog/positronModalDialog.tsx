/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronModalDialog.css';

// React.
import { PropsWithChildren, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { DraggableTitleBar } from './components/draggableTitleBar.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { useModalDialogKeyboard } from './useModalDialogKeyboard.js';

/**
 * The gutter where the dialog box cannot be moved.
 */
const kGutter = 40;

/**
 * PositronModalDialogProps interface.
 */
export interface PositronModalDialogProps {
	renderer: PositronModalReactRenderer;
	title: string;
	width: number;
	height: number;
	closeOnClickOutside?: boolean;
	onCancel?: () => void;
}

/**
 * DialogBoxState interface.
 */
interface DialogBoxState {
	dragging: boolean;
	dragOffsetLeft: number;
	dragOffsetTop: number;
	left: number;
	top: number;
}

/**
 * The initial dialog box state.
 */
const kInitialDialogBoxState: DialogBoxState = {
	dragging: false,
	dragOffsetLeft: 0,
	dragOffsetTop: 0,
	left: 0,
	top: 0
};

/**
 * PositronModalDialog component.
 * @param props A PositronModalDialogProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronModalDialog = (props: PropsWithChildren<PositronModalDialogProps>) => {
	// Reference hooks.
	const dialogContainerRef = useRef<HTMLDivElement>(undefined!);
	const dialogBoxRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [dialogBoxState, setDialogBoxState] = useState(kInitialDialogBoxState);

	// Center the dialog box on mount or when dimensions change. useLayoutEffect ensures the
	// centered position is applied before the browser paints, avoiding a visible flash at 0,0.
	useLayoutEffect(() => {
		setDialogBoxState(prevDialogBoxState => {
			// Update the dialog box state, centering the dialog box.
			const result: DialogBoxState = {
				...prevDialogBoxState,
				left: Math.max(dialogContainerRef.current.clientWidth / 2 - props.width / 2, kGutter),
				top: Math.max(dialogContainerRef.current.clientHeight / 2 - props.height / 2, kGutter),
			};

			// Return the updated dialog box state.
			return result;
		});
	}, [props.width, props.height]);

	// Escape, Enter and the Tab focus trap.
	useModalDialogKeyboard({
		dialogBoxRef,
		keyboardSource: props.renderer,
		onCancel: props.onCancel
	});

	// Set up the resize event handler.
	useEffect(() => {
		// Create a disposable store for the event handler we'll add.
		const disposableStore = new DisposableStore();

		// Add the onResize event handler.
		disposableStore.add(props.renderer.onResize(e => {
			// Update the dialog box state.
			setDialogBoxState(prevDialogBoxState => {
				// Update the dialog box state, making sure that it remains on screen.
				const result: DialogBoxState = {
					...prevDialogBoxState,
					left: prevDialogBoxState.left + props.width <= dialogContainerRef.current.clientWidth ?
						prevDialogBoxState.left :
						Math.max(dialogContainerRef.current.clientWidth - props.width - kGutter, kGutter),
					top: prevDialogBoxState.top + props.height <= dialogContainerRef.current.clientHeight ?
						prevDialogBoxState.top :
						Math.max(dialogContainerRef.current.clientHeight - props.height - kGutter, kGutter)
				};

				// Return the updated dialog box state.
				return result;
			});
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [props.renderer, props.onCancel, props.width, props.height, props]);

	// Start drag handler.
	const startDragHandler = () => {
		// Update the dialog box state.
		setDialogBoxState(prevDialogBoxState => {
			// If the dialog box cannot be moved because it is pinned at the left or pinned at the top,
			// do not enter dragging mode.
			if (prevDialogBoxState.left + props.width >= dialogContainerRef.current.clientWidth ||
				prevDialogBoxState.top + props.height >= dialogContainerRef.current.clientHeight) {
				return prevDialogBoxState;
			}

			// Update the dialog box state, entering dragging mode and recording the drag offsets.
			const result: DialogBoxState = {
				...prevDialogBoxState,
				dragging: true,
				dragOffsetLeft: dialogBoxRef.current.offsetLeft,
				dragOffsetTop: dialogBoxRef.current.offsetTop
			};

			// Return the updated dialog box state.
			return result;
		});
	};

	/**
	 * Updates the dialog box state.
	 * @param prevDialogBoxState The previous dialog box state.
	 * @param x The horizontal drag distance.
	 * @param y The vertical drag distance.
	 * @param dragging A value which indicates whether to continue dragging.
	 * @returns The updated dialog box state.
	 */
	const updateDialogBoxState = (prevDialogBoxState: DialogBoxState, x: number, y: number, dragging: boolean): DialogBoxState => {
		// If we are not in dragging mode, do nothing.
		if (!prevDialogBoxState.dragging) {
			return prevDialogBoxState;
		}

		// Update the dialog box state.
		const result: DialogBoxState = {
			...prevDialogBoxState,
			dragging,
			left: Math.min(Math.max(prevDialogBoxState.dragOffsetLeft + x, kGutter), dialogContainerRef.current.clientWidth - props.width - kGutter),
			top: Math.min(Math.max(prevDialogBoxState.dragOffsetTop + y, kGutter), dialogContainerRef.current.clientHeight - props.height - kGutter)
		};

		// Return the updated dialog box state.
		return result;
	};

	/**
	 * The drag handler.
	 * @param x The horizontal drag distance.
	 * @param y The vertical drag distance.
	 */
	const dragHandler = (x: number, y: number) => {
		setDialogBoxState(prevDialogBoxState => updateDialogBoxState(prevDialogBoxState, x, y, true));
	};

	/**
	 * The stop drag handler.
	 * @param x The horizontal drag distance.
	 * @param y The vertical drag distance.
	 */
	const stopDragHandler = (x: number, y: number) => {
		setDialogBoxState(prevDialogBoxState => updateDialogBoxState(prevDialogBoxState, x, y, false));
	};

	// Render.
	return (
		<div
			ref={dialogContainerRef}
			className='positron-modal-dialog-container'
			role='dialog'
			onClick={(e) => {
				// Close if clicking directly on the backdrop (not the dialog content)
				if (props.closeOnClickOutside && e.target === dialogContainerRef.current) {
					props.onCancel?.();
				}
			}}
		>
			<div ref={dialogBoxRef} className='positron-modal-dialog-box' style={{ left: dialogBoxState.left, top: dialogBoxState.top, width: props.width, height: props.height }}>
				<DraggableTitleBar {...props} onDrag={dragHandler} onStartDrag={startDragHandler} onStopDrag={stopDragHandler} />
				{props.children}
			</div>
		</div>
	);
};
