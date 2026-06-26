/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ModifierKeyEmitter } from '../../../../../../base/browser/dom.js';
import { IAction } from '../../../../../../base/common/actions.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IMenu, IMenuActionOptions, IMenuService, MenuId, MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { PositronActionBarContextProvider } from '../../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
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

describe('EditorActionBarFactory split-button dedup', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// ActionBarActionButton lazily creates the process-global ModifierKeyEmitter
	// singleton on first render; dispose it so the leak tracker stays clean.
	afterEach(() => ModifierKeyEmitter.disposeInstance());

	// A MenuItemAction for a command id/title. No icon, so the factory renders a
	// text label (matching how the Quarto Preview primary is registered).
	const menuItem = (id: string, title: string) =>
		ctx.instantiationService.createInstance(MenuItemAction, { id, title }, undefined, undefined, undefined, undefined);

	// Render the factory output the way production does: inside the action bar
	// context provider, with React services from the RTL renderer.
	const renderActionBar = (actionsByMenu: Map<MenuId, [string, IAction[]][]>) => {
		const menuService = stubInterface<IMenuService>({
			createMenu: (id: MenuId) => stubInterface<IMenu>({
				onDidChange: Event.None,
				getActions: () => (actionsByMenu.get(id) ?? []) as ReturnType<IMenu['getActions']>,
				dispose: () => { },
			}),
		});
		const group = stubInterface<IEditorGroupView>({
			activeEditor: ctx.disposables.add(new TestEditorInput(URI.file('/workspace/report.qmd'), 'test.qmd')),
			activeEditorPane: undefined,
			scopedContextKeyService: ctx.get(IContextKeyService),
			onDidActiveEditorChange: Event.None,
		});
		const factory = ctx.disposables.add(new EditorActionBarFactory(
			group, ctx.get(IContextKeyService), ctx.get(IKeybindingService), menuService,
		));
		return rtl.render(
			<PositronActionBarContextProvider>
				{factory.create()}
			</PositronActionBarContextProvider>
		);
	};

	// Project the Preview action-bar buttons the same way the DevTools diagnostic
	// does in the running app: split buttons are a wrapping DIV with a primary +
	// chevron; plain buttons are a single BUTTON. Filtered to Preview controls so
	// unrelated buttons (e.g. the always-present "Move into new window") can't
	// affect the assertion.
	const previewButtons = (container: HTMLElement) =>
		// eslint-disable-next-line no-restricted-syntax -- structural split-vs-plain shape has no role/testid; mirrors the app DevTools projection
		[...container.querySelectorAll('.action-bar-button')].map(el => ({
			kind: el.tagName === 'DIV' ? 'split' : 'plain',
			// eslint-disable-next-line no-restricted-syntax -- see above
			primary: (el.querySelector('.action-bar-button-action-button') ?? el).getAttribute('aria-label'),
			// eslint-disable-next-line no-restricted-syntax -- see above
			chevron: el.querySelector('.action-bar-button-drop-down-button')?.getAttribute('aria-label') ?? undefined,
		})).filter(b => /preview/i.test(b.primary ?? '') || /preview/i.test(b.chevron ?? ''));

	// The Quarto extension contributes `quarto.preview` to editor/title/run
	// (MenuId.EditorTitleRun), where the factory renders it as a plain button.
	const extensionPreview = () => new SubmenuItemAction(
		{ submenu: MenuId.EditorTitleRun, title: 'Run or Debug...', isSplitButton: { togglePrimaryAction: true } },
		undefined,
		[menuItem('quarto.preview', 'Preview')],
	);

	// Positron core contributes a `quarto.preview` + `quarto.previewFormat` split
	// button to EditorActionsLeft.
	const corePreviewSplit = () => new SubmenuItemAction(
		{ submenu: MenuId.PositronQuartoPreviewMenu, title: 'Preview', isSplitButton: true },
		undefined,
		[menuItem('quarto.preview', 'Preview'), menuItem('quarto.previewFormat', 'Preview Format...')],
	);

	it('renders the extension preview alone as a plain button', () => {
		// Baseline (e.g. a markdown file, where core does not contribute): the
		// extension's editor/title/run Preview renders as a single plain button.
		// This is what the dedup below collapses away on a .qmd.
		const { container } = renderActionBar(new Map<MenuId, [string, IAction[]][]>([
			[MenuId.EditorTitle, [['navigation', [extensionPreview()]]]],
		]));

		expect(previewButtons(container)).toMatchInlineSnapshot(`
			[
			  {
			    "chevron": undefined,
			    "kind": "plain",
			    "primary": "Preview",
			  },
			]
		`);
	});

	it('collapses the extension and core quarto.preview into a single split button', () => {
		// On a .qmd both contribute `quarto.preview`. The factory dedups by command
		// id, so the result is one split button (the core one, with the format
		// dropdown), not a duplicate plain "Preview" and not a standalone "Preview
		// Format..." button. This is the behavior Positron relies on instead of a
		// Quarto extension change to hide its own button.
		const { container } = renderActionBar(new Map<MenuId, [string, IAction[]][]>([
			[MenuId.EditorTitle, [['navigation', [extensionPreview()]]]],
			[MenuId.EditorActionsLeft, [['navigation', [corePreviewSplit()]]]],
		]));

		expect(previewButtons(container)).toMatchInlineSnapshot(`
			[
			  {
			    "chevron": "Preview",
			    "kind": "split",
			    "primary": "Preview",
			  },
			]
		`);
	});
});
