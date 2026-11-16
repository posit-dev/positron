/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookOutputPlotClient } from '../../browser/notebookOutputPlotClient.js';
import { IPositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { ILanguageRuntimeMessageOutput } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';

describe('NotebookOutputPlotClient', () => {
	const disposables = ensureNoLeakedDisposables();

	function createClient(data: Record<string, unknown>) {
		const message = stubInterface<ILanguageRuntimeMessageOutput>({
			id: 'output-1',
			parent_id: 'execution-1',
			when: new Date(0).toISOString(),
			output_id: undefined,
			data,
		});
		return disposables.add(new NotebookOutputPlotClient(
			stubInterface<IPositronNotebookOutputWebviewService>(),
			stubInterface<ILanguageRuntimeSession>({ sessionId: 'session-1' }),
			message,
		));
	}

	/** Gets the script URLs that a standalone HTML document loads. */
	function scriptSources(html: string | undefined) {
		return [...(html ?? '').matchAll(/<script src="(?<src>[^"]+)">/g)].map(match => match.groups?.src);
	}

	it.each([
		['application/vnd.vegalite.v5+json', ['vega@5', 'vega-lite@5', 'vega-embed@6']],
		['application/vnd.vegalite.v6+json', ['vega@6', 'vega-lite@6', 'vega-embed@7']],
		['application/vnd.vega.v5+json', ['vega@5', 'vega-embed@6']],
	])('loads matching library versions for %s', (mimeType, packages) => {
		const client = createClient({ [mimeType]: { mark: 'point' }, 'text/plain': 'chart' });

		expect({
			hasStandaloneHtml: client.hasStandaloneHtml,
			scripts: scriptSources(client.standaloneHtml),
		}).toEqual({
			hasStandaloneHtml: true,
			scripts: packages.map(pkg => `https://cdn.jsdelivr.net/npm/${pkg}`),
		});
	});

	it('escapes the spec so it cannot close the script tag', () => {
		const client = createClient({
			'application/vnd.vegalite.v5+json': { title: '</script><script>alert(1)</script>' },
		});

		expect(client.standaloneHtml).toContain(`vegaEmbed('#vis', {"title":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"})`);
	});

	it('has no standalone HTML for other outputs', () => {
		const client = createClient({ 'application/vnd.jupyter.widget-view+json': {}, 'text/plain': 'widget' });

		expect({
			hasStandaloneHtml: client.hasStandaloneHtml,
			standaloneHtml: client.standaloneHtml,
		}).toEqual({ hasStandaloneHtml: false, standaloneHtml: undefined });
	});
});
