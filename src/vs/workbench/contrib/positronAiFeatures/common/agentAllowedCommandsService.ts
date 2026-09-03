/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry, ICommandMetadata, ICommandService } from '../../../../platform/commands/common/commands.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpression, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IJSONSchema } from '../../../../base/common/jsonSchema.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { externalUriToString } from '../../../../base/common/positronUtilities.js';
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
 * Options for filtering the result of {@link IAgentAllowedCommandsService.getAgentAllowedCommands}.
 */
export interface IGetAgentAllowedCommandsOptions {
	/** Only include commands currently in the command palette (`f1: true`). Default: `false`. */
	f1Only?: boolean;
	/** Only include commands whose precondition currently holds. Default: `true`. */
	enabledOnly?: boolean;
}

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
	getAgentAllowedCommands(options?: IGetAgentAllowedCommandsOptions): IAgentCommandDescriptor[];

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
	 *
	 * URIs in the result are replaced by their string form, at any depth, so
	 * the value stays plain JSON across the extension host boundary.
	 */
	validateAndExecute(commandId: string, args?: unknown[]): Promise<IValidateAndExecuteResult>;
}

/**
 * Depth cap for {@link withUrisAsStrings}. Matches the cap `revive` and
 * `transformOutgoingURIs` use, and bounds the walk on a cyclic result rather
 * than recursing until the stack gives out.
 */
const MAX_RESULT_WALK_DEPTH = 200;

/** Signals that a subtree held no URI, so the caller should reuse the original value. */
const UNCHANGED = Symbol('unchanged');

/**
 * Walk `value` replacing URIs with strings.
 * @returns The rebuilt value, or {@link UNCHANGED} when this subtree held no URI.
 */
function convertUris(value: unknown, depth: number): unknown {
	if (depth > MAX_RESULT_WALK_DEPTH || typeof value !== 'object' || value === null) {
		return UNCHANGED;
	}
	if (URI.isUri(value)) {
		return externalUriToString(value);
	}
	// Binary payloads are array-like, so walking them would expand them into
	// index-keyed objects. `revive` guards the same two types for this reason.
	if (value instanceof VSBuffer || value instanceof Uint8Array) {
		return UNCHANGED;
	}

	// Copy on write: the result belongs to the command handler, which may still
	// hold a reference to it, so a subtree is only rebuilt once it actually
	// contains a URI. A result without any URI is returned untouched and
	// allocates nothing, which is the overwhelmingly common case.
	if (Array.isArray(value)) {
		let copy: unknown[] | undefined;
		for (let i = 0; i < value.length; i++) {
			const converted = convertUris(value[i], depth + 1);
			if (converted === UNCHANGED) {
				continue;
			}
			copy ??= value.slice();
			copy[i] = converted;
		}
		return copy ?? UNCHANGED;
	}

	let copy: Record<string, unknown> | undefined;
	for (const key in value) {
		if (!Object.hasOwnProperty.call(value, key)) {
			continue;
		}
		const converted = convertUris((value as Record<string, unknown>)[key], depth + 1);
		if (converted === UNCHANGED) {
			continue;
		}
		copy ??= { ...value };
		copy[key] = converted;
	}
	return copy ?? UNCHANGED;
}

/**
 * Replace every URI in a command result, at any depth, with its string form.
 *
 * A URI that crosses the extension host boundary is serialized by
 * `URI.toJSON()` into its marshalled form (`$mid`, `fsPath`, `external`, and
 * friends), and nothing on the agent path revives it, so an agent would
 * otherwise see internal marshalling detail and have to guess which field is
 * the resource. A single string gives it one unambiguous value that can be
 * passed straight back as an argument to another command.
 *
 * Uses {@link externalUriToString} rather than `URI.toString()` because the
 * latter percent-encodes query delimiters (`?a=1&b=2` becomes
 * `?a%3D1%26b%3D2`), which would corrupt the app URLs returned by the run and
 * debug app commands.
 *
 * The input is never mutated.
 */
function withUrisAsStrings(value: unknown): unknown {
	const converted = convertUris(value, 0);
	return converted === UNCHANGED ? value : converted;
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

	/**
	 * Build the debug descriptor shared by both discovery passes. `meta` may
	 * come from either the CommandsRegistry entry or the MenuRegistry
	 * `ICommandAction`; `source` and `precondition` always come from MenuRegistry
	 * (undefined for core commands with no menu entry).
	 */
	private _toDebugDescriptor(
		id: string,
		meta: ICommandMetadata,
		source: ICommandActionSource | undefined,
		precondition: ContextKeyExpression | undefined,
		paletteIds: ReadonlySet<string>,
	): IAgentCommandDebugDescriptor {
		return {
			id,
			description: toDescription(meta.description),
			args: meta.args?.map(a => ({
				name: a.name,
				description: a.description,
				schema: a.schema,
				required: a.isOptional !== true,
			})),
			returns: meta.returns,
			source: source
				? { type: 'extension', id: source.id, displayName: source.title }
				: { type: 'builtin' },
			enabled: !precondition || this._contextKeyService.contextMatchesRules(precondition),
			precondition: precondition?.serialize(),
			inPalette: paletteIds.has(id),
		};
	}

	getAgentAllowedCommands(options: IGetAgentAllowedCommandsOptions = {}): IAgentCommandDescriptor[] {
		const { f1Only = false, enabledOnly = true } = options;
		const all = this.getAllAgentCompatibleCommands();
		const result: IAgentCommandDescriptor[] = [];
		let filtered = 0;
		for (const cmd of all) {
			if (enabledOnly && !cmd.enabled) { filtered++; continue; }
			if (f1Only && !cmd.inPalette) { filtered++; continue; }
			const { enabled: _e, precondition: _p, inPalette: _ip, ...descriptor } = cmd;
			result.push(descriptor);
		}
		this._logService.trace(
			`[AgentAllowedCommands] returning ${result.length} curated command(s); ` +
			`filtered ${filtered} by options`
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
		const seenIds = new Set<string>();

		// Pass 1: CommandsRegistry is the canonical source and includes non-f1
		// commands from registerAction2 that MenuRegistry would miss.
		for (const [id, command] of CommandsRegistry.getCommands()) {
			if (!command.metadata?.agentCompatible) {
				continue;
			}
			const menuCmd = MenuRegistry.getCommand(id);
			if (!this._isTrustedCommandSource(menuCmd?.source)) {
				continue;
			}
			result.push(this._toDebugDescriptor(id, command.metadata, menuCmd?.source, menuCmd?.precondition, paletteIds));
			seenIds.add(id);
		}

		// Pass 2: Also surface commands declared in contributes.commands that
		// live in MenuRegistry pre-activation (before the extension calls
		// registerCommand and populates CommandsRegistry).
		for (const [id, menuCmd] of MenuRegistry.getCommands()) {
			if (!menuCmd.metadata?.agentCompatible || seenIds.has(id)) {
				continue;
			}
			if (!this._isTrustedCommandSource(menuCmd.source)) {
				continue;
			}
			result.push(this._toDebugDescriptor(id, menuCmd.metadata, menuCmd.source, menuCmd.precondition, paletteIds));
		}
		return result;
	}

	async validateAndExecute(commandId: string, args?: unknown[]): Promise<IValidateAndExecuteResult> {
		// Also check MenuRegistry for commands declared in contributes.commands whose
		// extension has not yet activated. commandService.executeCommand fires the
		// onCommand:<id> activation event which registers the handler before running it.
		//
		// Execution is intentionally NOT gated on agentCompatible or a trusted
		// source: the Assistant team decided not to restrict which commands can be
		// run (posit-dev/assistant#1810). The curated agentCompatible list only
		// drives discovery (getAgentAllowedCommands); safety at execution time comes
		// from the per-command user confirmation and prompting, not a hard gate.
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
			// Inside the try so that a pathological result (one nested past the
			// depth cap, say) is reported as a structured 'error' rather than
			// escaping as a rejection.
			return { ok: true, result: withUrisAsStrings(result) };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, reason: 'error', message };
		}
	}
}
