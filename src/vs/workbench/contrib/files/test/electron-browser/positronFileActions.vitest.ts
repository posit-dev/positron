/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IListService } from '../../../../../platform/list/browser/listService.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IExplorerService } from '../../browser/files.js';
import { ExplorerItem } from '../../common/explorerModel.js';
import { OPEN_WITH_DEFAULT_APPLICATION_COMMAND_ID } from '../../electron-browser/positronFileActions.contribution.js';

const { mockGetMultiSelectedResources } = vi.hoisted(() => ({ mockGetMultiSelectedResources: vi.fn() }));
vi.mock('../../browser/files.js', async importOriginal => ({
	...await importOriginal<typeof import('../../browser/files.js')>(),
	getMultiSelectedResources: mockGetMultiSelectedResources,
}));

describe('Open with Default Application', () => {
	const open = vi.fn(async () => true);
	const folder = URI.file('/project/data');
	const ctx = createLightTestContainer()
		.stub(IOpenerService, { open })
		.stub(IExplorerService, {
			findClosest: (resource: URI) => stubInterface<ExplorerItem>({ isDirectory: resource.path === folder.path })
		})
		.stub(IListService, {})
		.stub(IEditorService, {})
		.stub(IEditorGroupsService, {})
		.build();

	async function run(selection: URI[]) {
		mockGetMultiSelectedResources.mockReturnValue(selection);
		const command = CommandsRegistry.getCommand(OPEN_WITH_DEFAULT_APPLICATION_COMMAND_ID)!;
		await ctx.instantiationService.invokeFunction(command.handler, selection[0]);
	}

	it('opens every selected file', async () => {
		const first = URI.file('/project/report.pdf');
		const second = URI.file('/project/sheet.xlsx');

		await run([first, second]);

		expect(open.mock.calls).toEqual([
			[first.toString(), { openExternal: true }],
			[second.toString(), { openExternal: true }],
		]);
	});

	it('skips folders and non-local resources in a mixed selection', async () => {
		const file = URI.file('/project/report.pdf');

		await run([file, folder, URI.parse('untitled:Untitled-1')]);

		expect(open.mock.calls).toEqual([[file.toString(), { openExternal: true }]]);
	});

	it('passes an encoded string that preserves special characters', async () => {
		const file = URI.file('/project/résumé #1? 100%.pdf');

		await run([file]);

		expect(open).toHaveBeenCalledExactlyOnceWith(file.toString(), { openExternal: true });
		expect(URI.parse(file.toString()).path).toBe(file.path);
	});

	it('is offered only for local files in a trusted workspace', () => {
		const item = MenuRegistry.getMenuItems(MenuId.ExplorerContext)
			.filter(isIMenuItem)
			.find(item => item.command.id === OPEN_WITH_DEFAULT_APPLICATION_COMMAND_ID)!;
		const isShown = (values: Record<string, unknown>) =>
			item.when!.evaluate({ getValue: <T>(key: string) => values[key] as T });
		const trustedFile = { resourceScheme: 'file', resourceExtname: '.pdf', explorerResourceIsFolder: false, isWorkspaceTrusted: true };

		expect({
			trustedFile: isShown(trustedFile),
			untrusted: isShown({ ...trustedFile, isWorkspaceTrusted: false }),
			folder: isShown({ ...trustedFile, explorerResourceIsFolder: true }),
			remote: isShown({ ...trustedFile, resourceScheme: 'vscode-remote' }),
			html: isShown({ ...trustedFile, resourceExtname: '.html' }),
			upperCaseHtm: isShown({ ...trustedFile, resourceExtname: '.HTM' }),
			mhtml: isShown({ ...trustedFile, resourceExtname: '.mhtml' }),
		}).toEqual({ trustedFile: true, untrusted: false, folder: false, remote: false, html: false, upperCaseHtm: false, mhtml: false });
	});
});
