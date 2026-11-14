/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IResourceEditorInputIdentifier } from '../../../../../platform/editor/common/editor.js';
import { IEditorIdentifier } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { PositronDataExplorerUri } from '../../../../services/positronDataExplorer/common/positronDataExplorerUri.js';
import { duckDBClientId } from '../../../../services/positronDataExplorer/common/positronDataExplorerDuckDBBackend.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { canOpenWithDuckDB, moveOpenDataExplorerEditorToGroup } from '../../browser/positronDataExplorerEditorResolution.js';

describe('moveOpenDataExplorerEditorToGroup', () => {
	const RESOURCE = PositronDataExplorerUri.generate(duckDBClientId(URI.file('/tmp/bikes.csv')));

	/**
	 * Builds editor groups with the given open editors and resolves the resource into the target
	 * group. Returns which open editor came back (by index) and the moves made.
	 */
	function resolve(openIn: number[], targetGroupId: number) {
		const editors = openIn.map(() => stubInterface<EditorInput>());
		const moves: Array<{ editor: number; from: number; to: number }> = [];

		const groups = new Map<number, IEditorGroup>();
		const getGroup = (id: number) => {
			let group = groups.get(id);
			if (!group) {
				group = stubInterface<IEditorGroup>({
					id,
					moveEditor: (editor: EditorInput, target: IEditorGroup) => {
						moves.push({ editor: editors.indexOf(editor), from: id, to: target.id });
						return true;
					},
				});
				groups.set(id, group);
			}
			return group;
		};

		const openEditors: IEditorIdentifier[] = openIn.map((groupId, index) => ({ groupId, editor: editors[index] }));
		// findEditors is overloaded; this only ever looks up by resource.
		const findEditors: IEditorService['findEditors'] = (resource: URI | IResourceEditorInputIdentifier) =>
			URI.isUri(resource) && resource.toString() === RESOURCE.toString() ? openEditors : [];
		const editorService = stubInterface<IEditorService>({ findEditors });
		const editorGroupsService = stubInterface<IEditorGroupsService>({ getGroup });

		const result = moveOpenDataExplorerEditorToGroup(RESOURCE, getGroup(targetGroupId), editorService, editorGroupsService);
		return { returned: result ? editors.indexOf(result) : undefined, moves };
	}

	it('returns undefined when no editor is open for the resource', () => {
		expect(resolve([], 1)).toEqual({ returned: undefined, moves: [] });
	});

	it('moves an editor open in another group into the target group', () => {
		expect(resolve([2], 1)).toEqual({ returned: 0, moves: [{ editor: 0, from: 2, to: 1 }] });
	});

	it('reuses the editor in the target group without moving one from another group', () => {
		// The Data Explorer is split across groups 2 and 1; opening it in group 1 keeps the split.
		expect(resolve([2, 1], 1)).toEqual({ returned: 1, moves: [] });
	});
});

describe('canOpenWithDuckDB', () => {
	const canOpen = (path: string, readerExtensions: string[] = []) => canOpenWithDuckDB(URI.file(path), readerExtensions);

	it('opens built-in formats in any case, including gzipped ones', () => {
		expect(canOpen('/tmp/DATA.CSV')).toBe(true);
		expect(canOpen('/tmp/data.tsv.gz')).toBe(true);
		expect(canOpen('/tmp/data.txt.gz')).toBe(false);
	});

	it('opens extensions from dataExplorer.fileReaders in any case', () => {
		expect(canOpen('/tmp/ADSL.XPT', ['xpt'])).toBe(true);
		expect(canOpen('/tmp/adsl.xpt')).toBe(false);
	});

	it('does not unwrap gzipped reader formats', () => {
		expect(canOpen('/tmp/adsl.xpt.gz', ['xpt'])).toBe(false);
	});
});
