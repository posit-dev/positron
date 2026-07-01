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

/** A file service that returns content keyed by the URI being read. */
function fileServiceForUris(contentByUri: Map<string, string>): IFileService {
	return stubInterface<IFileService>({
		readFile: async (uri: URI) => stubInterface<IFileContent>({
			value: VSBuffer.fromString(contentByUri.get(uri.toString()) ?? ''),
		}),
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
		multiDiffEditorModifiedUri: undefined,
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

	it('diffs the staged blob, not the working tree, for a partially staged file', async () => {
		const workingTreeUri = URI.file('/repo/file.ts');
		const stagedUri = workingTreeUri.with({ scheme: 'git', query: '' });
		const headUri = workingTreeUri.with({ scheme: 'git', query: 'HEAD' });
		const resource = stubInterface<ISCMResource>({
			sourceUri: workingTreeUri,
			multiDiffEditorOriginalUri: headUri,
			multiDiffEditorModifiedUri: stagedUri,
			contextValue: 'index-modified',
			decorations: {},
		});
		const content = new Map([
			[headUri.toString(), 'original\n'],
			[stagedUri.toString(), 'staged\n'],
			[workingTreeUri.toString(), 'staged\nplus unstaged\n'],
		]);

		const result = await buildCommitMessageContext(fileServiceForUris(content), ROOT_URI, [makeGroup('index', [resource])]);

		expect(result).toContain('+staged');
		expect(result).not.toContain('plus unstaged');
	});
});
