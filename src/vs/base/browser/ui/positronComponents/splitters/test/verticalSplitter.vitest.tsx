/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { ConfigurationTarget, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { VerticalSplitter } from '../verticalSplitter.js';

describe('VerticalSplitter', () => {
	const configurationService = new TestConfigurationService({
		'workbench.sash.size': 4,
		'workbench.sash.hoverDelay': 300
	});
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, configurationService)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(async () => {
		await configurationService.setUserConfiguration('workbench.sash.size', 4);
	});

	/**
	 * Fires a configuration change event for workbench.sash.size, as the real
	 * configuration service would after the setting changes.
	 */
	const fireSashSizeChange = () => {
		act(() => {
			configurationService.onDidChangeConfigurationEmitter.fire({
				source: ConfigurationTarget.USER,
				affectedKeys: new Set(['workbench.sash.size']),
				change: { keys: ['workbench.sash.size'], overrides: [] },
				affectsConfiguration: section =>
					section === 'workbench.sash.size' || 'workbench.sash.size'.startsWith(`${section}.`)
			});
		});
	};

	const baseProps = {
		onBeginResize: () => ({ minimumWidth: 100, maximumWidth: 1000, startingWidth: 200 }),
		onResize: () => { }
	};

	const renderSplitter = (showSash?: boolean) =>
		rtl.render(<VerticalSplitter showSash={showSash} {...baseProps} />);

	const renderCollapsibleSplitter = () =>
		rtl.render(
			<VerticalSplitter
				collapsible={true}
				isCollapsed={false}
				onCollapsedChanged={() => { }}
				{...baseProps}
			/>
		);

	it('renders splitter and sash widths derived from workbench.sash.size when collapsible', () => {
		renderCollapsibleSplitter();

		// Collapsible: splitter width is sash size * 2; the sash adds 2px.
		expect(screen.getByTestId('vertical-splitter')).toHaveStyle({ width: '8px' });
		expect(screen.getByTestId('vertical-splitter-sash')).toHaveStyle({ width: '10px' });
	});

	it('renders a 1px splitter when not collapsible', () => {
		renderSplitter();

		expect(screen.getByTestId('vertical-splitter')).toHaveStyle({ width: '1px' });
		expect(screen.getByTestId('vertical-splitter-sash')).toHaveStyle({ width: '4px' });
	});

	it('updates widths when workbench.sash.size changes', async () => {
		renderCollapsibleSplitter();

		await configurationService.setUserConfiguration('workbench.sash.size', 8);
		fireSashSizeChange();

		expect(screen.getByTestId('vertical-splitter')).toHaveStyle({ width: '16px' });
		expect(screen.getByTestId('vertical-splitter-sash')).toHaveStyle({ width: '18px' });
	});

	it('does not re-read configuration on re-render', () => {
		// Guards the #15427 amplifier: eager useState initializers re-read
		// configuration on every render of every splitter. Call count is the
		// only observable for the regression.
		// The collapsible variant is the one whose three initializers all read
		// configuration (the non-collapsible splitterWidth short-circuits to 1).
		const getValueSpy = vi.spyOn(configurationService, 'getValue');
		const { rerender } = renderCollapsibleSplitter();
		const readsAfterMount = getValueSpy.mock.calls.length;

		// The mount reads (3 initializers + hover delay) prove the spy is
		// observing the service the component actually uses.
		expect(readsAfterMount).toBeGreaterThan(0);

		rerender(
			<VerticalSplitter
				collapsible={true}
				isCollapsed={false}
				showSash={true}
				onCollapsedChanged={() => { }}
				{...baseProps}
			/>
		);

		expect(getValueSpy.mock.calls.length).toBe(readsAfterMount);
	});
});
