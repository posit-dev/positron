/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../base/common/event.js';
import { ConfigurationTarget, IConfigurationChangeEvent, IConfigurationValue } from '../../../configuration/common/configuration.js';
import { createConfigurationLegacySettingsReader } from '../../node/aiProviderCatalog.js';

// PROVIDER-SETTINGS-MIGRATION(legacy-positron): delete with the reader.
//
// Pins the reader's load-bearing invariant: `get` surfaces `inspect(key).userValue`
// only — never the effective value — so policy/default/enforced values cannot be
// promoted into the non-enforced `legacy-positron` layer. The catalog tests inject
// hand-rolled readers, so a regression to `getValue(key)` here would pass them all.
describe('createConfigurationLegacySettingsReader', () => {
	function stubService(inspections: Record<string, IConfigurationValue<unknown>>) {
		const changeEmitter = new Emitter<IConfigurationChangeEvent>();
		return {
			changeEmitter,
			service: {
				inspect: <T,>(key: string): IConfigurationValue<T> =>
					(inspections[key] ?? {}) as IConfigurationValue<T>,
				onDidChangeConfiguration: changeEmitter.event,
			},
		};
	}

	it('surfaces only userValue, never default/policy/effective values', () => {
		const { service } = stubService({
			'authentication.anthropic.baseUrl': {
				defaultValue: 'https://default.example/v1',
				userValue: 'https://user.example/v1',
				policyValue: 'https://policy.example/v1',
				value: 'https://policy.example/v1',
			},
		});
		expect(createConfigurationLegacySettingsReader(service).get('authentication.anthropic.baseUrl'))
			.toBe('https://user.example/v1');
	});

	it('returns undefined when a key has only default and policy values', () => {
		const { service } = stubService({
			'authentication.anthropic.baseUrl': {
				defaultValue: 'https://default.example/v1',
				policyValue: 'https://policy.example/v1',
				value: 'https://policy.example/v1',
			},
		});
		expect(createConfigurationLegacySettingsReader(service).get('authentication.anthropic.baseUrl'))
			.toBeUndefined();
	});

	it('preserves a user-set false (?? semantics live in the caller, not the reader)', () => {
		const { service } = stubService({
			'positron.assistant.provider.anthropic.enable': {
				defaultValue: true,
				userValue: false,
				value: false,
			},
		});
		expect(createConfigurationLegacySettingsReader(service).get('positron.assistant.provider.anthropic.enable'))
			.toBe(false);
	});

	it('watch subscribes to onDidChangeConfiguration and stops on dispose', () => {
		const { service, changeEmitter } = stubService({});
		const onChange = vi.fn();
		const subscription = createConfigurationLegacySettingsReader(service).watch(onChange);

		const event: IConfigurationChangeEvent = {
			source: ConfigurationTarget.USER,
			affectedKeys: new Set(['authentication.anthropic.baseUrl']),
			change: { keys: [], overrides: [] },
			affectsConfiguration: () => true,
		};
		changeEmitter.fire(event);
		expect(onChange).toHaveBeenCalledTimes(1);

		subscription.dispose();
		changeEmitter.fire(event);
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});
