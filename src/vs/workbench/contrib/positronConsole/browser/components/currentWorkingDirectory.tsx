/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './currentWorkingDirectory.css';

// React.
import React, { MouseEvent, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { toSlashes } from '../../../../../base/common/extpath.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { usePositronActionBarContext } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';

/**
 * Localized strings for UI.
 */
const positronCurrentWorkingDirectory = localize(
	'positronCurrentWorkingDirectory',
	"Current Working Directory"
);

/**
 * CurrentWorkingDirectoryProps interface.
 */
interface CurrentWorkingDirectoryProps {
	readonly directoryLabel: string;
}

/**
 * The current working directory component.
 * @param props A CurrentWorkingDirectoryProps that contains the component properties.
 * @returns The rendered component.
 */
export const CurrentWorkingDirectory = (props: CurrentWorkingDirectoryProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();
	const positronActionBarContext = usePositronActionBarContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [mouseInside, setMouseInside] = useState(false);

	// Hover useEffect.
	useEffect(() => {
		// If the mouse is inside, show the hover. This has the effect of showing the hover when
		// mouseInside is set to true and updating the hover when the tooltip changes.
		if (mouseInside) {
			positronActionBarContext.hoverManager.showHover(ref.current, props.directoryLabel);
		}
	}, [mouseInside, positronActionBarContext.hoverManager, props.directoryLabel]);

	/**
	 * onMouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = async (e: MouseEvent<HTMLElement>) => {
		// Stop propagation.
		e.stopPropagation();

		// If the left mouse button was pressed, show the context menu.
		if (e.button === 2) {
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
				anchorPoint: {
					clientX: e.clientX,
					clientY: e.clientY
				},
				popupPosition: 'auto',
				popupAlignment: 'auto',
				width: 'auto',
				entries
			});
		}
	};

	// Render.
	return (
		<div
			ref={ref}
			aria-label={positronCurrentWorkingDirectory}
			className='current-working-directory-label'
			onMouseDown={mouseDownHandler}
			onMouseEnter={() => {
				// Set the mouse inside state.
				setMouseInside(true);
			}}
			onMouseLeave={() => {
				// Clear the mouse inside state.
				setMouseInside(false);

				// Hide the hover.
				positronActionBarContext.hoverManager?.hideHover();
			}}
		>
			<span className='codicon codicon-folder' role='presentation' />
			<span className='label'>
				{isWindows ? toSlashes(props.directoryLabel) : props.directoryLabel}
			</span>
		</div>
	);
};
