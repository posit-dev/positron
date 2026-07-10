/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { CommandCenter } from '../../../../platform/commandCenter/common/commandCenter.js';

/**
 * Internal command that checks a command's precondition and executes it in a
 * single round trip, for assistant tooling. executeCommand does not enforce
 * preconditions: a "disabled" command still runs and surfaces its failure as a
 * user notification the caller never sees. This command evaluates the
 * precondition recorded in CommandCenter first and returns a structured result
 * either way, so the calling tool can tell the model what happened and why.
 *
 * Best-effort: commands without a recorded precondition (raw registrations and
 * most auto-generated commands) execute without a check.
 */
export const EXECUTE_COMMAND_CHECKED_ID = '_positron.ai.executeCommandChecked';

type ICheckedCommandResult =
	| { ok: true; result: unknown }
	| { ok: false; reason: 'unknown' | 'disabled' | 'error'; precondition?: string; message?: string };

CommandsRegistry.registerCommand(EXECUTE_COMMAND_CHECKED_ID,
	async (accessor, commandId: unknown, args?: unknown[]): Promise<ICheckedCommandResult> => {
		if (typeof commandId !== 'string' || !CommandsRegistry.getCommand(commandId)) {
			return { ok: false, reason: 'unknown' };
		}

		const precondition = CommandCenter.precondition(commandId);
		if (precondition && !accessor.get(IContextKeyService).contextMatchesRules(precondition)) {
			return { ok: false, reason: 'disabled', precondition: precondition.serialize() };
		}

		const commandService = accessor.get(ICommandService);
		try {
			const result = await commandService.executeCommand(commandId, ...(Array.isArray(args) ? args : []));
			return { ok: true, result };
		} catch (error) {
			return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
		}
	});
