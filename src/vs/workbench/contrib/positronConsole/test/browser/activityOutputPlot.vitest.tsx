/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ActivityItemOutputPlot } from '../../../../services/positronConsole/browser/classes/activityItemOutputPlot.js';
import { ActivityOutputPlot } from '../../browser/components/activityOutputPlot.js';

const settingId = 'console.notebookPlotPreviewHeight';

function makePlot(isNotebookConsolePlot: boolean): ActivityItemOutputPlot {
	return new ActivityItemOutputPlot(
		'id',
		'parent',
		new Date(),
		{ 'image/png': 'aGVsbG8=' },
		() => { },
		undefined,
		isNotebookConsolePlot,
	);
}

describe('ActivityOutputPlot notebook preview height', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function setHeight(height: number) {
		(ctx.get(IConfigurationService) as TestConfigurationService)
			.setUserConfiguration(settingId, height);
	}

	function changeHeight(height: number) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration(settingId, height);
		configurationService.onDidChangeConfigurationEmitter.fire({
			source: ConfigurationTarget.USER,
			affectedKeys: new Set([settingId]),
			change: { keys: [settingId], overrides: [] },
			affectsConfiguration: key => key === settingId,
		});
	}

	it('caps a notebook plot preview at the configured height', () => {
		setHeight(200);
		rtl.render(<ActivityOutputPlot activityItemOutputPlot={makePlot(true)} />);
		expect(screen.getByRole('img')).toHaveStyle({ maxHeight: '200px' });
	});

	it('resizes an existing notebook plot preview when the setting changes', () => {
		setHeight(200);
		rtl.render(<ActivityOutputPlot activityItemOutputPlot={makePlot(true)} />);

		act(() => changeHeight(400));

		expect(screen.getByRole('img')).toHaveStyle({ maxHeight: '400px' });
	});

	it('hides a notebook plot preview when the height is 0', () => {
		setHeight(0);
		rtl.render(<ActivityOutputPlot activityItemOutputPlot={makePlot(true)} />);
		expect(screen.queryByRole('img')).not.toBeInTheDocument();
	});

	it('leaves regular console plots to the CSS height', () => {
		setHeight(200);
		rtl.render(<ActivityOutputPlot activityItemOutputPlot={makePlot(false)} />);
		expect(screen.getByRole('img')).not.toHaveStyle({ maxHeight: '200px' });
	});
});
