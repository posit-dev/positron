/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem, QuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IChatWidget } from '../chat.js';

/**
 * The quick pick item for runtime sessions to be attached to chat context.
 */
export interface IRuntimeSessionsQuickPickItem extends IQuickPickItem {
	kind: 'runtime-sessions';
	id: string;
	icon?: ThemeIcon;
}

/**
 * Show a quick pick to select a runtime session for the chat widget.
 *
 * @param accessor The services accessor to get the required services.
 * @param _widget The chat widget to attach the runtime session to.
 *
 * @returns The selected runtime session quick pick item, or undefined if no session was selected.
 */
export async function showRuntimeSessionsPick(accessor: ServicesAccessor, _widget: IChatWidget):
	Promise<IRuntimeSessionsQuickPickItem | undefined> {
	// Access services.
	const quickInputService = accessor.get(IQuickInputService);
	const runtimeSessionService = accessor.get(IRuntimeSessionService);

	// Create quick pick items for active sessions sorted by creation time,
	// oldest to newest.
	const sortedActiveSessions = runtimeSessionService.activeSessions
		.sort((a, b) => a.metadata.createdTimestamp - b.metadata.createdTimestamp);

	// Filter active sessions to only include those that are in a valid state
	const activeRuntimeItems: IQuickPickItem[] = sortedActiveSessions.filter(
		(session) => {
			switch (session.getRuntimeState()) {
				case RuntimeState.Initializing:
				case RuntimeState.Starting:
				case RuntimeState.Ready:
				case RuntimeState.Idle:
				case RuntimeState.Busy:
				case RuntimeState.Restarting:
				case RuntimeState.Exiting:
				case RuntimeState.Offline:
				case RuntimeState.Interrupting:
					return true;
				default:
					return false;
			}
		}
	).map(
		(session) => {
			const isForegroundSession =
				session.sessionId === runtimeSessionService.foregroundSession?.sessionId;
			let label = session.dynState.sessionName;
			if (session.metadata.sessionMode === 'notebook') {
				// use the base name of the notebook URI for notebook sessions
				label = session.metadata.notebookUri ? basename(session.metadata.notebookUri) : label;
			}
			return {
				id: session.sessionId,
				label,
				detail: session.runtimeMetadata.runtimePath,
				iconPath: {
					dark: URI.parse(`data:image/svg+xml;base64, ${session.runtimeMetadata.base64EncodedIconSvg}`),
				},
				picked: isForegroundSession,
			};
		}
	);

	// Show quick pick to select an active runtime or show all runtimes.
	const quickPickItems: QuickPickItem[] = [
		{
			label: localize('positron.languageRuntime.activeSessions', 'Active Interpreter Sessions'),
			type: 'separator',
		},
		...activeRuntimeItems,
		{
			type: 'separator'
		}
	];

	const result = await quickInputService.pick(quickPickItems, {
		title: localize('positron.languageRuntime.selectSession', 'Select Interpreter Session'),
		canPickMany: false,
		activeItem: activeRuntimeItems.filter(item => item.picked)[0]
	});

	// Handle the user's selection.
	if (result && result.id) {
		return {
			kind: 'runtime-sessions',
			id: result.id,
			label: result.label,
		};
	}
	return undefined;
}
