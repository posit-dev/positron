/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './currentWorkingDirectory.css';

// React.
import { KeyboardEvent, MouseEvent, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { toSlashes } from '../../../../../base/common/extpath.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { useActionBarHover } from '../../../../../platform/positronActionBar/browser/useActionBarHover.js';
import { useRegisterWithActionBar } from '../../../../../platform/positronActionBar/browser/useRegisterWithActionBar.js';
import { usePositronActionBarContext } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { AnchorPoint } from '../../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';

/**
 * CurrentWorkingDirectoryProps interface.
 */
interface CurrentWorkingDirectoryProps {
	readonly directoryLabel: string;
}

/**
 * How long after Shift+F10 or the Menu key a contextmenu event is treated as coming from that key.
 */
const KEYBOARD_CONTEXT_MENU_WINDOW_MS = 500;

/**
 * Determines whether a key opens the context menu (Shift+F10 or the Menu key).
 * @param e The keyboard event.
 * @returns true if the key opens the context menu; otherwise, false.
 */
const isContextMenuKey = (e: KeyboardEvent<HTMLElement>) =>
	e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);

/**
 * The current working directory component.
 * @param props A CurrentWorkingDirectoryProps that contains the component properties.
 * @returns The rendered component.
 */
export const CurrentWorkingDirectory = (props: CurrentWorkingDirectoryProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();
	const positronActionBarContext = usePositronActionBarContext();

	// Hover hooks. The hover shows the full path, which the label may truncate.
	const hover = useActionBarHover(props.directoryLabel);
	const ref = hover.ref;

	// Reference hooks.
	const keyboardContextMenuTimeRef = useRef(0);

	// Participate in the action bar's arrow key navigation.
	useRegisterWithActionBar([ref]);

	// The directory label as displayed.
	const directoryLabel = isWindows ? toSlashes(props.directoryLabel) : props.directoryLabel;

	/**
	 * Shows the context menu.
	 * @param anchorPoint The point to anchor the menu to, or undefined to anchor it to the label.
	 */
	const showContextMenu = async (anchorPoint?: AnchorPoint) => {
		// Hide the hover so it doesn't cover the menu.
		positronActionBarContext.hoverManager?.hideHover();

		// Build the context menu entries.
		const entries: CustomContextMenuEntry[] = [
			new CustomContextMenuItem({
				icon: 'copy',
				label: localize('positron.dataExplorer.copy', "Copy"),
				onSelected: async () => await services.clipboardService.writeText(
					props.directoryLabel
				)
			})
		];

		// Show the context menu.
		await showCustomContextMenu({
			anchorElement: ref.current,
			anchorPoint,
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 'auto',
			entries
		});
	};

	/**
	 * onContextMenu handler for right-click.
	 * @param e A MouseEvent<HTMLElement> that describes the contextmenu event.
	 */
	const contextMenuHandler = async (e: MouseEvent<HTMLElement>) => {
		e.preventDefault();
		e.stopPropagation();

		// On Windows and Linux the browser also fires contextmenu for Shift+F10 and the Menu key,
		// after the keydown handler has already opened the menu.
		if (Date.now() - keyboardContextMenuTimeRef.current < KEYBOARD_CONTEXT_MENU_WINDOW_MS) {
			return;
		}

		await showContextMenu({ clientX: e.clientX, clientY: e.clientY });
	};

	/**
	 * onKeyDown handler. Enter and Space open the menu, as they do for any menu button. Shift+F10
	 * and the Menu key open it too, because macOS does not fire contextmenu for them.
	 * @param e A KeyboardEvent<HTMLElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = async (e: KeyboardEvent<HTMLElement>) => {
		const contextMenuKey = isContextMenuKey(e);
		if (contextMenuKey || e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			if (contextMenuKey) {
				keyboardContextMenuTimeRef.current = Date.now();
			}
			await showContextMenu();
		}
	};

	// Render.
	return (
		<div
			ref={ref}
			aria-haspopup='menu'
			aria-label={localize(
				'positron.console.currentWorkingDirectory.ariaLabel',
				"Current Working Directory: {0}",
				directoryLabel
			)}
			className='current-working-directory-label'
			role='button'
			onBlur={hover.onBlur}
			onContextMenu={contextMenuHandler}
			onFocus={hover.onFocus}
			onKeyDown={keyDownHandler}
			onMouseEnter={hover.onMouseEnter}
			onMouseLeave={hover.onMouseLeave}
		>
			<span className='codicon codicon-folder' role='presentation' />
			<span className='label'>
				{directoryLabel}
			</span>
		</div>
	);
};
