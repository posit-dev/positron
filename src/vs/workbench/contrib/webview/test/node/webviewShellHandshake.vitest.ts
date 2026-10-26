/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from '../../../../../base/common/path.js';

/**
 * Positron hosts external URLs (Viewer, apps, HTML widgets) in its own webview
 * shell, index-external.html, a copy of upstream's index.html. The host in
 * webviewElement.ts drops a 'webview-ready' handshake that doesn't carry the
 * fields it expects, leaving the webview blank. Upstream only updates
 * index.html, so check that both shells send the same handshake fields.
 */
describe('Webview shell handshake', () => {
	const preDir = join(dirname(fileURLToPath(import.meta.url)), '../../browser/pre');

	function readyFields(fileName: string): string[] {
		const html = readFileSync(join(preDir, fileName), 'utf8');
		const data = html.match(/channel: ["']webview-ready["'],\s*data: \{(?<fields>[^}]*)\}/)?.groups?.fields;
		return (data ?? '').split(',').map(field => field.trim().split(':')[0]).filter(field => field.length > 0).sort();
	}

	it('index.html sends the fields the host checks', () => {
		expect(readyFields('index.html')).toEqual(['keyEventToken', 'mountId']);
	});

	it('index-external.html sends the same fields as index.html', () => {
		expect(readyFields('index-external.html')).toEqual(readyFields('index.html'));
	});
});
