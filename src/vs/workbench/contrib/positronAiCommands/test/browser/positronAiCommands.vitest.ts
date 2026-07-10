/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { CommandCenter } from '../../../../../platform/commandCenter/common/commandCenter.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { EXECUTE_COMMAND_CHECKED_ID } from '../../browser/positronAiCommands.contribution.js';

describe('_positron.ai.executeCommandChecked', () => {
	let executeCommand: ReturnType<typeof vi.fn<(id: string, ...args: unknown[]) => Promise<unknown>>>;
	let contextMatchesRules: ReturnType<typeof vi.fn<(rules?: unknown) => boolean>>;

	// The stub bodies delegate through closures so they always call the current
	// vi.fn handles, which beforeEach recreates per test.
	const ctx = createTestContainer()
		.stub(ICommandService, stubInterface<ICommandService>({
			executeCommand: <T>(id: string, ...args: unknown[]) => executeCommand(id, ...args) as Promise<T>,
		}))
		.stub(IContextKeyService, stubInterface<IContextKeyService>({
			contextMatchesRules: rules => contextMatchesRules(rules),
		}))
		.build();

	beforeEach(() => {
		executeCommand = vi.fn<(id: string, ...args: unknown[]) => Promise<unknown>>();
		contextMatchesRules = vi.fn<(rules?: unknown) => boolean>().mockReturnValue(true);
	});

	function runChecked(commandId: unknown, args?: unknown): Promise<unknown> {
		const command = CommandsRegistry.getCommand(EXECUTE_COMMAND_CHECKED_ID);
		if (!command) {
			throw new Error('checked command is not registered');
		}
		// ICommandHandler is typed to return void; the checked handler really
		// returns a result promise, so narrow through unknown.
		return ctx.instantiationService.invokeFunction(
			accessor => command.handler(accessor, commandId, args) as unknown as Promise<unknown>);
	}

	function registerTargetCommand(id: string): void {
		ctx.disposables.add(CommandsRegistry.registerCommand(id, () => undefined));
	}

	it('returns unknown for an unregistered command id', async () => {
		expect(await runChecked('positronAiCommandsTest.doesNotExist')).toEqual(
			{ ok: false, reason: 'unknown' });
		expect(executeCommand).not.toHaveBeenCalled();
	});

	it('returns unknown for a non-string command id', async () => {
		expect(await runChecked(42)).toEqual({ ok: false, reason: 'unknown' });
		expect(executeCommand).not.toHaveBeenCalled();
	});

	it('executes a command without a precondition and returns its result', async () => {
		registerTargetCommand('positronAiCommandsTest.noPrecondition');
		executeCommand.mockResolvedValue('the-result');

		expect(await runChecked('positronAiCommandsTest.noPrecondition')).toEqual(
			{ ok: true, result: 'the-result' });
		expect(executeCommand).toHaveBeenCalledWith('positronAiCommandsTest.noPrecondition');
	});

	it('passes positional args through to the command', async () => {
		registerTargetCommand('positronAiCommandsTest.withArgs');
		executeCommand.mockResolvedValue(undefined);

		await runChecked('positronAiCommandsTest.withArgs', ['pkg', 2, true]);

		expect(executeCommand).toHaveBeenCalledWith('positronAiCommandsTest.withArgs', 'pkg', 2, true);
	});

	it('treats non-array args as no args', async () => {
		registerTargetCommand('positronAiCommandsTest.badArgs');
		executeCommand.mockResolvedValue(undefined);

		await runChecked('positronAiCommandsTest.badArgs', 'not-an-array');

		expect(executeCommand).toHaveBeenCalledWith('positronAiCommandsTest.badArgs');
	});

	it('returns disabled with the serialized precondition when the context does not match', async () => {
		registerTargetCommand('positronAiCommandsTest.disabled');
		// CommandCenter has no removal API, so entries outlive the test; keep
		// command ids unique per test to avoid inheriting stale preconditions.
		CommandCenter.addCommandInfo({
			id: 'positronAiCommandsTest.disabled',
			title: 'Disabled Test Command',
			precondition: ContextKeyExpr.equals('positronAiCommandsTestKey', 'on'),
		});
		contextMatchesRules.mockReturnValue(false);

		expect(await runChecked('positronAiCommandsTest.disabled')).toEqual(
			{ ok: false, reason: 'disabled', precondition: 'positronAiCommandsTestKey == \'on\'' });
		expect(executeCommand).not.toHaveBeenCalled();
	});

	it('executes a command whose precondition matches', async () => {
		registerTargetCommand('positronAiCommandsTest.enabled');
		CommandCenter.addCommandInfo({
			id: 'positronAiCommandsTest.enabled',
			title: 'Enabled Test Command',
			precondition: ContextKeyExpr.equals('positronAiCommandsTestKey', 'on'),
		});
		contextMatchesRules.mockReturnValue(true);
		executeCommand.mockResolvedValue(undefined);

		expect(await runChecked('positronAiCommandsTest.enabled')).toEqual(
			{ ok: true, result: undefined });
	});

	it('returns error with the message when the command throws', async () => {
		registerTargetCommand('positronAiCommandsTest.throws');
		executeCommand.mockRejectedValue(new Error('boom'));

		expect(await runChecked('positronAiCommandsTest.throws')).toEqual(
			{ ok: false, reason: 'error', message: 'boom' });
	});

	it('stringifies a non-Error rejection', async () => {
		registerTargetCommand('positronAiCommandsTest.throwsRaw');
		executeCommand.mockRejectedValue('raw-failure');

		expect(await runChecked('positronAiCommandsTest.throwsRaw')).toEqual(
			{ ok: false, reason: 'error', message: 'raw-failure' });
	});
});
