/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IMenu, IMenuActionOptions, IMenuService } from '../../../../../../platform/actions/common/actions.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { DiffEditorInput } from '../../../../../common/editor/diffEditorInput.js';
import { TestEditorInput } from '../../../../../test/browser/workbenchTestServices.js';
import { IEditorGroupView } from '../../editor.js';
import { EditorActionBarFactory } from '../../editorActionBarFactory.js';

describe('EditorActionBarFactory', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	it('forwards the modified-side URI as the menu action argument for diff editors', () => {
		// The save-conflict editor is a DiffEditorInput, whose `resource` getter returns
		// undefined when the two sides differ. The factory must resolve the primary
		// (modified) side's URI instead, otherwise EditorTitle commands like
		// acceptLocalChanges receive undefined and silently no-op. See discussion #14397.
		const original = ctx.disposables.add(new TestEditorInput(URI.file('/conflict-resolution/file.ts'), 'test.original'));
		const modified = ctx.disposables.add(new TestEditorInput(URI.file('/workspace/file.ts'), 'test.modified'));
		const diffInput = ctx.disposables.add(
			ctx.instantiationService.createInstance(DiffEditorInput, undefined, undefined, original, modified, undefined)
		);

		// A diff editor exposes no single resource: this is the trap that broke the buttons.
		expect(diffInput.resource).toBeUndefined();

		// Capture the options the factory passes when it reads the EditorTitle menu actions.
		const capturedArgs: Array<unknown> = [];
		const menu = stubInterface<IMenu>({
			onDidChange: Event.None,
			getActions: (options?: IMenuActionOptions) => {
				capturedArgs.push(options?.arg);
				return [];
			},
			dispose: () => { },
		});
		const menuService = stubInterface<IMenuService>({ createMenu: () => menu });

		const group = stubInterface<IEditorGroupView>({
			activeEditor: diffInput,
			activeEditorPane: undefined,
			scopedContextKeyService: ctx.get(IContextKeyService),
			onDidActiveEditorChange: Event.None,
		});

		const factory = ctx.disposables.add(new EditorActionBarFactory(
			group,
			ctx.get(IContextKeyService),
			ctx.get(IKeybindingService),
			menuService,
		));
		factory.create();

		// Every menu read forwards the modified-side URI, never undefined.
		expect(capturedArgs.length).toBeGreaterThan(0);
		expect(capturedArgs.every(arg => arg === modified.resource)).toBe(true);
	});
});
