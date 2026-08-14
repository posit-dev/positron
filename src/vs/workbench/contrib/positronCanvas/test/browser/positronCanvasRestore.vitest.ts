/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { NullLogService } from '../../../../../platform/log/common/log.js';
import { URI } from '../../../../../base/common/uri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { TestEditorInput } from '../../../../test/browser/workbenchTestServices.js';
import { mergeCanvasGroupIntoIde } from '../../browser/positronCanvasRestore.js';

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
