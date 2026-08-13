/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
// Imported for its side effect: registers the `_getAllCommands` command.
import '../../browser/preferencesActions.js';

/**
 * Agent tooling calls `_getAllCommands` to list the commands it can run. It used to look at the
 * menu item's `when` only, which misses commands the palette picks up on its own: those have no
 * `when` at all (see `MenuRegistry._appendImplicitItems`), so a gated command still came back. It
 * now checks the command's own precondition as well, and reports both conditions together.
 *
 * These tests need the real `ContextKeyService`. The workbench test services hand you
 * `MockContextKeyService`, whose `contextMatchesRules` always returns `false`, so every command
 * would be filtered out and the tests would pass without checking anything.
 */
describe('_getAllCommands', () => {
	const contextKeyService = new ContextKeyService(new TestConfigurationService());
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IContextKeyService, contextKeyService)
		.build();
	const disposables = new DisposableStore();

	afterEach(() => disposables.clear());
	afterAll(() => contextKeyService.dispose());

	function getAllCommands(filterByPrecondition: boolean) {
		const handler = CommandsRegistry.getCommand('_getAllCommands')!.handler;
		return ctx.instantiationService.invokeFunction(handler, filterByPrecondition) as
			unknown as { command: string; precondition?: string }[];
	}

	// No command palette entry of its own, so the palette picks it up with no `when`.
	function addImplicitCommand(id: string, precondition: string) {
		disposables.add(MenuRegistry.addCommand({
			id,
			title: id,
			precondition: ContextKeyExpr.deserialize(precondition),
		}));
	}

	it('excludes a command whose precondition is false', () => {
		contextKeyService.createKey('testGateOn', false);
		addImplicitCommand('test.gatedCommand', 'testGateOn');

		expect(getAllCommands(true).map(c => c.command)).not.toContain('test.gatedCommand');
	});

	it('includes the same command once its precondition holds', () => {
		contextKeyService.createKey('testGateOn', true);
		addImplicitCommand('test.gatedCommand', 'testGateOn');

		expect(getAllCommands(true).map(c => c.command)).toContain('test.gatedCommand');
	});

	it('reports the command "precondition" alongside the menu "when"', () => {
		disposables.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: 'test.reportedCommand',
				title: 'test.reportedCommand',
				precondition: ContextKeyExpr.deserialize('testGateOn'),
			},
			when: ContextKeyExpr.deserialize('testMenuWhen'),
		}));

		const reported = getAllCommands(false).find(c => c.command === 'test.reportedCommand');
		expect(reported?.precondition).toBe('testGateOn && testMenuWhen');
	});
});
