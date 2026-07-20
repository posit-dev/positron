/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { URI } from '../../../../../base/common/uri.js';
import { CellContextKeys } from '../../common/cellContextKeys.js';
import { PositronNotebookActionId } from '../../common/positronNotebookCommon.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { SelectionState } from '../../browser/selectionMachine.js';

// Importing the contribution barrel runs its side-effect imports, which register
// the notebook cell output image actions (Copy / Save / Open Image in New Tab).
// It also exports the shared `resolveImageOutputTarget` helper exercised below.
import { resolveImageOutputTarget } from '../../browser/positronNotebook.contribution.js';

/** Collect the menu items contributed for a given action id in a given menu. */
function menuItemsFor(menuId: MenuId, actionId: string) {
	return MenuRegistry.getMenuItems(menuId)
		.filter(isIMenuItem)
		.filter(item => item.command.id === actionId);
}

describe('Positron notebook image output actions registration', () => {
	for (const { name, id } of [
		{ name: 'Copy Image', id: PositronNotebookActionId.CopyOutputImage },
		{ name: 'Save Image', id: PositronNotebookActionId.SaveOutputImage },
		{ name: 'Open Image in New Tab', id: PositronNotebookActionId.OpenOutputImageInNewTab },
	]) {
		describe(name, () => {
			it('is contributed to the output action bar with an image+expanded when clause', () => {
				const items = menuItemsFor(MenuId.PositronNotebookCellOutputActionBar, id);
				expect(items).toHaveLength(1);
				const when = items[0].when?.serialize() ?? '';
				expect(when).toContain(CellContextKeys.imageOutputCount.key);
				expect(when).toContain(CellContextKeys.outputIsCollapsed.key);
			});

			it('is contributed to the output context menu when an image is targeted', () => {
				const items = menuItemsFor(MenuId.PositronNotebookCellOutputActionContext, id);
				expect(items).toHaveLength(1);
				const when = items[0].when?.serialize() ?? '';
				expect(when).toContain(CellContextKeys.outputImageTargeted.key);
				expect(when).toContain(CellContextKeys.outputIsCollapsed.key);
			});
		});
	}
});

describe('resolveImageOutputTarget', () => {
	/** Build a minimal notebook instance whose active cell exposes the given image outputs. */
	function makeNotebook(options: {
		isCodeCell: boolean;
		cellIndex?: number;
		imageDataUrls?: string[];
	}): IPositronNotebookInstance {
		const outputs = (options.imageDataUrls ?? []).map(dataUrl => ({
			parsed: { type: 'image' as const, dataUrl },
		}));
		const cell = {
			index: options.cellIndex ?? 0,
			isCodeCell: () => options.isCodeCell,
			outputs: { get: () => outputs },
		};
		return {
			selectionStateMachine: {
				state: {
					get: () => ({ type: SelectionState.SingleSelection, active: cell }),
				},
			},
		} as unknown as IPositronNotebookInstance;
	}

	it('prefers the forwarded menu-arg image data URL', () => {
		const notebook = makeNotebook({
			isCodeCell: true,
			cellIndex: 2,
			imageDataUrls: ['data:image/png;base64,fallback'],
		});
		const args = [{ imageDataUrl: 'data:image/png;base64,fromMenu' }];

		expect(resolveImageOutputTarget(notebook, args)).toEqual({
			dataUrl: 'data:image/png;base64,fromMenu',
			cellIndex: 2,
		});
	});

	it('falls back to the first image output of the active cell', () => {
		const notebook = makeNotebook({
			isCodeCell: true,
			cellIndex: 4,
			imageDataUrls: ['data:image/png;base64,first', 'data:image/png;base64,second'],
		});

		expect(resolveImageOutputTarget(notebook, [])).toEqual({
			dataUrl: 'data:image/png;base64,first',
			cellIndex: 4,
		});
	});

	it('returns undefined when the active cell is not a code cell', () => {
		const notebook = makeNotebook({
			isCodeCell: false,
			imageDataUrls: ['data:image/png;base64,abc'],
		});

		expect(resolveImageOutputTarget(notebook, [])).toBeUndefined();
	});

	it('returns undefined when a code cell has no image output and no menu arg', () => {
		const notebook = makeNotebook({ isCodeCell: true });

		expect(resolveImageOutputTarget(notebook, [])).toBeUndefined();
	});

	it('ignores a non-CopyImageMenuArg argument', () => {
		const notebook = makeNotebook({
			isCodeCell: true,
			cellIndex: 1,
			imageDataUrls: ['data:image/png;base64,first'],
		});
		expect(resolveImageOutputTarget(notebook, [URI.file('/tmp/x.png')])).toEqual({
			dataUrl: 'data:image/png;base64,first',
			cellIndex: 1,
		});
	});
});
