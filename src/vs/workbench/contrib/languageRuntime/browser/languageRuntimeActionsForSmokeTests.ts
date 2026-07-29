/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { registerCommandIfSmokeTestDriver } from '../../../common/positronSmokeTestCommands.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
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
 * via `ICommandService.executeCommand`. Its only consumer is the e2e smoke-test
 * driver, which needs session metadata without opening the info popup.
 *
 * Registration is gated on the smoke-test driver, so the command never reaches
 * a normal session; see {@link registerLanguageRuntimeActionsForSmokeTests}.
 */
export const SESSION_METADATA_COMMAND_ID = '_positron.session.getMetadata';

/**
 * Handler for {@link SESSION_METADATA_COMMAND_ID}.
 */
function getSessionMetadata(accessor: ServicesAccessor, sessionId?: string): ISessionMetadataResult | undefined {
	const runtimeSessionService = accessor.get(IRuntimeSessionService);

	// Resolve the requested session, falling back to the foreground session
	// when no id is supplied (the info popup likewise reflects the active
	// console session).
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

/**
 * Registers the language runtime commands that exist only for e2e smoke tests.
 *
 * A contribution rather than a plain registration because the gate needs
 * `IWorkbenchEnvironmentService`, which is only available through dependency
 * injection. Add further smoke-test-only commands here, one
 * `registerCommandIfSmokeTestDriver` call each.
 */
class LanguageRuntimeActionsForSmokeTestsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronLanguageRuntimeActionsForSmokeTests';

	constructor(
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
	) {
		super();

		this._register(registerCommandIfSmokeTestDriver(
			environmentService, SESSION_METADATA_COMMAND_ID, getSessionMetadata));
	}
}

/**
 * Registers the language runtime actions that are available only to e2e smoke
 * tests. Companion to `registerLanguageRuntimeActions()`; see
 * `registerCommandIfSmokeTestDriver` for why these are gated.
 */
export function registerLanguageRuntimeActionsForSmokeTests(): void {
	registerWorkbenchContribution2(
		LanguageRuntimeActionsForSmokeTestsContribution.ID,
		LanguageRuntimeActionsForSmokeTestsContribution,
		// `BlockRestore` so the commands exist before the smoke-test driver
		// resolves `whenWorkbenchRestored()` at `Restored`, which is the
		// earliest point a test can invoke them.
		WorkbenchPhase.BlockRestore,
	);
}
