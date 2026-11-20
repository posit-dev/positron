/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../../common/views.js';
import { JOIN_PROJECT_COMMAND_ID, POSITRON_CHECKPOINTS_VIEW_CONTAINER_ID, POSITRON_CHECKPOINTS_VIEW_ID } from '../../browser/positronCheckpoints.contribution.js';
import { CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY, CHECKPOINTS_MODEL_KEY } from '../../common/checkpointsConfiguration.js';
import { PositronCheckpointsView } from '../../browser/positronCheckpointsView.js';
import { OverlapEditorPane } from '../../browser/overlapEditor/overlapEditor.js';
import { OverlapEditorInput } from '../../browser/overlapEditor/overlapEditorInput.js';
import { IEditorPaneRegistry } from '../../../../browser/editor.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorExtensions } from '../../../../common/editor.js';

describe('positronCheckpoints.contribution', () => {
	test('registers the Checkpoints side bar container and its view for any workspace folder', () => {
		const containers = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
		const container = containers.get(POSITRON_CHECKPOINTS_VIEW_CONTAINER_ID);
		expect(container).toBeDefined();
		expect(containers.getViewContainerLocation(container!)).toBe(ViewContainerLocation.Sidebar);

		const view = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).getView(POSITRON_CHECKPOINTS_VIEW_ID);
		expect(view?.when?.equals(ContextKeyExpr.greater('workspaceFolderCount', 0))).toBe(true);
		expect(view?.ctorDescriptor.ctor).toBe(PositronCheckpointsView);
	});

	test('registers the overlap editor pane for its input', () => {
		const input = new OverlapEditorInput();
		try {
			const pane = Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).getEditorPane(input);
			expect(pane?.typeId).toBe(OverlapEditorInput.EditorID);
			expect(pane?.name).toBe('Overlap Editor');
			expect(OverlapEditorPane.prototype).toBeInstanceOf(EditorPane);
			expect(input.typeId).toBe('workbench.input.positronCheckpointsOverlaps');
			expect(input.matches(new OverlapEditorInput())).toBe(true);
		} finally {
			input.dispose();
		}
	});

	test('the model setting says an empty list uses the default fast tier', () => {
		const properties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
		expect(properties[CHECKPOINTS_MODEL_KEY]?.markdownDescription).toContain('the default fast tier is used');
	});

	test('the interval setting cannot be negative', () => {
		const properties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
		expect(properties[CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY]?.minimum).toBe(0);
	});

	test('the Join a Project command is registered with its title in the Command Palette', () => {
		expect(JOIN_PROJECT_COMMAND_ID).toBe('positronCheckpoints.joinProject');
		expect(CommandsRegistry.getCommand(JOIN_PROJECT_COMMAND_ID)).toBeDefined();
		const entry = MenuRegistry.getMenuItems(MenuId.CommandPalette).filter(isIMenuItem).find(item => item.command.id === JOIN_PROJECT_COMMAND_ID);
		expect(entry?.command.title).toEqual({ value: 'Join a Project', original: 'Join a Project' });
	});

	test('a window with no folder offers Join a Project in the welcome text of the Explorer', () => {
		const welcome = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).getViewWelcomeContent('workbench.explorer.emptyView');
		const entry = welcome.find(content => content.content.includes(`command:${JOIN_PROJECT_COMMAND_ID}`));
		expect(entry?.content).toContain('[Join a project]');
		const when = entry?.when;
		expect(typeof when === 'object' && when.equals(ContextKeyExpr.equals('workbenchState', 'empty'))).toBe(true);
	});
});
