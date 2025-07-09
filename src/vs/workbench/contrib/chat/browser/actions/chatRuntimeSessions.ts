/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem, QuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IChatWidget } from '../chat.js';

export interface IRuntimeSessionsQuickPickItem extends IQuickPickItem {
	kind: 'runtime-sessions';
	id: string;
	icon?: ThemeIcon;
}

export async function showRuntimeSessionsPick(accessor: ServicesAccessor, widget: IChatWidget): Promise<IRuntimeSessionsQuickPickItem | undefined> {
	// Access services.
	const quickInputService = accessor.get(IQuickInputService);
	const runtimeSessionService = accessor.get(IRuntimeSessionService);

	// Create quick pick items for active sessions sorted by creation time,
	// oldest to newest.
	const sortedActiveSessions = runtimeSessionService.activeSessions
		.sort((a, b) => a.metadata.createdTimestamp - b.metadata.createdTimestamp);

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
			return {
				id: session.sessionId,
				label: session.dynState.sessionName,
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
