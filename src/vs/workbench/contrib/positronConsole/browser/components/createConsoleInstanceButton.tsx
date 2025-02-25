/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './createConsoleInstanceButton.css'

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { localize } from '../../../../../nls.js';
import { RuntimeStartMode } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { LANGUAGE_RUNTIME_START_SESSION_ID } from '../../../languageRuntime/browser/languageRuntimeActions.js';

// Localized Text.
const NewConsoleLabelText = localize('positron.console.new.label', "New Console");
const NewConsoleEnvironmentLabelText = localize('positron.console.new.other.label', 'New Console with Other Environment...');

export const CreateConsoleInstanceButton = () => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Reference hooks.
	const contextMenuButtonRef = useRef<HTMLButtonElement>(undefined!);

	const createNewConsoleInstance = async (runtimeId: string, runtimeName: string) => {
		// Start a new session that is a duplicate of the active session
		await positronConsoleContext.runtimeSessionService.startNewRuntimeSession(
			runtimeId,
			runtimeName,
			LanguageRuntimeSessionMode.Console,
			undefined,
			`User-requested a new ${runtimeName} session from console action bar.`,
			RuntimeStartMode.Starting,
			true
		);
	}

	const createDuplicateConsoleHandler = async () => {
		const activeSession = positronConsoleContext.activePositronConsoleInstance?.session;
		if (!activeSession) {
			return;
		}
		createNewConsoleInstance(activeSession.runtimeMetadata.runtimeId, activeSession.runtimeMetadata.runtimeName);
	};

	const createNewConsoleHandler = async () => {
		const uniqueActiveRuntimes = new Map<string, ILanguageRuntimeMetadata>();
		positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance => {
			if (!uniqueActiveRuntimes.has(positronConsoleInstance.session.runtimeMetadata.runtimeId)) {
				uniqueActiveRuntimes.set(
					positronConsoleInstance.session.runtimeMetadata.runtimeId,
					positronConsoleInstance.session.runtimeMetadata
				);
			}
		});

		// Build the context menu entries.
		const entries: CustomContextMenuEntry[] = [];
		uniqueActiveRuntimes.forEach((runtimeMetadata, runtimeId) => {
			entries.push(new CustomContextMenuItem({
				label: localize('positron.console.createRuntimeConsoleLabelName', "New {0} Console", runtimeMetadata.runtimeName),
				onSelected: () => createNewConsoleInstance(runtimeId, runtimeMetadata.runtimeName)
			}));
		})
		entries.push(new CustomContextMenuItem({
			label: NewConsoleEnvironmentLabelText,
			onSelected: () => positronConsoleContext.commandService.executeCommand(LANGUAGE_RUNTIME_START_SESSION_ID)
		}));

		// Show the context menu.
		await showCustomContextMenu({
			commandService: positronConsoleContext.commandService,
			keybindingService: positronConsoleContext.keybindingService,
			layoutService: positronConsoleContext.workbenchLayoutService,
			anchorElement: contextMenuButtonRef.current,
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 'max-content',
			entries
		});
	};

	return (
		<ActionBarButton
			ref={contextMenuButtonRef}
			align='right'
			ariaLabel={NewConsoleLabelText}
			disabled={!positronConsoleContext.activePositronConsoleInstance?.session}
			dropdownAriaLabel={NewConsoleEnvironmentLabelText}
			dropdownIndicator='enabled-split'
			dropdownTooltip={NewConsoleEnvironmentLabelText}
			iconId='plus'
			tooltip={NewConsoleLabelText}
			onDropdownPressed={createNewConsoleHandler}
			onPressed={createDuplicateConsoleHandler}
		/>
	);
}
