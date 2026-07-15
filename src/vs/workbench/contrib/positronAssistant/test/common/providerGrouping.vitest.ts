/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { groupProviders } from '../../common/providerGrouping.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';

function source(overrides: Partial<IPositronLanguageModelSource> & { id: string }): IPositronLanguageModelSource {
	const { id, ...rest } = overrides;
	return {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName: id, settingName: id },
		supportedOptions: [],
		defaults: {},
		...rest,
	} as IPositronLanguageModelSource;
}

describe('groupProviders', () => {
	it('orders sections connected, needs-attention, model-providers', () => {
		const sections = groupProviders([
			source({ id: 'avail', signedIn: false }),
			source({ id: 'err', signedIn: true, status: 'error' }),
			source({ id: 'conn', signedIn: true, status: 'ok' }),
		]);
		expect(sections.map(s => s.id)).toEqual(['connected', 'needs-attention', 'model-providers']);
	});

	it('buckets a signed-in error source into needs-attention', () => {
		const sections = groupProviders([source({ id: 'a', signedIn: true, status: 'error' })]);
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe('needs-attention');
	});

	it('buckets a signed-in non-error source into connected and signed-out into model-providers', () => {
		const sections = groupProviders([
			source({ id: 'a', signedIn: true, status: 'ok' }),
			source({ id: 'b', signedIn: false }),
		]);
		expect(sections.map(s => s.id)).toEqual(['connected', 'model-providers']);
	});

	it('omits empty sections', () => {
		const sections = groupProviders([source({ id: 'b', signedIn: false })]);
		expect(sections.map(s => s.id)).toEqual(['model-providers']);
	});

	it('filters out non-chat sources except copilot-auth completion', () => {
		const sections = groupProviders([
			source({ id: 'comp', type: PositronLanguageModelType.Completion }),
			source({ id: 'copilot-auth', type: PositronLanguageModelType.Completion, signedIn: false }),
		]);
		expect(sections).toHaveLength(1);
		expect(sections[0].items.map(i => i.provider.id)).toEqual(['copilot-auth']);
	});

	it('excludes the custom-provider template (openai-compatible) from the built-in sections', () => {
		const sections = groupProviders([
			source({ id: 'openai-compatible', signedIn: false }),
			source({ id: 'openai-api', signedIn: false }),
		]);
		expect(sections).toHaveLength(1);
		expect(sections[0].items.map(i => i.provider.id)).toEqual(['openai-api']);
	});

	it('sorts alphabetically by display name within a section', () => {
		const sections = groupProviders([
			source({ id: 'zebra', provider: { id: 'zebra', displayName: 'Zebra', settingName: 'zebra' }, signedIn: false }),
			source({ id: 'posit-ai', provider: { id: 'posit-ai', displayName: 'Posit AI', settingName: 'positAI' }, signedIn: false }),
			source({ id: 'alpha', provider: { id: 'alpha', displayName: 'Alpha', settingName: 'alpha' }, signedIn: false }),
		]);
		expect(sections[0].items.map(i => i.provider.displayName)).toEqual(['Alpha', 'Posit AI', 'Zebra']);
	});
});
