/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { CellUri } from '../../../notebook/common/notebookCommon.js';
import {
	findShadowCellUriLeak,
	guardAgainstShadowCellUriLeaks,
	isShadowCellUri,
} from '../../common/quartoShadowUriLeakGuard.js';

/** A shadow cell URI: vscode-notebook-cell scheme over a .qmd path. */
const shadowCellUri = CellUri.generate(URI.file('/docs/analysis.qmd'), 7);

/** A real notebook's cell URI: legitimate user-facing location. */
const ipynbCellUri = CellUri.generate(URI.file('/docs/analysis.ipynb'), 7);

describe('isShadowCellUri', () => {
	it('identifies cell URIs over Quarto and R Markdown paths', () => {
		expect([
			isShadowCellUri(shadowCellUri),
			isShadowCellUri(CellUri.generate(URI.file('/docs/report.Rmd'), 1)),
			isShadowCellUri(ipynbCellUri),
			isShadowCellUri(URI.file('/docs/analysis.qmd')), // plain file URI
		]).toEqual([true, true, false, false]);
	});
});

describe('findShadowCellUriLeak', () => {
	it('finds a leaked shadow cell URI nested in arrays and objects', () => {
		const result = {
			actions: [
				{ title: 'ok', edit: { edits: [{ resource: URI.file('/other.py'), textEdit: {} }] } },
				{ title: 'leaky', edit: { edits: [{ resource: shadowCellUri, textEdit: {} }] } },
			],
		};
		expect(findShadowCellUriLeak(result)?.path).toBe(shadowCellUri.path);
	});

	it('finds a leak inside Map and Set containers', () => {
		expect(findShadowCellUriLeak(new Map([['key', new Set([shadowCellUri])]]))).toBeDefined();
	});

	it('detects UriComponents-shaped plain objects, not only URI instances', () => {
		// e.g. an IMarkdownString's `uris` record carries plain UriComponents.
		const markdown = {
			value: 'hover text',
			uris: { link: { scheme: 'vscode-notebook-cell', path: '/docs/analysis.qmd', authority: '', query: '', fragment: 'C7' } },
		};
		expect(findShadowCellUriLeak(markdown)).toBeDefined();
	});

	it('passes results containing real files and real notebook cells', () => {
		const result = [
			{ uri: URI.file('/src/utils.py'), range: {} },
			{ uri: ipynbCellUri, range: {} },
			{ uri: URI.file('/docs/analysis.qmd'), range: {} },
		];
		expect(findShadowCellUriLeak(result)).toBeUndefined();
	});

	it('skips command payloads (cell URIs are their native coordinate space)', () => {
		const suggestion = {
			label: 'auto_import',
			command: { id: 'python.addImport', arguments: [shadowCellUri] },
		};
		expect(findShadowCellUriLeak(suggestion)).toBeUndefined();
	});

	it('handles cyclic results without hanging', () => {
		interface Node { leak?: URI; self?: Node }
		const cycle: Node = {};
		cycle.self = cycle;
		cycle.leak = shadowCellUri;
		expect(findShadowCellUriLeak(cycle)).toBeDefined();
	});
});

describe('guardAgainstShadowCellUriLeaks', () => {
	it('returns a clean result unchanged', () => {
		const result = { uri: URI.file('/src/utils.py') };
		expect(guardAgainstShadowCellUriLeaks('test', result, new NullLogService())).toBe(result);
	});

	it('fails closed on a leak, logging an error', () => {
		const logService = new NullLogService();
		const errorSpy = vi.spyOn(logService, 'error');
		const guarded = guardAgainstShadowCellUriLeaks('test', { uri: shadowCellUri }, logService);
		expect({ guarded, logged: errorSpy.mock.calls.length }).toEqual({ guarded: undefined, logged: 1 });
	});
});
