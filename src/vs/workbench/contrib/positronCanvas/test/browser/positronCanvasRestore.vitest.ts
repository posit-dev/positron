/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { NullLogService } from '../../../../../platform/log/common/log.js';
import { URI } from '../../../../../base/common/uri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IAuxiliaryEditorPart, IEditorGroup, IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { TestEditorInput } from '../../../../test/browser/workbenchTestServices.js';
import { mergeCanvasGroupIntoIde, sweepRestoredCanvasWindows } from '../../browser/positronCanvasRestore.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';

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

describe('sweepRestoredCanvasWindows', () => {
	const logService = new NullLogService();

	/** A restored auxiliary part whose window carries (or lacks) the Canvas trait. */
	function createPart(editors: unknown[], compact: boolean) {
		const group = stubInterface<IEditorGroup>({ editors: editors as IEditorGroup['editors'] });
		const part = stubInterface<IAuxiliaryEditorPart>({ windowId: compact ? 1000 : 2000, getGroups: () => [group], close: vi.fn().mockReturnValue(true) });
		return part;
	}

	function sweep(parts: IEditorPart[]) {
		const mainPart = stubInterface<IEditorPart>({ windowId: 1 });
		return sweepRestoredCanvasWindows({
			auxiliaryWindowService: stubInterface<IAuxiliaryWindowService>({
				getWindow: (windowId: number) => stubInterface<IAuxiliaryWindow>({ createState: () => windowId === 1000 ? { lockCompact: true } : {} })
			}),
			editorGroupsService: stubInterface<IEditorGroupsService>({ mainPart, parts: [mainPart, ...parts], whenRestored: Promise.resolve() }),
			layoutService: stubInterface<IWorkbenchLayoutService>({ setPartHidden: vi.fn() }),
			logService,
		});
	}

	it('closes an empty compact window and leaves an empty plain one alone', async () => {
		const compact = createPart([], true);
		const plain = createPart([], false);

		await sweep([compact, plain]);

		expect({ compactClosed: vi.mocked(compact.close).mock.calls.length, plainClosed: vi.mocked(plain.close).mock.calls.length }).toEqual({ compactClosed: 1, plainClosed: 0 });
	});
});
