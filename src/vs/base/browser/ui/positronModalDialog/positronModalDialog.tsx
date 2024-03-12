/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronModalDialog';

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { DraggableTitleBar } from 'vs/base/browser/ui/positronModalDialog/components/draggableTitleBar';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { DisposableStore } from 'vs/base/common/lifecycle';

/**
 * Focusable element selectors.
 */
const focusableElementSelectors =
	'a[href]:not([disabled]),' +
	'button:not([disabled]),' +
	'textarea:not([disabled]),' +
	'input[type="text"]:not([disabled]),' +
	'input[type="radio"]:not([disabled]),' +
	'input[type="checkbox"]:not([disabled]),' +
	'select:not([disabled])';

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
	accept?: () => void;
	cancel?: () => void;
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
	// Hooks.
	const dialogContainerRef = useRef<HTMLDivElement>(undefined!);
	const dialogBoxRef = useRef<HTMLDivElement>(undefined!);
	const [dialogBoxState, setDialogBoxState] = useState(kInitialDialogBoxState);

	// Initialization.
	useEffect(() => {
		// Center the dialog box.
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

		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onKeyDown event handler.
		disposableStore.add(props.renderer.onKeyDown(e => {
			/**
			 * Consumes an event.
			 */
			const consumeEvent = () => {
				e.preventDefault();
				e.stopPropagation();
			};

			// Handle the event.
			switch (e.key) {
				// Enter accepts dialog.
				case 'Enter': {
					consumeEvent();
					props.accept?.();
					break;
				}

				// Escape cancels dialog.
				case 'Escape': {
					consumeEvent();
					props.cancel?.();
					break;
				}

				// Tab moves between dialog elements. This code works to keep the focus in the dialog.
				case 'Tab': {
					// Get the focusable elements.
					const focusableElements = dialogBoxRef.current.querySelectorAll<HTMLElement>(
						focusableElementSelectors
					);

					// If there are focusable elements in the modal dialog, keep focus in the dialog;
					// otherwise, prevent focus from going outside of the dialog.
					if (focusableElements.length) {
						// For convenience, get the first and last focusable elements.
						const firstFocusableElement = focusableElements[0];
						const lastFocusableElement = focusableElements[focusableElements.length - 1];

						// Get the active element.
						const activeElement = DOM.getActiveElement();

						/**
						 * Determines whether the active element is one of the focusable elements.
						 * @returns true if the active element is one of the focusable element;
						 * otherwise, false.
						 */
						const activeElementIsFocusableElement = () => {
							// Enumerate the focusable elements and determine whether one of them is
							// the active element.
							if (activeElement) {
								for (let i = 0; i < focusableElements.length; i++) {
									if (focusableElements[i] === activeElement) {
										return true;
									}
								}
							}

							// The active element is not a focusable element.
							return false;
						};

						// If the user is tabbing forward, wrap around at the last element; otherwise,
						// the user is tabbing backward, so wrap around at the first element.
						if (!e.shiftKey) {
							if (!activeElement ||
								!activeElementIsFocusableElement() ||
								activeElement === lastFocusableElement) {
								consumeEvent();
								firstFocusableElement.focus();
							}
						} else {
							if (!activeElement ||
								!activeElementIsFocusableElement() ||
								activeElement === firstFocusableElement) {
								consumeEvent();
								lastFocusableElement.focus();
							}
						}
					} else {
						// Prevent focus from going outside of the dialog.
						consumeEvent();
					}
					break;
				}

				// Other keyboard events are kept within the dialog.
				default: {
					consumeEvent();
					break;
				}
			}
		}));

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
	}, []);

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
		<div className='positron-modal-dialog-overlay'>
			<div ref={dialogContainerRef} className='positron-modal-dialog-container' role='dialog'>
				<div ref={dialogBoxRef} className='positron-modal-dialog-box' style={{ left: dialogBoxState.left, top: dialogBoxState.top, width: props.width, height: props.height }}>
					<DraggableTitleBar {...props} onStartDrag={startDragHandler} onDrag={dragHandler} onStopDrag={stopDragHandler} />
					{props.children}
				</div>
			</div>
		</div>
	);
};
