/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { GroupModelChangeKind } from '../../../../common/editor.js';
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

describe('AssistantWindowGuard', () => {
	const assistantGroupChanges = new Emitter<IGroupModelChangeEvent>();
	const canvasGroupChanges = new Emitter<IGroupModelChangeEvent>();
	const mainGroup = stubInterface<IEditorGroup>({});

	function windowGroup(panelType: string, changes: Emitter<IGroupModelChangeEvent>, file: EditorInput) {
		const panel = new TestEditorInput(URI.file(`/${panelType}`), panelType);
		return stubInterface<IEditorGroup>({ onDidModelChange: changes.event, count: 2, editors: [panel, file], contains: () => true, moveEditor: vi.fn() });
	}

	const assistantFile = new TestEditorInput(URI.file('/assistant-window/notes.txt'), 'file');
	const canvasFile = new TestEditorInput(URI.file('/canvas-window/notes.txt'), 'file');
	const assistantGroup = windowGroup(WINDOW_PANEL, assistantGroupChanges, assistantFile);
	const canvasGroup = windowGroup(CANVAS_PANEL, canvasGroupChanges, canvasFile);
	const mainPart = stubInterface<IEditorPart>({ activeGroup: mainGroup });
	const auxiliaryPart = stubInterface<IEditorPart>({ windowId: 2 });
	// Both windows are locked compact, like real Assistant and Canvas windows.
	const lockedCompactWindows = stubInterface<IAuxiliaryWindowService>({
		getWindow: () => stubInterface<IAuxiliaryWindow>({ createState: () => ({ lockCompact: true }) }),
	});

	const ctx = createLightTestContainer()
		.stub(IEditorGroupsService, {
			groups: [assistantGroup, canvasGroup],
			mainPart,
			getPart: () => auxiliaryPart,
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

	it('leaves a Canvas window alone', async () => {
		// Canvas windows are locked compact too, but Canvas manages its own window.
		canvasGroupChanges.fire({ kind: GroupModelChangeKind.EDITOR_OPEN, editor: canvasFile });
		await nextTick();

		expect(canvasGroup.moveEditor).not.toHaveBeenCalled();
	});
});
