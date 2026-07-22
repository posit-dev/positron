/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IJSONSchema } from '../../../../base/common/jsonSchema.js';
import { ICommandActionSource, ILocalizedString } from '../../../../platform/action/common/action.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';

export const IAgentAllowedCommandsService = createDecorator<IAgentAllowedCommandsService>('agentAllowedCommandsService');

/**
 * A positional argument for an agent-compatible command.
 */
export interface IAgentCommandArg {
	readonly name: string;
	readonly description?: string;
	readonly schema?: IJSONSchema;
	readonly required?: boolean;
}

/**
 * Where the command was registered from. `'builtin'` covers core Positron and
 * VS Code commands; `'extension'` covers commands contributed by an
 * extension.
 */
export interface IAgentCommandSource {
	readonly type: 'builtin' | 'extension';
	readonly id?: string;
	readonly displayName?: string;
}

/**
 * Descriptor for a curated Positron command available to AI agents.
 */
export interface IAgentCommandDescriptor {
	readonly id: string;
	readonly description?: string;
	readonly args?: readonly IAgentCommandArg[];
	readonly returns?: string;
	readonly source: IAgentCommandSource;
}

/**
 * A debug view of an agent-compatible command that includes runtime state
 * (whether it is currently enabled and whether it is palette-exposed). Used
 * by the developer action; not exposed to extensions.
 */
export interface IAgentCommandDebugDescriptor extends IAgentCommandDescriptor {
	/** Whether the command's precondition currently evaluates to true. `true` when there is no precondition. */
	readonly enabled: boolean;
	/** Serialized precondition expression, if any. */
	readonly precondition?: string;
	/** Whether the command is registered in the command palette (`f1: true`). */
	readonly inPalette: boolean;
}

/**
 * The result of {@link IAgentAllowedCommandsService.validateAndExecute}.
 */
export type IValidateAndExecuteResult =
	| { readonly ok: true; readonly result: unknown }
	| {
		readonly ok: false;
		readonly reason: 'not-found' | 'disabled' | 'error' | 'unknown';
		readonly precondition?: string;
		readonly message?: string;
	};

/**
 * Assembles and executes the curated set of Positron commands exposed to AI
 * agents. See `positron.ai.getAgentAllowedCommands()` and
 * `positron.ai.validateAndExecuteCommand()` on the Positron extension API.
 */
export interface IAgentAllowedCommandsService {
	readonly _serviceBrand: undefined;

	/**
	 * Return the curated agent-compatible commands that are actually
	 * registered in the current build and currently enabled (precondition holds).
	 */
	getAgentAllowedCommands(): IAgentCommandDescriptor[];

	/**
	 * Return every agent-compatible command registered in the current build,
	 * without filtering, augmented with runtime state (`enabled`,
	 * `precondition`, `inPalette`). Intended for developer diagnostics.
	 */
	getAllAgentCompatibleCommands(): IAgentCommandDebugDescriptor[];

	/**
	 * Check that a command exists and that its precondition (if any) currently
	 * holds, then execute it. Returns a structured result rather than throwing
	 * so callers can distinguish "unknown", "disabled", and "error" outcomes.
	 */
	validateAndExecute(commandId: string, args?: unknown[]): Promise<IValidateAndExecuteResult>;
}

function toDescription(value: ILocalizedString | string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return typeof value === 'string' ? value : value.value;
}

export class AgentAllowedCommandsService implements IAgentAllowedCommandsService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@IProductService private readonly _productService: IProductService,
		@IExtensionService private readonly _extensionService: IExtensionService,
	) { }

	private _isTrustedCommandSource(source: ICommandActionSource | undefined): boolean {
		if (!source) {
			return true; // core built-in command with no extension origin
		}
		const publisher = source.id.toLowerCase().split('.')[0];
		if ((this._productService.trustedExtensionPublishers ?? []).includes(publisher)) {
			return true;
		}
		// Also allow built-in (system) extensions regardless of publisher
		return this._extensionService.extensions.some(
			e => e.isBuiltin && e.identifier.value.toLowerCase() === source.id.toLowerCase()
		);
	}

	getAgentAllowedCommands(): IAgentCommandDescriptor[] {
		const all = this.getAllAgentCompatibleCommands();
		const result: IAgentCommandDescriptor[] = [];
		let filteredDisabled = 0;
		for (const cmd of all) {
			if (!cmd.enabled) {
				filteredDisabled++;
				continue;
			}
			const { enabled: _e, precondition: _p, inPalette: _ip, ...descriptor } = cmd;
			result.push(descriptor);
		}
		this._logService.trace(
			`[AgentAllowedCommands] returning ${result.length} curated command(s); ` +
			`filtered ${filteredDisabled} disabled by precondition`
		);
		return result;
	}

	getAllAgentCompatibleCommands(): IAgentCommandDebugDescriptor[] {
		// Set of ids currently visible in the command palette. `f1: true` on an
		// Action2 registers the command as a Command Palette menu item; other
		// registrations (MultiCommand, appendMenuItem) may also land here.
		// This is the ground truth for "the user could invoke this from F1".
		const paletteIds = new Set<string>();
		for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
			if (isIMenuItem(item)) {
				paletteIds.add(item.command.id);
			}
		}

		const result: IAgentCommandDebugDescriptor[] = [];
		for (const [id, menuCmd] of MenuRegistry.getCommands()) {
			if (!menuCmd.metadata?.agentCompatible) {
				continue;
			}
			if (!this._isTrustedCommandSource(menuCmd.source)) {
				continue;
			}
			const meta = menuCmd.metadata;
			const precondition = menuCmd.precondition;
			const enabled = !precondition || this._contextKeyService.contextMatchesRules(precondition);
			const source: IAgentCommandSource = menuCmd.source
				? { type: 'extension', id: menuCmd.source.id, displayName: menuCmd.source.title }
				: { type: 'builtin' };
			result.push({
				id,
				description: toDescription(meta.description),
				args: meta.args?.map(a => ({
					name: a.name,
					description: a.description,
					schema: a.schema,
					required: a.isOptional !== true,
				})),
				returns: meta.returns,
				source,
				enabled,
				precondition: precondition?.serialize(),
				inPalette: paletteIds.has(id),
			});
		}
		return result;
	}

	async validateAndExecute(commandId: string, args?: unknown[]): Promise<IValidateAndExecuteResult> {
		// Also check MenuRegistry for commands declared in contributes.commands whose
		// extension has not yet activated. commandService.executeCommand fires the
		// onCommand:<id> activation event which registers the handler before running it.
		if (!CommandsRegistry.getCommand(commandId) && !MenuRegistry.getCommand(commandId)) {
			return { ok: false, reason: 'not-found' };
		}
		// Precondition comes from the ICommandAction registered via MenuRegistry.addCommand
		// (populated by registerAction2 when f1: true). Non-Action2 commands have no
		// recorded precondition and are treated as always enabled.
		const precondition = MenuRegistry.getCommand(commandId)?.precondition;
		if (precondition && !this._contextKeyService.contextMatchesRules(precondition)) {
			return {
				ok: false,
				reason: 'disabled',
				precondition: precondition.serialize(),
			};
		}
		try {
			const result = await this._commandService.executeCommand(commandId, ...(args ?? []));
			return { ok: true, result };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, reason: 'error', message };
		}
	}
}
