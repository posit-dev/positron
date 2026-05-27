/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IBrowserWorkbenchEnvironmentService } from '../../../environment/browser/environmentService.js';
import { PositronDocsService } from '../../browser/positronDocsService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

function makeSvc(positronDocsUrl?: string): PositronDocsService {
	const env = stubInterface<IBrowserWorkbenchEnvironmentService>({ positronDocsUrl });
	return new PositronDocsService(env);
}

describe('PositronDocsService', () => {

	it('uses POSITRON_DOCS_URL when the environment provides one', () => {
		expect(makeSvc('https://workbench.example.com/docs/').baseUrl)
			.toBe('https://workbench.example.com/docs/');
	});

	// Either side may or may not carry a slash; the join should always
	// produce exactly one separator.
	it.each([
		['https://docs.example.com/', 'release-notes', 'https://docs.example.com/release-notes'],
		['https://docs.example.com', 'release-notes', 'https://docs.example.com/release-notes'],
		['https://docs.example.com/', '/release-notes', 'https://docs.example.com/release-notes'],
		['https://docs.example.com', '/release-notes', 'https://docs.example.com/release-notes'],
	])('getUrl normalizes slashes: %s + %s', (base, path, expected) => {
		expect(makeSvc(base).getUrl(path)).toBe(expected);
	});
});
