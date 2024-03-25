/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./topActionBarCustomFolderMenu';

// React.
import * as React from 'react';
import { KeyboardEvent, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { useRegisterWithActionBar } from 'vs/platform/positronActionBar/browser/useRegisterWithActionBar';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { CustomFolderModalPopup } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderModalPopup';

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
				anchor={ref.current}
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
						<div className='label'>
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
