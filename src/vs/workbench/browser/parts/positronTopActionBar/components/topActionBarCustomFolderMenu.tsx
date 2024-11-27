/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarCustomFolderMenu.css';

// React.
import React, { KeyboardEvent, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { useRegisterWithActionBar } from '../../../../../platform/positronActionBar/browser/useRegisterWithActionBar.js';
import { PositronModalReactRenderer } from '../../../positronModalReactRenderer/positronModalReactRenderer.js';
import { usePositronTopActionBarContext } from '../positronTopActionBarContext.js';
import { CustomFolderModalPopup } from '../customFolderModalPopup/customFolderModalPopup.js';

/**
 * Localized strings.
 */
const positronFolderMenu = localize('positron.folderCommands', "Folder Commands");

/**
 * TopActionBarCustonFolderMenu component.
 * @returns The rendered component.
 */
export const TopActionBarCustonFolderMenu = () => {
	// Context hooks.
	const context = usePositronTopActionBarContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	// Participate in roving tabindex.
	useRegisterWithActionBar([ref]);

	/**
	 * Shows the custom folder modal popup.
	 */
	const showPopup = async () => {
		// Gets the recently opened workspaces.
		const recentlyOpened = await context.workspacesService.getRecentlyOpened();

		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: context.keybindingService,
			layoutService: context.layoutService,
			container: context.layoutService.getContainer(DOM.getWindow(ref.current)),
			parent: ref.current
		});

		// Show the custom folder modal popup.
		renderer.render(
			<CustomFolderModalPopup
				{...context}
				renderer={renderer}
				recentlyOpened={recentlyOpened}
				anchorElement={ref.current}
			/>
		);
	};

	/**
	 * onKeyDown event handler.
	 */
	const keyDownHandler = async (e: KeyboardEvent<HTMLDivElement>) => {
		switch (e.code) {
			case 'Space':
			case 'Enter':
				await showPopup();
				break;
		}
	};

	/**
	 * onClick event handler.
	 */
	const clickHandler = async () => {
		await showPopup();
	};

	// Render.
	return (
		<div
			ref={ref}
			className='top-action-bar-custom-folder-menu'
			role='button'
			tabIndex={0}
			onKeyDown={keyDownHandler}
			onClick={clickHandler}
			aria-label={positronFolderMenu}
			aria-haspopup='menu'>
			<div className='left' aria-hidden='true'>
				<div className='label'>
					<div className={'action-bar-button-icon codicon codicon-folder'} />
					{context.workspaceFolder &&
						<div className='label-text'>
							{context.workspaceFolder ? context.workspaceFolder.name : ''}
						</div>
					}
				</div>
			</div>
			<div className='right' aria-hidden='true'>
				<div className='chevron codicon codicon-chevron-down' />
			</div>
		</div>
	);
};
