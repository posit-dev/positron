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
	} satisfies IPositronLanguageModelSource;
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

	it('buckets a signed-out error source (expired credential) into needs-attention, not model-providers', () => {
		const sections = groupProviders([source({ id: 'a', signedIn: false, status: 'error' })]);
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
			source({ id: 'nova', provider: { id: 'nova', displayName: 'Nova', settingName: 'nova' }, signedIn: false }),
			source({ id: 'alpha', provider: { id: 'alpha', displayName: 'Alpha', settingName: 'alpha' }, signedIn: false }),
		]);
		expect(sections[0].items.map(i => i.provider.displayName)).toEqual(['Alpha', 'Nova', 'Zebra']);
	});

	it('pins Posit AI first within its section, ahead of an alphabetically-earlier stable provider', () => {
		const sections = groupProviders([
			source({ id: 'aardvark', provider: { id: 'aardvark', displayName: 'Aardvark', settingName: 'aardvark' }, signedIn: false }),
			source({ id: 'posit-ai', provider: { id: 'posit-ai', displayName: 'Posit AI', settingName: 'positAI' }, signedIn: false }),
		]);
		expect(sections[0].items.map(i => i.provider.displayName)).toEqual(['Posit AI', 'Aardvark']);
	});

	it('orders by maturity (stable, then preview, then experimental) before display name within a section', () => {
		const sections = groupProviders([
			source({ id: 'exp', provider: { id: 'exp', displayName: 'Aaa Experimental', settingName: 'exp', status: 'experimental' }, signedIn: false }),
			source({ id: 'prev', provider: { id: 'prev', displayName: 'Zzz Preview', settingName: 'prev', status: 'preview' }, signedIn: false }),
			source({ id: 'stableZ', provider: { id: 'stableZ', displayName: 'Zzz Stable', settingName: 'stableZ' }, signedIn: false }),
			source({ id: 'stableA', provider: { id: 'stableA', displayName: 'Aaa Stable', settingName: 'stableA' }, signedIn: false }),
		]);
		// Maturity tier wins over display name: both stable providers come first
		// (alphabetical among themselves), then preview, then experimental -- even
		// though 'Aaa Experimental' would sort first under a pure alphabetical order.
		expect(sections[0].items.map(i => i.provider.displayName)).toEqual([
			'Aaa Stable', 'Zzz Stable', 'Zzz Preview', 'Aaa Experimental',
		]);
	});
});
