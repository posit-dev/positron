/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ISCMResource, ISCMResourceGroup } from '../../../scm/common/scm.js';
import { buildCommitMessageContext } from '../../browser/commitMessageDiff.js';

const ROOT_URI = URI.file('/repo');

/** A file service that returns fixed content for any read. */
function fileServiceReturning(content: string): IFileService {
	return stubInterface<IFileService>({
		readFile: async () => stubInterface<IFileContent>({ value: VSBuffer.fromString(content) }),
	});
}

/** Build a resource group with the given id and resources. */
function makeGroup(id: string, resources: ISCMResource[]): ISCMResourceGroup {
	return stubInterface<ISCMResourceGroup>({ id, label: id, resources });
}

/** Build an untracked (added) resource at the given path. */
function makeAddedResource(path: string): ISCMResource {
	return stubInterface<ISCMResource>({
		sourceUri: URI.file(`/repo/${path}`),
		multiDiffEditorOriginalUri: undefined,
		contextValue: 'untracked',
		decorations: {},
	});
}

describe('buildCommitMessageContext', () => {
	it('returns an empty string when there are no changes', async () => {
		const result = await buildCommitMessageContext(fileServiceReturning(''), ROOT_URI, []);
		expect(result).toBe('');
	});

	it('summarizes a single added file as a unified diff', async () => {
		const groups = [makeGroup('index', [makeAddedResource('added.ts')])];
		const result = await buildCommitMessageContext(fileServiceReturning('hello\n'), ROOT_URI, groups);
		expect(result).toMatchInlineSnapshot(`
			"--- /dev/null
			+++ b/added.ts
			@@ -0,0 +1,1 @@
			+hello"
		`);
	});

	it('prefers the staged group when it has changes', async () => {
		const groups = [
			makeGroup('index', [makeAddedResource('staged.ts')]),
			makeGroup('workingTree', [makeAddedResource('unstaged.ts')]),
		];
		const result = await buildCommitMessageContext(fileServiceReturning('x\n'), ROOT_URI, groups);
		expect(result).toContain('b/staged.ts');
		expect(result).not.toContain('b/unstaged.ts');
	});

	it('includes all groups when nothing is staged', async () => {
		const groups = [
			makeGroup('index', []),
			makeGroup('workingTree', [makeAddedResource('unstaged.ts')]),
		];
		const result = await buildCommitMessageContext(fileServiceReturning('x\n'), ROOT_URI, groups);
		expect(result).toContain('b/unstaged.ts');
	});
});
