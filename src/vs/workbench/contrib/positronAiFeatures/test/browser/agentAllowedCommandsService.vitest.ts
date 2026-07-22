/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKeyService, ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { AgentAllowedCommandsService, IGetAgentAllowedCommandsOptions } from '../../common/agentAllowedCommandsService.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';

describe('AgentAllowedCommandsService', () => {
	const disposables = ensureNoLeakedDisposables();

	let store: DisposableStore;

	beforeEach(() => {
		store = disposables.add(new DisposableStore());
	});

	function makeService(overrides: {
		executeCommand?: ICommandService['executeCommand'];
		contextMatchesRules?: IContextKeyService['contextMatchesRules'];
		trustedPublishers?: string[];
		extensions?: IExtensionService['extensions'];
	} = {}) {
		const commandService = stubInterface<ICommandService>({
			executeCommand: overrides.executeCommand ?? vi.fn(async () => undefined),
		});
		const contextKeyService = stubInterface<IContextKeyService>({
			contextMatchesRules: overrides.contextMatchesRules ?? (() => true),
		});
		const productService = stubInterface<IProductService>({
			trustedExtensionPublishers: overrides.trustedPublishers ?? [],
		});
		const extensionService = stubInterface<IExtensionService>({
			extensions: overrides.extensions ?? [],
		});
		return new AgentAllowedCommandsService(commandService, contextKeyService, new NullLogService(), productService, extensionService);
	}

	/** Register a command and add it to the command palette (mirrors `registerAction2` with `f1: true`). */
	function registerPaletteCommand(id: string, options: {
		agentCompatible?: boolean;
		description?: string;
		precondition?: ContextKeyExpression;
		metadataArgs?: Parameters<typeof CommandsRegistry.registerCommand>[0] extends { metadata?: infer M }
			? M extends { args?: infer A } ? A : never
			: never;
		metadataReturns?: string;
	} = {}) {
		store.add(CommandsRegistry.registerCommand({
			id,
			handler: () => { },
			metadata: {
				description: options.description ?? id,
				agentCompatible: options.agentCompatible,
				args: options.metadataArgs,
				returns: options.metadataReturns,
			},
		}));
		store.add(MenuRegistry.addCommand({
			id,
			title: options.description ?? id,
			precondition: options.precondition,
			metadata: {
				description: options.description ?? id,
				agentCompatible: options.agentCompatible,
				args: options.metadataArgs,
				returns: options.metadataReturns,
			},
		}));
		store.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: { id, title: options.description ?? id },
			when: options.precondition,
		}));
	}

	describe('getAgentAllowedCommands', () => {
		it('returns only commands marked agentCompatible and currently enabled', () => {
			registerPaletteCommand('test.agent.included', {
				agentCompatible: true,
				description: 'included cmd',
				metadataArgs: [
					{ name: 'first', description: 'the first arg', schema: { type: 'string' } },
					{ name: 'second', isOptional: true, schema: { type: 'number' } },
				],
				metadataReturns: 'nothing',
			});
			registerPaletteCommand('test.agent.excluded', { agentCompatible: false, description: 'not marked' });

			const service = makeService();
			const commands = service.getAgentAllowedCommands();
			const ids = commands.map(c => c.id);

			expect(ids).toContain('test.agent.included');
			expect(ids).not.toContain('test.agent.excluded');

			const included = commands.find(c => c.id === 'test.agent.included')!;
			expect(included).toMatchObject({
				id: 'test.agent.included',
				description: 'included cmd',
				returns: 'nothing',
				source: { type: 'builtin' },
				args: [
					{ name: 'first', description: 'the first arg', schema: { type: 'string' }, required: true },
					{ name: 'second', schema: { type: 'number' }, required: false },
				],
			});
		});

		it('drops commands whose precondition does not currently hold', () => {
			const precondition = ContextKeyExpr.equals('foo', 'bar')!;
			registerPaletteCommand('test.agent.gated', {
				agentCompatible: true,
				description: 'gated',
				precondition,
			});

			const service = makeService({
				contextMatchesRules: (expr: ContextKeyExpression | undefined) => expr === undefined,
			});
			expect(service.getAgentAllowedCommands().map(c => c.id))
				.not.toContain('test.agent.gated');
		});

		it('drops curated ids after their registration is disposed', () => {
			registerPaletteCommand('test.agent.transient', { agentCompatible: true });
			expect(makeService().getAgentAllowedCommands().map(c => c.id))
				.toContain('test.agent.transient');

			store.clear();
			expect(makeService().getAgentAllowedCommands().map(c => c.id))
				.not.toContain('test.agent.transient');
		});

		it('includes non-palette commands by default', () => {
			// Registered via CommandsRegistry only (no MenuRegistry entry → not in the palette).
			// The default call must still surface it; f1Only is an opt-in filter.
			store.add(CommandsRegistry.registerCommand({
				id: 'test.agent.notPalette',
				handler: () => { },
				metadata: { description: 'not in palette', agentCompatible: true },
			}));
			expect(makeService().getAgentAllowedCommands().map(c => c.id))
				.toContain('test.agent.notPalette');
		});

		it('f1Only option excludes commands not in the command palette', () => {
			registerPaletteCommand('test.agent.f1.palette', { agentCompatible: true });
			store.add(CommandsRegistry.registerCommand({
				id: 'test.agent.f1.nonPalette',
				handler: () => { },
				metadata: { description: 'not in palette', agentCompatible: true },
			}));
			const service = makeService();
			const options: IGetAgentAllowedCommandsOptions = { f1Only: true };
			const ids = service.getAgentAllowedCommands(options).map(c => c.id);
			expect(ids).toContain('test.agent.f1.palette');
			expect(ids).not.toContain('test.agent.f1.nonPalette');
		});

		it('enabledOnly: false includes commands whose precondition does not hold', () => {
			const precondition = ContextKeyExpr.equals('foo', 'bar')!;
			registerPaletteCommand('test.agent.enabledOnly.gated', {
				agentCompatible: true,
				description: 'gated',
				precondition,
			});
			const service = makeService({
				contextMatchesRules: (expr: ContextKeyExpression | undefined) => expr === undefined,
			});
			expect(service.getAgentAllowedCommands().map(c => c.id))
				.not.toContain('test.agent.enabledOnly.gated');
			expect(service.getAgentAllowedCommands({ enabledOnly: false }).map(c => c.id))
				.toContain('test.agent.enabledOnly.gated');
		});
	});

	describe('getAllAgentCompatibleCommands', () => {
		it('returns every agent-compatible command with enabled / precondition / inPalette flags', () => {
			const precondition = ContextKeyExpr.equals('foo', 'bar')!;
			registerPaletteCommand('test.agent.debug.enabled', {
				agentCompatible: true,
				description: 'enabled cmd',
			});
			registerPaletteCommand('test.agent.debug.disabled', {
				agentCompatible: true,
				description: 'gated cmd',
				precondition,
			});
			// CommandsRegistry-only: not in MenuRegistry → inPalette: false.
			store.add(CommandsRegistry.registerCommand({
				id: 'test.agent.debug.notPalette',
				handler: () => { },
				metadata: { description: 'not in palette', agentCompatible: true },
			}));

			const service = makeService({
				contextMatchesRules: (expr: ContextKeyExpression | undefined) => expr === undefined,
			});
			const commands = service.getAllAgentCompatibleCommands();
			const byId = new Map(commands.map(c => [c.id, c]));

			expect(byId.get('test.agent.debug.enabled')).toMatchObject({
				enabled: true,
				precondition: undefined,
				inPalette: true,
			});
			expect(byId.get('test.agent.debug.disabled')).toMatchObject({
				enabled: false,
				precondition: precondition.serialize(),
				inPalette: true,
			});
			expect(byId.get('test.agent.debug.notPalette')).toMatchObject({
				enabled: true,
				precondition: undefined,
				inPalette: false,
			});
		});

		it('includes a command from a built-in extension regardless of publisher', () => {
			// A bundled (isBuiltin) extension that is not a trusted publisher still
			// qualifies -- isBuiltin is the second acceptance path in _isTrustedCommandSource.
			store.add(MenuRegistry.addCommand({
				id: 'thirdparty.builtinCmd',
				title: 'Built-in Extension Command',
				source: { id: 'thirdparty.builtinExt', title: 'Built-in Ext' },
				metadata: { description: 'desc', agentCompatible: true },
			}));

			const service = makeService({
				trustedPublishers: ['posit'],  // 'thirdparty' is NOT in the trusted list
				extensions: [{ identifier: { value: 'thirdparty.builtinExt' }, isBuiltin: true }] as unknown as IExtensionService['extensions'],
			});

			const cmd = service.getAllAgentCompatibleCommands().find(c => c.id === 'thirdparty.builtinCmd');
			expect(cmd).toBeDefined();
			expect(cmd!.source).toEqual({ type: 'extension', id: 'thirdparty.builtinExt', displayName: 'Built-in Ext' });
		});

		it('includes a command from a trusted-publisher extension with full metadata', () => {
			// Mirrors what menusExtensionPoint handleCommand produces when positron-r
			// declares "agent": {...} in its contributes.commands package.json entry.
			const precondition = ContextKeyExpr.equals('positronR.activeSession', 'true')!;
			store.add(MenuRegistry.addCommand({
				id: 'positron-r.restartSession',
				title: 'Restart R Session',
				category: { value: 'R', original: 'R' },
				source: { id: 'posit.positron-r', title: 'Positron R' },
				precondition,
				metadata: {
					description: 'Restarts the active R interpreter session. Use when the session is stuck or needs a clean environment.',
					agentCompatible: true,
					args: [
						{
							name: 'sessionId',
							description: 'ID of the session to restart. Omit to restart the active session.',
							isOptional: true,
							schema: { type: 'string' },
						},
					],
					returns: 'void',
				},
			}));

			const service = makeService({
				trustedPublishers: ['posit'],
				contextMatchesRules: (expr: ContextKeyExpression | undefined) => expr === undefined,
			});

			const cmd = service.getAllAgentCompatibleCommands().find(c => c.id === 'positron-r.restartSession');
			expect(cmd).toMatchObject({
				id: 'positron-r.restartSession',
				description: 'Restarts the active R interpreter session. Use when the session is stuck or needs a clean environment.',
				source: { type: 'extension', id: 'posit.positron-r', displayName: 'Positron R' },
				args: [
					{
						name: 'sessionId',
						description: 'ID of the session to restart. Omit to restart the active session.',
						required: false,
						schema: { type: 'string' },
					},
				],
				returns: 'void',
				enabled: false,  // precondition fails (positronR.activeSession not set)
				precondition: precondition.serialize(),
				inPalette: true,  // all MenuRegistry commands are implicitly palette-visible
			});
		});

		it('excludes a command from an untrusted non-builtin extension', () => {
			store.add(MenuRegistry.addCommand({
				id: 'untrusted.agentCmd',
				title: 'Untrusted Extension Command',
				source: { id: 'untrusted.ext', title: 'Untrusted Ext' },
				metadata: { description: 'desc', agentCompatible: true },
			}));

			const service = makeService({ trustedPublishers: ['posit'], extensions: [] });
			expect(service.getAllAgentCompatibleCommands().find(c => c.id === 'untrusted.agentCmd'))
				.toBeUndefined();
		});
	});

	describe('validateAndExecute', () => {
		it('returns { ok: true, result } on a successful execution', async () => {
			store.add(CommandsRegistry.registerCommand('test.agent.happy', () => 42));
			const executeCommand = vi.fn(async () => 42) as unknown as ICommandService['executeCommand'];
			const service = makeService({ executeCommand });

			const result = await service.validateAndExecute('test.agent.happy', ['a', 1]);

			expect(result).toEqual({ ok: true, result: 42 });
			expect(executeCommand).toHaveBeenCalledWith('test.agent.happy', 'a', 1);
		});

		it('returns { ok: false, reason: "not-found" } for an unregistered id', async () => {
			const service = makeService();
			const result = await service.validateAndExecute('test.agent.nonexistent');
			expect(result).toEqual({ ok: false, reason: 'not-found' });
		});

		it('returns { ok: false, reason: "disabled", precondition } when the precondition fails', async () => {
			const precondition = ContextKeyExpr.equals('foo', 'bar')!;
			store.add(CommandsRegistry.registerCommand('test.agent.gated', () => { }));
			store.add(MenuRegistry.addCommand({
				id: 'test.agent.gated',
				title: 'Gated',
				precondition,
			}));

			const executeCommand = vi.fn(async () => 'should-not-be-called') as unknown as ICommandService['executeCommand'];
			const service = makeService({
				executeCommand,
				contextMatchesRules: (expr: ContextKeyExpression | undefined) =>
					expr === undefined,
			});

			const result = await service.validateAndExecute('test.agent.gated');

			expect(result).toEqual({
				ok: false,
				reason: 'disabled',
				precondition: precondition.serialize(),
			});
			expect(executeCommand).not.toHaveBeenCalled();
		});

		it('returns { ok: false, reason: "error", message } when the handler throws', async () => {
			store.add(CommandsRegistry.registerCommand('test.agent.boom', () => { }));
			const executeCommand = vi.fn(async () => {
				throw new Error('boom');
			}) as unknown as ICommandService['executeCommand'];
			const service = makeService({ executeCommand });

			const result = await service.validateAndExecute('test.agent.boom');

			expect(result).toEqual({ ok: false, reason: 'error', message: 'boom' });
		});
	});
});
