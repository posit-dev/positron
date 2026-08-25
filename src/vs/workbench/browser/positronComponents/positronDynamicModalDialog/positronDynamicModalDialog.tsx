/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDynamicModalDialog.css';

// React.
import { FormEvent, ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import { TitleBar } from './components/titleBar.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PositronModalDialogReactRenderer } from '../../../../base/browser/positronModalDialogReactRenderer.js';

/**
 * The gutter where the dialog box cannot be moved.
 */
const kGutter = 40;

/**
 * The number of dynamic modal dialogs currently mounted. A dialog that opens while another is
 * already open dims nothing of its own, so the two backdrops do not compound into twice the
 * darkness.
 */
let openDialogCount = 0;

/**
 * PositronDynamicModalDialogProps interface.
 */
export interface PositronDynamicModalDialogProps {
	renderer: PositronModalDialogReactRenderer;
	title: string;
	titleDescription?: string;
	width: number;
	content: ReactNode;
	contentMinHeight?: number;
	contentMaxHeight?: number;
	footer?: ReactNode;
	onCancel?: () => void;

	// Optional form submit handler. The content and footer are always wrapped in a <form>; when this
	// is provided, pressing Enter in any input fires this callback (the dialog calls preventDefault on
	// the underlying submit event automatically). Enter-to-submit only fires if the footer includes a
	// button with type='submit' to serve as the form's implicit submit target -- callers opt in
	// per button (Button defaults to type='button', so other buttons never become the submit target).
	// Wire onSubmit to the SAME action as that submit button's onPressed, otherwise Enter and a mouse
	// click on the primary button will do different things.
	onSubmit?: () => void;
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
 * PositronDynamicModalDialog component. A modal dialog that uses flex column layout with three zones:
 * a fixed-height title bar, a variable-height content area (children) that grows/shrinks between
 * min and max height constraints, and a fixed-height action bar.
 * @param props A PositronDynamicModalDialogProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDynamicModalDialog = (props: PositronDynamicModalDialogProps) => {
	// Reference hooks.
	const dialogContainerRef = useRef<HTMLDivElement>(undefined!);
	const dialogBoxRef = useRef<HTMLDivElement>(undefined!);
	const hasBeenPositioned = useRef(false);

	// Id hooks. The title element carries this id and aria-labelledby points at it, which is what
	// gives the dialog its accessible name.
	const titleId = useId();

	// State hooks.
	const [dialogBoxState, setDialogBoxState] = useState(kInitialDialogBoxState);

	// Whether this dialog opened while another was already open. Decided once, when this dialog
	// mounts, and never revised: a dialog does not start or stop dimming because something above it
	// came and went.
	//
	// The count is read in a layout effect rather than during render. A flow that swaps one dialog
	// component for another, as the new data connection flow does per step, mounts the incoming
	// dialog and unmounts the outgoing one in the same commit. Render runs before the outgoing
	// dialog's cleanup, so reading the count there would see it still open and latch this dialog as
	// nested for its whole life, leaving the workbench undimmed from the second step on. Layout
	// effects run after that cleanup, and before paint, so there is no flash.
	const [isNested, setIsNested] = useState(false);
	useLayoutEffect(() => {
		setIsNested(openDialogCount > 0);
		openDialogCount++;
		return () => { openDialogCount--; };
	}, []);

	// Center the dialog box on initial mount. On subsequent renders (e.g. content changes), keep
	// the current position but clamp to ensure the dialog remains on screen. useLayoutEffect
	// ensures the position is applied before the browser paints, avoiding a visible flash at 0,0.
	useLayoutEffect(() => {
		setDialogBoxState(prevDialogBoxState => {
			const effectiveHeight = dialogBoxRef.current.offsetHeight;

			// On initial mount, center the dialog box.
			if (!hasBeenPositioned.current) {
				hasBeenPositioned.current = true;
				return {
					...prevDialogBoxState,
					left: Math.max(dialogContainerRef.current.clientWidth / 2 - props.width / 2, kGutter),
					top: Math.max(dialogContainerRef.current.clientHeight / 2 - effectiveHeight / 2, kGutter),
				};
			}

			// On subsequent renders, keep the current position but clamp to stay on screen.
			return {
				...prevDialogBoxState,
				left: Math.min(
					Math.max(prevDialogBoxState.left, kGutter),
					dialogContainerRef.current.clientWidth - props.width - kGutter
				),
				top: Math.min(
					Math.max(prevDialogBoxState.top, kGutter),
					dialogContainerRef.current.clientHeight - effectiveHeight - kGutter
				),
			};
		});
	}, [props.width]);

	// Move focus into the dialog on mount. An ordinary element does not do this on its own, so a
	// keyboard user would otherwise still be focused on whatever was behind the dialog. The renderer
	// restores focus to that element when the dialog closes.
	useEffect(() => {
		// eslint-disable-next-line no-restricted-syntax
		const firstFocusable = dialogBoxRef.current.querySelector<HTMLElement>(
			'a[href]:not([disabled]),button:not([disabled]),textarea:not([disabled]),' +
			'input:not([disabled]),select:not([disabled])'
		);
		(firstFocusable ?? dialogBoxRef.current).focus();
	}, []);

	// Set up keyboard and resize event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onResize event handler.
		disposableStore.add(props.renderer.onResize(e => {
			// Update the dialog box state.
			setDialogBoxState(prevDialogBoxState => {
				const effectiveHeight = dialogBoxRef.current.offsetHeight;

				// Update the dialog box state, making sure that it remains on screen.
				const result: DialogBoxState = {
					...prevDialogBoxState,
					left: prevDialogBoxState.left + props.width <= dialogContainerRef.current.clientWidth ?
						prevDialogBoxState.left :
						Math.max(dialogContainerRef.current.clientWidth - props.width - kGutter, kGutter),
					top: prevDialogBoxState.top + effectiveHeight <= dialogContainerRef.current.clientHeight ?
						prevDialogBoxState.top :
						Math.max(dialogContainerRef.current.clientHeight - effectiveHeight - kGutter, kGutter)
				};

				// Return the updated dialog box state.
				return result;
			});
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [props.renderer, props.onCancel, props.width, props]);

	// Start drag handler.
	const startDragHandler = () => {
		// Update the dialog box state.
		setDialogBoxState(prevDialogBoxState => {
			const effectiveHeight = dialogBoxRef.current.offsetHeight;

			// If the dialog box cannot be moved because it is pinned at the left or pinned at the top,
			// do not enter dragging mode.
			if (prevDialogBoxState.left + props.width >= dialogContainerRef.current.clientWidth ||
				prevDialogBoxState.top + effectiveHeight >= dialogContainerRef.current.clientHeight) {
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

		const effectiveHeight = dialogBoxRef.current.offsetHeight;

		// Update the dialog box state.
		const result: DialogBoxState = {
			...prevDialogBoxState,
			dragging,
			left: Math.min(Math.max(prevDialogBoxState.dragOffsetLeft + x, kGutter), dialogContainerRef.current.clientWidth - props.width - kGutter),
			top: Math.min(Math.max(prevDialogBoxState.dragOffsetTop + y, kGutter), dialogContainerRef.current.clientHeight - effectiveHeight - kGutter)
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

	// Submit handler. Calls preventDefault and forwards to the consumer-provided onSubmit so
	// callers don't need to remember to suppress the default form action.
	const submitHandler = (event: FormEvent) => {
		event.preventDefault();
		props.onSubmit?.();
	};

	// Render.
	return (
		<div ref={dialogContainerRef} className={positronClassNames('positron-dynamic-modal-dialog-box-container', { 'nested': isNested })}>
			<div
				ref={dialogBoxRef}
				aria-labelledby={titleId}
				aria-modal='true'
				className='positron-dynamic-modal-dialog-box'
				role='dialog'
				style={{
					left: dialogBoxState.left,
					top: dialogBoxState.top,
					width: props.width,
				}}
				tabIndex={-1}
			>
				<TitleBar title={props.title} titleDescription={props.titleDescription} titleId={titleId} onClose={props.onCancel} onDrag={dragHandler} onStartDrag={startDragHandler} onStopDrag={stopDragHandler} />
				{/*
					The content area and footer are always wrapped in a <form>. Enter-key implicit
					submission only activates when a submit target exists -- i.e. when the footer
					includes a button with type='submit'. Button defaults to type='button', so other
					buttons never serve as the submit target, letting callers compose any footer or
					content while choosing exactly which button "is" the submit button.
				*/}
				<form className='positron-dynamic-modal-dialog-form' onSubmit={submitHandler}>
					<div className='content-area' style={{
						minHeight: props.contentMinHeight,
						maxHeight: props.contentMaxHeight,
					}}>
						{props.content}
					</div>
					{props.footer}
				</form>
			</div>
		</div>
	);
};
