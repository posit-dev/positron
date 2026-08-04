/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ConfigurationModelParser } from '../../../../../platform/configuration/common/configurationModels.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { CANVAS_OPEN_ON_STARTUP_KEY, ICanvasStartSignals, shouldStartInCanvasMode } from '../../common/positronCanvasMode.js';

function signals(overrides: Partial<ICanvasStartSignals>): ICanvasStartSignals {
	return {
		aiEnabled: true,
		engagedElsewhere: false,
		canvasFlag: false,
		configuredOpenOnStartup: undefined,
		storedIntent: false,
		...overrides
	};
}

describe('shouldStartInCanvasMode', () => {

	it('never starts when ai.enabled is false, regardless of other signals', () => {
		expect(shouldStartInCanvasMode(signals({ aiEnabled: false, canvasFlag: true, configuredOpenOnStartup: true, storedIntent: true }))).toBe(false);
		expect(shouldStartInCanvasMode(signals({ aiEnabled: false, configuredOpenOnStartup: true }))).toBe(false);
		expect(shouldStartInCanvasMode(signals({ aiEnabled: false, storedIntent: true }))).toBe(false);
	});

	it('never starts when the mode is engaged in another window, regardless of other signals', () => {
		expect(shouldStartInCanvasMode(signals({ engagedElsewhere: true, canvasFlag: true, configuredOpenOnStartup: true, storedIntent: true }))).toBe(false);
		expect(shouldStartInCanvasMode(signals({ engagedElsewhere: true, configuredOpenOnStartup: true }))).toBe(false);
		expect(shouldStartInCanvasMode(signals({ engagedElsewhere: true, storedIntent: true }))).toBe(false);
	});

	it('honors a fresh --canvas unconditionally once the vetoes pass', () => {
		expect(shouldStartInCanvasMode(signals({ canvasFlag: true, configuredOpenOnStartup: false }))).toBe(true);
	});

	it('lets an explicitly configured setting beat the stored intent in both directions', () => {
		// Configuration is what the user asked for; storage is only what they
		// last did.
		expect(shouldStartInCanvasMode(signals({ configuredOpenOnStartup: false, storedIntent: true }))).toBe(false);
		expect(shouldStartInCanvasMode(signals({ configuredOpenOnStartup: true, storedIntent: false }))).toBe(true);
	});

	it('relaunches into whatever the workspace quit in when nothing is configured', () => {
		expect(shouldStartInCanvasMode(signals({ storedIntent: true }))).toBe(true);
		expect(shouldStartInCanvasMode(signals({ storedIntent: false }))).toBe(false);
	});
});

describe('canvas.openOnStartup configuration', () => {

	it('is hidden, experimental, and still readable from settings.json', () => {
		const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		const property = registry.getExcludedConfigurationProperties()[CANVAS_OPEN_ON_STARTUP_KEY];

		expect(registry.getConfigurationProperties()[CANVAS_OPEN_ON_STARTUP_KEY]).toBeUndefined();
		expect(property).toMatchObject({
			included: false,
			tags: ['experimental'],
			scope: ConfigurationScope.WINDOW,
		});

		const parser = new ConfigurationModelParser('canvas settings', new NullLogService());
		parser.parse(JSON.stringify({ [CANVAS_OPEN_ON_STARTUP_KEY]: true }), { scopes: [ConfigurationScope.WINDOW] });

		expect(parser.configurationModel.getValue(CANVAS_OPEN_ON_STARTUP_KEY)).toBe(true);
	});
});
