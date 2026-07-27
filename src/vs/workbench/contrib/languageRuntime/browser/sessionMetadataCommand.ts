/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { getRuntimeDisplayPath } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * The metadata returned by {@link SESSION_METADATA_COMMAND_ID}. Mirrors the
 * fields shown in the console session info popup (see
 * `consoleInstanceInfoButton.tsx`), so programmatic callers can read the same
 * values without driving that UI.
 */
export interface ISessionMetadataResult {
	readonly name: string;
	readonly id: string;
	readonly state: string;
	readonly path: string;
	readonly source: string;
}

/**
 * Internal command id for reading a runtime session's metadata.
 *
 * The underscore prefix and use of `CommandsRegistry.registerCommand` (rather
 * than `registerAction2` with a title/category) keep this out of the command
 * palette, keybindings editor, and menus: it is reachable only programmatically
 * via `ICommandService.executeCommand`. Its primary consumer is the e2e
 * smoke-test driver, which needs session metadata without opening the info
 * popup.
 */
export const SESSION_METADATA_COMMAND_ID = '_positron.session.getMetadata';

/**
 * Registers the internal "get session metadata" command.
 */
export function registerSessionMetadataCommand(): void {
	CommandsRegistry.registerCommand(
		SESSION_METADATA_COMMAND_ID,
		(accessor: ServicesAccessor, sessionId?: string): ISessionMetadataResult | undefined => {
			const runtimeSessionService = accessor.get(IRuntimeSessionService);

			// Resolve the requested session, falling back to the foreground
			// session when no id is supplied (the info popup likewise reflects
			// the active console session).
			const session = sessionId
				? runtimeSessionService.getSession(sessionId)
				: runtimeSessionService.foregroundSession;

			if (!session) {
				return undefined;
			}

			return {
				name: session.dynState.sessionName,
				id: session.sessionId,
				state: session.getRuntimeState(),
				path: getRuntimeDisplayPath(session.runtimeMetadata),
				source: session.runtimeMetadata.runtimeSource,
			};
		}
	);
}
