/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customFolderRecentlyUsedMenuItem.css';

// React.
import { Ref } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { KeyboardModifiers, Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * Localized strings.
 */
const positronPinFolder = localize('positron.pinFolder', "Pin");
const positronUnpinFolder = localize('positron.unpinFolder', "Unpin");

/**
 * CustomFolderRecentlyUsedMenuItemProps interface.
 */
interface CustomFolderRecentlyUsedMenuItemProps {
	enabled: boolean;
	label: string;
	pinButtonRef?: Ref<HTMLButtonElement>;
	pinned: boolean;
	onOpen: (e: KeyboardModifiers) => void;
	onOpenInNewWindow: (e: KeyboardModifiers) => void;
	onTogglePinned: () => void;
}

/**
 * CustomFolderRecentlyUsedMenuItem component.
 * @param props A CustomFolderRecentlyUsedMenuItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const CustomFolderRecentlyUsedMenuItem = (props: CustomFolderRecentlyUsedMenuItemProps) => {
	// The pin button tooltip, and its accessible name, which includes the folder so that each
	// pin button can be told apart out of context.
	const pinLabel = props.pinned ? positronUnpinFolder : positronPinFolder;
	const pinAriaLabel = props.pinned ?
		localize('positron.unpinFolderAriaLabel', "Unpin {0}", props.label) :
		localize('positron.pinFolderAriaLabel', "Pin {0}", props.label);

	// Render.
	return (
		<Button
			ariaLabel={props.label}
			className={positronClassNames('custom-folder-recently-used-menu-item', { 'pinned': props.pinned })}
			onPressed={props.onOpen}
		>
			<div className='title' title={props.label}>
				{props.label}
			</div>
			<Button ref={props.pinButtonRef} ariaLabel={pinAriaLabel} className='pin' onPressed={props.onTogglePinned}>
				<div className={`codicon codicon-${props.pinned ? 'pinned' : 'pin'}`} title={pinLabel} />
			</Button>
			<Button className='open-in-new-window' onPressed={props.onOpenInNewWindow}>
				<div className='codicon codicon-positron-open-in-new-window' title={props.label} />
			</Button>
		</Button>
	);
};
