/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../nls.js';
import { Categories } from '../../action/common/actionCommonCategories.js';
import { Action2 } from './actions.js';
import { ServicesAccessor } from '../../instantiation/common/instantiation.js';
import { IEditorService } from '../../../workbench/services/editor/common/editorService.js';
import { URI } from '../../../base/common/uri.js';
// import { IResourceMergeEditorInput } from '../../../workbench/common/editor.js';
// import { IFileService } from '../../files/common/files.js';

export class DemoAction extends Action2 {

	constructor() {
		super({
			id: 'action.demo',
			title: localize2('title', "Sam's Demo Action"),
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// accessor.get(IMenuService).resetHiddenStates();
		// accessor.get(ILogService).info('did RESET all menu hidden states');
		const editorService = accessor.get(IEditorService);
		// const resolverService = accessor.get(IEditorResolverService);

		// const originalPane = await editorService.openEditor({
		// 	resource: URI.parse('file:///Users/sclark/Library/Application Support/Code/User/settings.json')
		// });
		// const modifiedPane = await editorService.openEditor({
		// 	resource: URI.parse('file:///Users/sclark/.vscode-oss-dev/User/settings.json')
		// });
		// // const original: ITextResourceEditorInput = {
		// // 	resource: URI.parse('file:///Users/samuelkarp/Downloads/old.txt')
		// // };
		// // const modified: ITextResourceEditorInput = {
		// // 	resource: URI.parse('file:///Users/samuelkarp/Downloads/new.txt')
		// // };
		// const diffResource = {
		// 	original: originalPane?.input!,
		// 	modified: modifiedPane?.input!
		// };

		// new MergeEditorInput(URI.parse("file:///"), { uri: URI.parse('file:///Users/sclark/Library/Application Support/Code/User/settings.json') }, { uri: URI.parse('file:///Users/sclark/.vscode-oss-dev/User/settings.json') }, URI.parse('file:///Users/sclark/Library/Application Support/Code/User/settings.json'));
		// editorService.openEditor({ resource: URI.parse('untitled://Untitled-1') }).then(resource => resource?.input.);

		// await fileService.createFile(URI.parse('file:///Users/sclark/Projects/positron-playground/merged-settings.json'));

		// const fileService = accessor.get(IFileService);
		const positronUri = URI.parse('file:///Users/sclark/.vscode-oss-dev/User/settings.json');
		const codeUri = URI.parse('file:///Users/sclark/Library/Application Support/Code/User/settings.json');
		// const mergedUri = URI.parse('file:///Users/sclark/Projects/positron-playground/merged-settings.json');

		// await fileService.copy(positronUri, mergedUri, true);

		const originalPane = await editorService.openEditor({
			resource: positronUri
		});
		const modifiedPane = await editorService.openEditor({
			resource: codeUri,
			options: {}
		});
		const diffResource = {
			original: originalPane?.input!,
			modified: modifiedPane?.input!
		};

		await editorService.openEditor(diffResource);

		// const mergeInput: IResourceMergeEditorInput = {
		// 	base: { resource: positronUri },
		// 	input1: { resource: positronUri, label: 'Existing VSCode Settings' },
		// 	input2: { resource: codeUri, label: 'Existing Positron Settings' },
		// 	result: { resource: mergedUri, label: 'Merged Positron Settings' },

		// };
		// const resolvedEditor = await resolverService.resolveEditor(mergeInput, undefined);
		// if (!isEditorInputWithOptionsAndGroup(resolvedEditor)) {
		// 	return;
		// }
		// await editorService.openEditor(mergeInput);
	}
}
