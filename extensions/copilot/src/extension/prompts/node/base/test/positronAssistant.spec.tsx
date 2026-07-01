/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test, vi } from 'vitest';
import { PositronAssistant } from '../positronAssistant';

// `prepare()` resolves the Positron Assistant extension via
// `vscode.extensions.getExtension`; that is the only `vscode` member used at
// runtime, so mock just `extensions` and drive `getExtension` per-test.
const { getExtension } = vi.hoisted(() => ({ getExtension: vi.fn() }));
vi.mock('vscode', () => ({ extensions: { getExtension } }));

suite('PositronAssistant', () => {
	const request = { prompt: 'hello' };
	const props = { promptContext: { request } } as any;
	const element = new PositronAssistant(props);

	test('prepare returns undefined when the Positron Assistant extension is not installed', async () => {
		getExtension.mockReturnValue(undefined);

		expect(await element.prepare({} as any)).toBeUndefined();
	});

	test('prepare returns undefined when the extension API lacks generateAssistantPrompt', async () => {
		getExtension.mockReturnValue({ activate: async () => ({}) });

		expect(await element.prepare({} as any)).toBeUndefined();
	});

	test('prepare activates the extension and returns its generated prompt', async () => {
		const generateAssistantPrompt = vi.fn().mockResolvedValue('positron context');
		getExtension.mockReturnValue({ activate: async () => ({ generateAssistantPrompt }) });

		expect(await element.prepare({} as any)).toBe('positron context');
		expect(generateAssistantPrompt).toHaveBeenCalledWith(request);
	});

	test('render returns nothing when there is no Positron context', () => {
		expect(element.render(undefined, {} as any)).toBeUndefined();
	});

	test('render embeds the Positron context when it is available', () => {
		const rendered = element.render('positron context', {} as any);

		expect(JSON.stringify(rendered)).toContain('positron context');
	});
});
