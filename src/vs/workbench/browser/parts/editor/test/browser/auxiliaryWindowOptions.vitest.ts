/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { CommandsRegistry, ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { createLightTestContainer } from '../../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { IEditorGroup } from '../../../../../services/editor/common/editorGroupsService.js';
import { TestEditorInput } from '../../../../../test/browser/workbenchTestServices.js';
import { getAuxiliaryWindowOptionsForEditors, moveAssistantTabToWindow } from '../../positronAuxiliaryWindowOptions.js';

describe('getAuxiliaryWindowOptionsForEditors', () => {
	const ctx = createLightTestContainer().build();

	// TestEditorInput uses its type id as its editor id.
	const editorOfType = (typeId: string) =>
		ctx.disposables.add(new TestEditorInput(URI.file(`/workspace/${typeId}`), typeId));
	const sourceWindow = stubInterface<Window>({ outerWidth: 1400, outerHeight: 900 });

	it('opens Posit Assistant tabs in the dedicated window, sized to the source window', () => {
		expect(getAuxiliaryWindowOptionsForEditors([editorOfType('mainThreadWebview-posit-assistant')], sourceWindow)).toEqual({
			compact: true,
			nativeTitlebar: true,
			bounds: { width: 1400, height: 900 },
		});
	});

	it('keeps a normal window when an Assistant tab moves together with other editors', () => {
		// A compact window has no tabs, so the other editors would be hard to reach.
		expect(getAuxiliaryWindowOptionsForEditors([editorOfType('mainThreadWebview-posit-assistant'), editorOfType('test.R')], sourceWindow)).toBeUndefined();
	});

	it('keeps a normal window for other webviews, including Canvas', () => {
		expect(getAuxiliaryWindowOptionsForEditors([editorOfType('mainThreadWebview-posit-assistant.canvas')], sourceWindow)).toBeUndefined();
		expect(getAuxiliaryWindowOptionsForEditors([editorOfType('mainThreadWebview-markdown.preview')], sourceWindow)).toBeUndefined();
	});
});

describe('moveAssistantTabToWindow', () => {
	const ctx = createLightTestContainer().build();

	const editorOfType = (typeId: string) =>
		ctx.disposables.add(new TestEditorInput(URI.file(`/workspace/${typeId}`), typeId));
	const group = stubInterface<IEditorGroup>({ openEditor: vi.fn(async () => undefined), focus: vi.fn() });
	const commandService = stubInterface<ICommandService>({ executeCommand: vi.fn().mockResolvedValue(true) });
	// Called by its literal id: the name is shared with Posit Assistant.
	const registerAssistantCommand = () => ctx.disposables.add(CommandsRegistry.registerCommand('posit-assistant.moveToWindow', () => true));

	it('hands a single Assistant tab to Posit Assistant, after making it active', async () => {
		registerAssistantCommand();
		const tab = editorOfType('mainThreadWebview-posit-assistant');

		expect(await moveAssistantTabToWindow(commandService, group, [tab])).toBe(true);
		expect(group.openEditor).toHaveBeenCalledWith(tab);
		expect(commandService.executeCommand).toHaveBeenCalledWith('posit-assistant.moveToWindow');
	});

	it('leaves the move to the caller when Posit Assistant is too old to take it', async () => {
		expect(await moveAssistantTabToWindow(commandService, group, [editorOfType('mainThreadWebview-posit-assistant')])).toBe(false);
		expect(commandService.executeCommand).not.toHaveBeenCalled();
	});

	it('leaves the move to the caller for anything but a single Assistant tab', async () => {
		registerAssistantCommand();

		expect(await moveAssistantTabToWindow(commandService, group, [editorOfType('mainThreadWebview-posit-assistant'), editorOfType('test.R')])).toBe(false);
		expect(await moveAssistantTabToWindow(commandService, group, [editorOfType('mainThreadWebview-posit-assistant.window')])).toBe(false);
		expect(commandService.executeCommand).not.toHaveBeenCalled();
	});
});
