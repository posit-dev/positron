/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { Extensions as ViewExtensions, IViewsRegistry } from '../../../../common/views.js';

/**
 * Contract test for the command ids curated for the assistant command-access
 * experiment (the positron-commands skill / executeCommand tool allowlist in
 * posit-dev/assistant). The assistant repo cannot see these registries, so ids
 * hand-written there drift silently when a command is renamed or its view
 * overrides its focus command (which is how the phantom
 * 'workbench.panel.positronVariables.focus' bug shipped). This test fails CI
 * the day such a drift happens.
 *
 * 'vscode.open' is deliberately absent: it is an extension-host API command,
 * invisible to these registries, and is exercised by the assistant repo's own
 * tool tests.
 *
 * This duplication of the curated list is Phase 0 scaffolding; the Phase 1
 * IDE-owned catalog replaces both copies.
 */
describe('assistant curated command contract', () => {
	function expectCommands(ids: string[]): void {
		const missing = ids.filter(id => !CommandsRegistry.getCommand(id));
		expect(missing).toEqual([]);
	}

	it('layout commands are registered', async () => {
		await import('../../../../services/positronLayout/browser/layouts/positronFourPaneDsLayout.js');
		await import('../../../../services/positronLayout/browser/layouts/positronTwoPaneLayout.js');
		await import('../../../../services/positronLayout/browser/layouts/positronNotebookLayout.js');

		expectCommands([
			'workbench.action.positronFourPaneDataScienceLayout',
			'workbench.action.positronTwoPaneDataScienceLayout',
			'workbench.action.positronNotebookLayout',
		]);
	});

	it('runtime session commands are registered', async () => {
		// Import the contribution (which registers the actions at module load)
		// rather than calling the register function: module caching then makes
		// any repeated import a no-op instead of a double registration.
		await import('../../../languageRuntime/browser/languageRuntime.contribution.js');

		expectCommands([
			'workbench.action.language.runtime.restartActiveSession',
			'workbench.action.languageRuntime.interrupt',
			'workbench.action.language.runtime.startNewConsoleSession',
			'workbench.action.language.runtime.discoverAllRuntimes',
		]);
	});

	it('console commands are registered', async () => {
		// The console contribution calls registerPositronConsoleActions() at
		// module load; importing it (rather than calling the function here)
		// avoids double registration when the focus test imports it again.
		await import('../../../positronConsole/browser/positronConsole.contribution.js');

		expectCommands(['workbench.action.positronConsole.clearConsole']);
	});

	it('data explorer commands are registered', async () => {
		await import('../../../positronDataExplorerEditor/browser/positronDataExplorerEditor.contribution.js');

		expectCommands([
			'workbench.action.positronDataExplorer.collapseSummary',
			'workbench.action.positronDataExplorer.expandSummary',
		]);
	});

	it('packages commands are registered', async () => {
		await import('../../../positronPackages/browser/positronPackages.contribution.js');

		expectCommands(['positronPackages.refreshPackages']);
	});

	it('notebook kernel command is registered', async () => {
		await import('../../../positronNotebook/browser/SelectPositronNotebookKernelAction.js');

		expectCommands(['positronNotebook.selectKernel']);
	});

	it('startup diagnostics command is registered', async () => {
		await import('../../../positronStartupDiagnostics/browser/positronStartupDiagnostics.contribution.js');

		expectCommands(['positron.startupDiagnostics.show']);
	});

	it('help topic lookup action carries the curated id and is palette-exposed', async () => {
		// LookupHelpTopic registers at runtime (inside a workbench contribution),
		// so assert the id and palette exposure on the exported action class.
		const { LookupHelpTopic } = await import('../../../positronHelp/browser/positronHelpActions.js');
		const desc = new LookupHelpTopic().desc;
		expect({ id: desc.id, f1: desc.f1 }).toEqual(
			{ id: 'positron.help.lookupHelpTopic', f1: true });
	});

	it('curated action commands are palette-exposed', async () => {
		// Curated commands must be designed for direct user invocation: palette
		// exposure (f1) is the marker. Internal commands carry caller-specific
		// assumptions -- positronPackages.openPackage, for example, opens a
		// detail editor for any name without checking the package exists,
		// because its only intended caller passes names from the installed
		// list. View focus commands and vscode.open are covered elsewhere
		// (runtime-registered palette entries and a documented API command).
		await import('../../../../services/positronLayout/browser/layouts/positronFourPaneDsLayout.js');
		await import('../../../../services/positronLayout/browser/layouts/positronTwoPaneLayout.js');
		await import('../../../../services/positronLayout/browser/layouts/positronNotebookLayout.js');
		await import('../../../languageRuntime/browser/languageRuntime.contribution.js');
		await import('../../../positronConsole/browser/positronConsole.contribution.js');
		await import('../../../positronDataExplorerEditor/browser/positronDataExplorerEditor.contribution.js');
		await import('../../../positronPackages/browser/positronPackages.contribution.js');
		await import('../../../positronNotebook/browser/SelectPositronNotebookKernelAction.js');
		await import('../../../positronStartupDiagnostics/browser/positronStartupDiagnostics.contribution.js');

		const paletteIds = new Set(
			MenuRegistry.getMenuItems(MenuId.CommandPalette)
				.filter(isIMenuItem)
				.map(item => item.command.id));
		const notExposed = [
			'workbench.action.positronFourPaneDataScienceLayout',
			'workbench.action.positronTwoPaneDataScienceLayout',
			'workbench.action.positronNotebookLayout',
			'workbench.action.language.runtime.restartActiveSession',
			'workbench.action.languageRuntime.interrupt',
			'workbench.action.language.runtime.startNewConsoleSession',
			'workbench.action.language.runtime.discoverAllRuntimes',
			'workbench.action.positronConsole.clearConsole',
			'workbench.action.positronDataExplorer.collapseSummary',
			'workbench.action.positronDataExplorer.expandSummary',
			'positronPackages.refreshPackages',
			'positronNotebook.selectKernel',
			'positron.startupDiagnostics.show',
		].filter(id => !paletteIds.has(id));

		expect(notExposed).toEqual([]);
	});

	it('view focus command ids match the ViewsRegistry derivation', async () => {
		// Focus commands are generated at runtime by ViewsService as
		// focusCommand?.id ?? `${viewId}.focus`. Applying the same derivation to
		// the registered view descriptors catches both renamed views and
		// focusCommand overrides (the Variables bug class).
		await import('../../../positronVariables/browser/positronVariables.contribution.js');
		await import('../../../positronPlots/browser/positronPlots.contribution.js');
		await import('../../../positronHelp/browser/positronHelp.contribution.js');
		await import('../../../positronConsole/browser/positronConsole.contribution.js');
		await import('../../../positronPackages/browser/positronPackages.contribution.js');

		const curatedFocus: Array<{ viewId: string; focusId: string }> = [
			{ viewId: 'workbench.panel.positronConsole', focusId: 'workbench.panel.positronConsole.focus' },
			{ viewId: 'workbench.panel.positronVariables', focusId: 'positronVariables.focus' },
			{ viewId: 'workbench.panel.positronPlots', focusId: 'workbench.panel.positronPlots.focus' },
			{ viewId: 'workbench.panel.positronHelp', focusId: 'workbench.panel.positronHelp.focus' },
			{ viewId: 'workbench.view.positronPackages.view', focusId: 'workbench.view.positronPackages.view.focus' },
		];

		const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
		const mismatches = curatedFocus
			.map(({ viewId, focusId }) => {
				const view = viewsRegistry.getView(viewId);
				const derived = view ? (view.focusCommand?.id ?? `${view.id}.focus`) : '<view not registered>';
				return { viewId, expected: focusId, derived };
			})
			.filter(({ expected, derived }) => expected !== derived);

		expect(mismatches).toEqual([]);
	});
});
