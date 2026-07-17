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
import { AgentAllowedCommandsService } from '../../common/agentAllowedCommandsService.js';

describe('AgentAllowedCommandsService', () => {
	const disposables = ensureNoLeakedDisposables();

	let store: DisposableStore;

	beforeEach(() => {
		store = disposables.add(new DisposableStore());
	});

	function makeService(overrides: {
		executeCommand?: ICommandService['executeCommand'];
		contextMatchesRules?: IContextKeyService['contextMatchesRules'];
	} = {}) {
		const commandService = stubInterface<ICommandService>({
			executeCommand: overrides.executeCommand ?? vi.fn(async () => undefined),
		});
		const contextKeyService = stubInterface<IContextKeyService>({
			contextMatchesRules: overrides.contextMatchesRules ?? (() => true),
		});
		return new AgentAllowedCommandsService(commandService, contextKeyService, new NullLogService());
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
		}));
		store.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: { id, title: options.description ?? id },
			when: options.precondition,
		}));
	}

	describe('getAgentAllowedCommands', () => {
		it('returns only commands marked agentCompatible and exposed in the command palette', () => {
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

			// Marked agentCompatible but NOT registered in the command palette.
			store.add(CommandsRegistry.registerCommand({
				id: 'test.agent.notPalette',
				handler: () => { },
				metadata: { description: 'not palette-exposed', agentCompatible: true },
			}));

			const service = makeService();
			const commands = service.getAgentAllowedCommands();
			const ids = commands.map(c => c.id);

			expect(ids).toContain('test.agent.included');
			expect(ids).not.toContain('test.agent.excluded');
			expect(ids).not.toContain('test.agent.notPalette');

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
			store.add(CommandsRegistry.registerCommand({
				id: 'test.agent.debug.notPalette',
				handler: () => { },
				metadata: { description: 'not palette-exposed', agentCompatible: true },
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

		it('returns { ok: false, reason: "unknown" } for an unregistered id', async () => {
			const service = makeService();
			const result = await service.validateAndExecute('test.agent.nonexistent');
			expect(result).toEqual({ ok: false, reason: 'unknown' });
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
