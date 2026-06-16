/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Registry } from '../../../platform/registry/common/platform.js';
import { Extensions, IConfigurationMigrationRegistry, ConfigurationMigration } from '../configuration.js';
import { Event } from '../../../base/common/event.js';

describe('ConfigurationMigrationRegistry', () => {

	it('fires onDidRegisterConfigurationMigration when migrations are registered', () => {
		const registry = Registry.as<IConfigurationMigrationRegistry & { onDidRegisterConfigurationMigration: Event<ConfigurationMigration[]> }>(Extensions.ConfigurationMigration);

		const fired: ConfigurationMigration[][] = [];
		const disposable = registry.onDidRegisterConfigurationMigration(m => fired.push(m));

		const migration: ConfigurationMigration = {
			key: 'test.eventFiringKey',
			migrateFn: (value: unknown) => [['test.eventFiringKeyNew', { value }]],
		};
		registry.registerConfigurationMigrations([migration]);

		disposable.dispose();

		expect(fired).toHaveLength(1);
		expect(fired[0]).toHaveLength(1);
		expect(fired[0][0].key).toBe('test.eventFiringKey');
	});
});
