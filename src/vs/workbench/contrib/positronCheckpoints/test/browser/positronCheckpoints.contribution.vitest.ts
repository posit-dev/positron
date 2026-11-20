/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../../common/views.js';
import { POSITRON_CHECKPOINTS_VIEW_CONTAINER_ID, POSITRON_CHECKPOINTS_VIEW_ID } from '../../browser/positronCheckpoints.contribution.js';
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
});
