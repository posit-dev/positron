/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { URI } from '../../../../../base/common/uri.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IAuxiliaryWindow, IAuxiliaryWindowOpenEvent } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { TestEditorInput } from '../../../../test/browser/workbenchTestServices.js';
import { holdRestoredAuxiliaryWindows, mergeCanvasGroupIntoIde } from '../../browser/positronCanvasRestore.js';

describe('holdRestoredAuxiliaryWindows', () => {
	const disposables = ensureNoLeakedDisposables();

	function openEvent(vscodeWindowId: number): IAuxiliaryWindowOpenEvent {
		return { window: stubInterface<IAuxiliaryWindow>({ window: stubInterface<IAuxiliaryWindow['window']>({ vscodeWindowId }) }), disposables: disposables.add(new DisposableStore()) };
	}

	it('holds the windows restore opens and none that open after restore is done', async () => {
		const opened = disposables.add(new Emitter<IAuxiliaryWindowOpenEvent>());
		const restored = new DeferredPromise<void>();
		const held: number[] = [];
		disposables.add(holdRestoredAuxiliaryWindows(
			{ onDidOpenAuxiliaryWindow: opened.event },
			{ whenRestored: restored.p },
			async windowId => { held.push(windowId); },
			new NullLogService()
		));

		// Restore brings two windows back: the Canvas window and a floating editor.
		opened.fire(openEvent(1000));
		opened.fire(openEvent(2000));
		await restored.complete();
		// Canvas entry opening a window of its own must stay visible.
		opened.fire(openEvent(3000));

		expect(held).toEqual([1000, 2000]);
	});
});

describe('mergeCanvasGroupIntoIde', () => {
	const disposables = ensureNoLeakedDisposables();
	const logService = new NullLogService();

	function createGroup() {
		const editor = disposables.add(new TestEditorInput(URI.file('/canvas'), 'canvas'));
		return stubInterface<IEditorGroup>({
			editors: [editor],
			getIndexOfEditor: vi.fn().mockReturnValue(0),
			isActive: vi.fn().mockReturnValue(true),
			isSticky: vi.fn().mockReturnValue(false),
			lock: vi.fn(),
			moveEditors: vi.fn().mockReturnValue(true),
		});
	}

	it('unlocks and merges the group', () => {
		const group = createGroup();
		const target = stubInterface<IEditorGroup>();
		const editorGroupsService = stubInterface<IEditorGroupsService>({ mergeGroup: vi.fn().mockReturnValue(true) });

		mergeCanvasGroupIntoIde(group, target, editorGroupsService, logService);

		expect(group.lock).toHaveBeenCalledWith(false);
		expect(editorGroupsService.mergeGroup).toHaveBeenCalledWith(group, target);
		expect(group.moveEditors).not.toHaveBeenCalled();
	});

	it('moves the editors when the group cannot be merged', () => {
		const group = createGroup();
		const target = stubInterface<IEditorGroup>();
		const editorGroupsService = stubInterface<IEditorGroupsService>({ mergeGroup: vi.fn().mockReturnValue(false) });

		mergeCanvasGroupIntoIde(group, target, editorGroupsService, logService);

		expect(group.moveEditors).toHaveBeenCalledWith([
			{
				editor: group.editors[0],
				options: { inactive: false, pinned: true, preserveFocus: undefined, sticky: false },
			},
		], target);
	});
});
