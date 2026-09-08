/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { customizedConnectionFields } from '../../node/aiProviderCatalog.js';

describe('customizedConnectionFields', () => {
	it('reports nothing when the resolved connection only carries the built-in defaults', () => {
		// A stock install: ai-config layers the provider's defaults into the
		// resolved connection even though the user never wrote them. That must
		// not read as a customization.
		expect(customizedConnectionFields(
			{ baseUrl: 'https://gateway.posit.ai', googleCloud: { location: 'us-central1' } },
			{ baseUrl: 'https://gateway.posit.ai', googleCloud: { location: 'us-central1' } },
		)).toBeUndefined();
	});

	it('reports only the fields that differ from the defaults', () => {
		expect(customizedConnectionFields(
			{
				baseUrl: 'https://gateway.example.corp',
				googleCloud: { location: 'us-central1', project: 'my-project' },
			},
			{ baseUrl: 'https://gateway.posit.ai', googleCloud: { location: 'us-central1' } },
		)).toEqual(['baseUrl', 'googleCloud.project']);
	});

	it('reports every set field for a provider with no defaults, e.g. a custom entry', () => {
		expect(customizedConnectionFields(
			{
				baseUrl: 'https://gateway.example.corp',
				customHeaders: { 'X-Route': 'a' },
				aws: { profile: 'work', region: undefined },
			},
			undefined,
		)).toEqual(['baseUrl', 'customHeaders', 'aws.profile']);
	});

	it('treats an empty customHeaders map and an untouched connection as nothing to report', () => {
		expect(customizedConnectionFields({ customHeaders: {} }, undefined)).toBeUndefined();
		expect(customizedConnectionFields({}, undefined)).toBeUndefined();
	});
});
