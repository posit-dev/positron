/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { IPathService } from '../../../../../services/path/common/pathService.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../../../platform/workspace/common/workspace.js';
import { resolveNotebookLinkTarget } from '../../../browser/notebookCells/NotebookLink.js';

/**
 * Minimal IPathService fake. fileURI and userHome return deterministic URIs so
 * tests can assert on the exact output. Unknown members throw so an unexpected
 * access produces a clear error instead of a cryptic null-deref.
 */
function makePathService(opts: { userHome?: URI } = {}): IPathService {
	const stub = {
		fileURI: async (path: string) => URI.from({ scheme: 'file', path }),
		userHome: async () => opts.userHome ?? URI.from({ scheme: 'file', path: '/home/test' }),
	};
	return new Proxy(stub, {
		get(target, prop) {
			if (prop in target) { return target[prop as keyof typeof target]; }
			throw new Error(`Unexpected access to IPathService.${String(prop)}`);
		},
	}) as IPathService;
}

/**
 * Minimal IWorkspaceContextService fake. getWorkspace().folders returns the
 * folders passed in; everything else throws to catch unintended access.
 */
function makeWorkspaceContextService(folders: IWorkspaceFolder[] = []): IWorkspaceContextService {
	const stub = { getWorkspace: () => ({ folders }) };
	return new Proxy(stub, {
		get(target, prop) {
			if (prop in target) { return target[prop as keyof typeof target]; }
			throw new Error(`Unexpected access to IWorkspaceContextService.${String(prop)}`);
		},
	}) as IWorkspaceContextService;
}

function folder(uri: URI): IWorkspaceFolder {
	return { uri, name: uri.path, index: 0, toResource: (p: string) => URI.joinPath(uri, p) };
}

suite('Positron Notebook - resolveNotebookLinkTarget', () => {
	test('resolves a bare relative filename against the notebook dir', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'test.py',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.toString(), 'file:///a/b/test.py');
	});

	test('resolves ./file against the notebook dir', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'./test.py',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.toString(), 'file:///a/b/test.py');
	});

	test('resolves ../file one dir up', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'../test.py',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.toString(), 'file:///a/test.py');
	});

	test('resolves subdir/file into a subdirectory', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'sub/test.py',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.toString(), 'file:///a/b/sub/test.py');
	});

	test('relative path on a remote notebook stays on remote', async () => {
		const nb = URI.parse('vscode-remote://host/a/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'test.py',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.toString(), 'vscode-remote://host/a/test.py');
	});

	test('preserves a #fragment when resolving a relative path', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'file.md#section',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.path, '/a/b/file.md');
		assert.strictEqual(result?.fragment, 'section');
	});

	test('handles empty fragment', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'file.md#',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.path, '/a/b/file.md');
		assert.strictEqual(result?.fragment, '');
	});

	test('absolute /path uses pathService and inherits workspace scheme/authority', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const ws = folder(URI.parse('vscode-remote://host/workspace'));
		const result = await resolveNotebookLinkTarget(
			'/abs/path.py',
			nb,
			makePathService(),
			makeWorkspaceContextService([ws]),
		);
		assert.strictEqual(result?.scheme, 'vscode-remote');
		assert.strictEqual(result?.authority, 'host');
		assert.strictEqual(result?.path, '/abs/path.py');
	});

	test('absolute /path with no workspace folder stays on file://', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'/abs/path.py',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.scheme, 'file');
		assert.strictEqual(result?.path, '/abs/path.py');
	});

	test('absolute /path preserves a #fragment', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'/abs/file.md#sec',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.path, '/abs/file.md');
		assert.strictEqual(result?.fragment, 'sec');
	});

	test('~/file joins against userHome', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'~/file.py',
			nb,
			makePathService({ userHome: URI.parse('file:///home/test') }),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.toString(), 'file:///home/test/file.py');
	});

	test('~ alone with no trailing slash resolves to userHome root', async () => {
		const nb = URI.parse('file:///a/b/nb.ipynb');
		const result = await resolveNotebookLinkTarget(
			'~',
			nb,
			makePathService({ userHome: URI.parse('file:///home/test') }),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result?.toString(), 'file:///home/test');
	});

	test('untitled notebook with workspace folder resolves against the folder', async () => {
		const nb = URI.parse('untitled:Untitled-1');
		const ws = folder(URI.parse('file:///workspace'));
		const result = await resolveNotebookLinkTarget(
			'test.py',
			nb,
			makePathService(),
			makeWorkspaceContextService([ws]),
		);
		assert.strictEqual(result?.toString(), 'file:///workspace/test.py');
	});

	test('untitled notebook with no workspace folder returns undefined', async () => {
		const nb = URI.parse('untitled:Untitled-1');
		const result = await resolveNotebookLinkTarget(
			'test.py',
			nb,
			makePathService(),
			makeWorkspaceContextService(),
		);
		assert.strictEqual(result, undefined);
	});
});
