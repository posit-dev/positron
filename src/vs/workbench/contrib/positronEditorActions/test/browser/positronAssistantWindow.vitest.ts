/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { GroupIdentifier, GroupModelChangeKind } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IGroupModelChangeEvent } from '../../../../common/editor/editorGroupModel.js';
import { IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IAuxiliaryEditorPart, IEditorGroup, IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { TestEditorInput } from '../../../../test/browser/workbenchTestServices.js';
import { AssistantWindowGuard } from '../../browser/positronAssistantWindow.js';

// Webview editors report `mainThreadWebview-<view type>` as their editor id; TestEditorInput
// uses its type id as its editor id.
const WINDOW_PANEL = 'mainThreadWebview-posit-assistant.window';
const ASSISTANT_TAB = 'mainThreadWebview-posit-assistant';
const CANVAS_PANEL = 'mainThreadWebview-posit-assistant.canvas';

describe('positron.assistantWindow.enter', () => {

	// Called at describe level: the container has to be built there.
	function setup(activeEditorType: string) {
		const editor = new TestEditorInput(URI.file('/panel'), activeEditorType);
		const newWindowGroup = stubInterface<IEditorGroup>({ lock: vi.fn(), focus: vi.fn() });
		const newWindow = stubInterface<IAuxiliaryEditorPart>({ activeGroup: newWindowGroup });
		const sourceGroup = stubInterface<IEditorGroup>({ activeEditor: editor, editors: [editor], isActive: () => true, isSticky: () => false, moveEditors: vi.fn(() => true) });
		const mainPart = stubInterface<IEditorPart>({});
		const editorGroupsService = stubInterface<IEditorGroupsService>({
			activeGroup: sourceGroup,
			mainPart,
			getPart: () => mainPart,
			createAuxiliaryEditorPart: vi.fn(async () => newWindow),
		});
		const container = createLightTestContainer()
			.stub(IEditorGroupsService, editorGroupsService)
			// The source group is in the main window, so no auxiliary window is looked up.
			.stub(IAuxiliaryWindowService, {})
			.build();
		// Called by its literal id: the name is shared with Posit Assistant.
		const enter = () => container.instantiationService.invokeFunction(accessor => CommandsRegistry.getCommand('positron.assistantWindow.enter')!.handler(accessor));
		return { enter, editor, editorGroupsService, sourceGroup, newWindowGroup };
	}

	describe('with a window panel active', () => {
		const { enter, editor, editorGroupsService, sourceGroup, newWindowGroup } = setup(WINDOW_PANEL);

		it('moves it into a locked-compact window and locks its group', async () => {
			expect(await enter()).toBe(true);
			expect(editorGroupsService.createAuxiliaryEditorPart).toHaveBeenCalledWith(expect.objectContaining({ compact: true, nativeTitlebar: true, lockCompact: true }));
			expect(sourceGroup.moveEditors).toHaveBeenCalledWith([expect.objectContaining({ editor })], newWindowGroup);
			expect(newWindowGroup.lock).toHaveBeenCalledWith(true);
		});
	});

	describe('with an ordinary Assistant tab active', () => {
		const { enter, editorGroupsService } = setup(ASSISTANT_TAB);

		it('refuses it, so its window is never locked', async () => {
			// An older Assistant that doesn't know window panels must keep today's behaviour.
			expect(await enter()).toBe(false);
			expect(editorGroupsService.createAuxiliaryEditorPart).not.toHaveBeenCalled();
		});
	});
});

describe('positron.assistantWindow.open', () => {
	// The panel Assistant creates in the opened window, once it's there.
	const windowEditors: EditorInput[] = [];
	const panel = new TestEditorInput(URI.file('/panel'), WINDOW_PANEL);
	const mainGroup = stubInterface<IEditorGroup>({});
	const windowGroup = stubInterface<IEditorGroup>({
		lock: vi.fn(),
		focus: vi.fn(),
		editors: windowEditors,
		get activeEditor() { return windowEditors[0]; },
	});
	const window = stubInterface<IAuxiliaryEditorPart>({ windowId: 2, activeGroup: windowGroup, groups: [windowGroup] });
	const mainPart = stubInterface<IEditorPart>({});
	const editorGroupsService = stubInterface<IEditorGroupsService>({
		mainPart,
		// Assistant created the panel in the new window, which is now active.
		activeGroup: windowGroup,
		getPart: () => window,
		getGroups: () => [mainGroup, windowGroup],
		createAuxiliaryEditorPart: vi.fn(async () => window),
	});
	const container = createLightTestContainer()
		.stub(IEditorGroupsService, editorGroupsService)
		.stub(IAuxiliaryWindowService, stubInterface<IAuxiliaryWindowService>({
			getWindow: () => stubInterface<IAuxiliaryWindow>({ createState: () => ({ lockCompact: true }) }),
		}))
		.build();
	// Called by their literal ids: the names are shared with Posit Assistant.
	const run = (id: string) => container.instantiationService.invokeFunction(accessor => CommandsRegistry.getCommand(id)!.handler(accessor));

	it('opens an empty locked window for the panel, which enter then keeps', async () => {
		// The window's group is the second column, as an extension's ViewColumn.Two.
		expect(await run('positron.assistantWindow.open')).toBe(2);
		expect(editorGroupsService.createAuxiliaryEditorPart).toHaveBeenCalledWith(expect.objectContaining({ compact: true, lockCompact: true }));
		expect(windowGroup.lock).toHaveBeenCalledWith(true);

		windowEditors.push(panel);
		expect(await run('positron.assistantWindow.enter')).toBe(true);
		// No second window: the panel is already in the opened one.
		expect(editorGroupsService.createAuxiliaryEditorPart).toHaveBeenCalledTimes(1);
	});
});

describe('AssistantWindowGuard', () => {
	const assistantGroupChanges = new Emitter<IGroupModelChangeEvent>();
	const sideGroupChanges = new Emitter<IGroupModelChangeEvent>();
	const canvasGroupChanges = new Emitter<IGroupModelChangeEvent>();
	const mainGroup = stubInterface<IEditorGroup>({});

	function group(changes: Emitter<IGroupModelChangeEvent>, editors: EditorInput[]) {
		return stubInterface<IEditorGroup>({ onDidModelChange: changes.event, count: editors.length, editors, contains: () => true, moveEditor: vi.fn() });
	}
	const panel = (type: string) => new TestEditorInput(URI.file(`/${type}`), type);

	const assistantFile = new TestEditorInput(URI.file('/assistant-window/notes.txt'), 'file');
	const sideFile = new TestEditorInput(URI.file('/assistant-window/side.txt'), 'file');
	const canvasFile = new TestEditorInput(URI.file('/canvas-window/notes.txt'), 'file');
	const assistantGroup = group(assistantGroupChanges, [panel(WINDOW_PANEL), assistantFile]);
	// A group added beside the locked panel group by an "open to the side".
	const sideGroup = group(sideGroupChanges, [sideFile]);
	const canvasGroup = group(canvasGroupChanges, [panel(CANVAS_PANEL), canvasFile]);
	const mainPart = stubInterface<IEditorPart>({ activeGroup: mainGroup });
	const assistantPart = stubInterface<IEditorPart>({ windowId: 2, groups: [assistantGroup, sideGroup] });
	const canvasPart = stubInterface<IEditorPart>({ windowId: 3, groups: [canvasGroup] });
	// Both windows are locked compact, like real Assistant and Canvas windows.
	const lockedCompactWindows = stubInterface<IAuxiliaryWindowService>({
		getWindow: () => stubInterface<IAuxiliaryWindow>({ createState: () => ({ lockCompact: true }) }),
	});

	const ctx = createLightTestContainer()
		.stub(IEditorGroupsService, {
			groups: [assistantGroup, sideGroup, canvasGroup],
			mainPart,
			getPart: (g: IEditorGroup | GroupIdentifier) => g === canvasGroup ? canvasPart : assistantPart,
			onDidAddGroup: Event.None,
			onDidRemoveGroup: Event.None,
		})
		.stub(IAuxiliaryWindowService, lockedCompactWindows)
		.build();

	beforeEach(() => {
		ctx.disposables.add(ctx.instantiationService.createInstance(AssistantWindowGuard));
	});

	// The guard moves the editor on the next tick, once the open has finished.
	const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

	it('moves an editor that opens in an Assistant window to the main window', async () => {
		// Without this it sits hidden behind the chat: the window has no tabs.
		assistantGroupChanges.fire({ kind: GroupModelChangeKind.EDITOR_OPEN, editor: assistantFile });
		await nextTick();

		expect(assistantGroup.moveEditor).toHaveBeenCalledWith(assistantFile, mainGroup);
	});

	it('moves an editor opened to the side, in a new group of the Assistant window', async () => {
		sideGroupChanges.fire({ kind: GroupModelChangeKind.EDITOR_OPEN, editor: sideFile });
		await nextTick();

		expect(sideGroup.moveEditor).toHaveBeenCalledWith(sideFile, mainGroup);
	});

	it('leaves a Canvas window alone', async () => {
		// Canvas windows are locked compact too, but Canvas manages its own window.
		canvasGroupChanges.fire({ kind: GroupModelChangeKind.EDITOR_OPEN, editor: canvasFile });
		await nextTick();

		expect(canvasGroup.moveEditor).not.toHaveBeenCalled();
	});
});
