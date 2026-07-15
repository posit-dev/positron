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
	it('buckets signed-in error sources into needs-attention', () => {
		const sections = groupProviders([source({ id: 'a', signedIn: true, status: 'error' })]);
		expect(sections).toHaveLength(1);
		expect(sections[0].id).toBe('needs-attention');
		expect(sections[0].items.map(i => i.provider.id)).toEqual(['a']);
	});

	it('buckets signed-in non-error into connected and signed-out into available', () => {
		const sections = groupProviders([
			source({ id: 'a', signedIn: true, status: 'ok' }),
			source({ id: 'b', signedIn: false }),
		]);
		expect(sections.map(s => s.id)).toEqual(['connected', 'available']);
	});

	it('omits empty sections', () => {
		const sections = groupProviders([source({ id: 'b', signedIn: false })]);
		expect(sections.map(s => s.id)).toEqual(['available']);
	});

	it('filters out non-chat sources except copilot-auth completion', () => {
		const sections = groupProviders([
			source({ id: 'comp', type: PositronLanguageModelType.Completion }),
			source({ id: 'copilot-auth', type: PositronLanguageModelType.Completion, signedIn: false }),
		]);
		expect(sections).toHaveLength(1);
		expect(sections[0].items.map(i => i.provider.id)).toEqual(['copilot-auth']);
	});

	it('sorts posit-ai first, then stable, preview, experimental, then alphabetical', () => {
		const sections = groupProviders([
			source({ id: 'zebra', signedIn: false }),
			source({ id: 'exp', signedIn: false, provider: { id: 'exp', displayName: 'exp', settingName: 'exp', status: 'experimental' } }),
			source({ id: 'posit-ai', signedIn: false }),
			source({ id: 'alpha', signedIn: false }),
		]);
		expect(sections[0].items.map(i => i.provider.id)).toEqual(['posit-ai', 'alpha', 'zebra', 'exp']);
	});
});
