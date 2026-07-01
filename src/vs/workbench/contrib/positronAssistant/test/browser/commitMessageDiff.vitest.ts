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

/** Build an added resource at the given path. */
function makeAddedResource(path: string): ISCMResource {
	return stubInterface<ISCMResource>({
		sourceUri: URI.file(`/repo/${path}`),
		multiDiffEditorOriginalUri: undefined,
		multiDiffEditorModifiedUri: undefined,
		decorations: {},
	});
}

/** Build a deleted resource at the given path. */
function makeDeletedResource(path: string): ISCMResource {
	const sourceUri = URI.file(`/repo/${path}`);
	return stubInterface<ISCMResource>({
		sourceUri,
		multiDiffEditorOriginalUri: sourceUri.with({ scheme: 'git', query: 'HEAD' }),
		multiDiffEditorModifiedUri: undefined,
		decorations: { strikeThrough: true },
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

	it('summarizes a deleted file as a removal diff', async () => {
		const groups = [makeGroup('index', [makeDeletedResource('gone.ts')])];
		const result = await buildCommitMessageContext(fileServiceReturning('bye\n'), ROOT_URI, groups);
		expect(result).toMatchInlineSnapshot(`
			"--- a/gone.ts
			+++ /dev/null
			@@ -1,1 +0,0 @@
			-bye"
		`);
	});

	it('truncates an oversized single-file diff to the per-file budget and flags the omission', async () => {
		const huge = `${'x'.repeat(200 * 1024)}\n`;
		const groups = [makeGroup('index', [makeAddedResource('big.ts')])];
		const result = await buildCommitMessageContext(fileServiceReturning(huge), ROOT_URI, groups);
		expect(result).toContain('[Some changes were omitted');
		// The 200 KB input is truncated to the ~2 KB per-file budget (plus note).
		expect(result.length).toBeLessThan(3 * 1024);
	});

	it('truncates each large file independently rather than sharing one budget', async () => {
		const huge = `${'x'.repeat(50 * 1024)}\n`;
		const resources = ['a.ts', 'b.ts', 'c.ts'].map(makeAddedResource);
		const result = await buildCommitMessageContext(fileServiceReturning(huge), ROOT_URI, [makeGroup('index', resources)]);
		// Each of the three files contributes up to ~2 KB, so all three appear.
		expect(result).toContain('b/a.ts');
		expect(result).toContain('b/b.ts');
		expect(result).toContain('b/c.ts');
		expect(result.length).toBeLessThan(3 * (2 * 1024) + 256);
	});

	it('caps the number of files summarized and flags the omission', async () => {
		const resources = Array.from({ length: 150 }, (_, i) => makeAddedResource(`file${i}.ts`));
		const result = await buildCommitMessageContext(fileServiceReturning('a\n'), ROOT_URI, [makeGroup('workingTree', resources)]);
		expect(result).toContain('[Some changes were omitted');
		expect(result).toContain('b/file0.ts');
		expect(result).not.toContain('b/file149.ts');
	});
});
