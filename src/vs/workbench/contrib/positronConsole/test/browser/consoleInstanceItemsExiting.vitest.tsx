/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { EditorFontLigatures, EditorFontVariations } from '../../../../../editor/common/config/editorOptions.js';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ConsoleInstanceItems } from '../../browser/components/consoleInstanceItems.js';

/**
 * Mock `ConsoleInput` because constructing its editor requires unrelated services.
 * These tests observe only `hidden`.
 */
const { mockConsoleInput } = vi.hoisted(() => ({ mockConsoleInput: vi.fn() }));
vi.mock('../../browser/components/consoleInput.js', () => ({
	ConsoleInput: (props: { hidden: boolean }) => {
		mockConsoleInput(props);
		return null;
	},
}));

function createFontInfo(): FontInfo {
	return new FontInfo({
		pixelRatio: 1,
		fontFamily: 'mockFont',
		fontWeight: 'normal',
		fontSize: 14,
		fontFeatureSettings: EditorFontLigatures.OFF,
		fontVariationSettings: EditorFontVariations.OFF,
		lineHeight: 19,
		letterSpacing: 1.5,
		isMonospace: true,
		typicalHalfwidthCharacterWidth: 10,
		typicalFullwidthCharacterWidth: 20,
		canUseHalfwidthRightwardsArrow: true,
		spaceWidth: 10,
		middotWidth: 10,
		wsmiddotWidth: 10,
		maxDigitWidth: 10,
	}, true);
}

/**
 * The runtime remains attached during shutdown, including `.Last` hooks that can
 * hang. Verify that `exiting` still hides the prompt.
 */
describe('ConsoleInstanceItems - live input during exit', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const positronConsoleInstance = stubInterface<IPositronConsoleInstance>({
		runtimeItems: [],
		promptActive: false,
		sessionName: 'Test R',
	});

	function renderAndGetHidden(props: { exiting: boolean; runtimeAttached: boolean; showExitingBanner?: boolean }): boolean {
		rtl.render(
			<ConsoleInstanceItems
				consoleInputWidth={400}
				disconnected={false}
				exiting={props.exiting}
				fontInfo={createFontInfo()}
				positronConsoleInstance={positronConsoleInstance}
				runtimeAttached={props.runtimeAttached}
				showExitingBanner={props.showExitingBanner ?? false}
				trace={false}
				onSelectAll={() => { }}
			/>
		);
		expect(mockConsoleInput).toHaveBeenCalledTimes(1);
		return mockConsoleInput.mock.calls[0][0].hidden;
	}

	it('hides the live input while the runtime is exiting, even though it is still attached', () => {
		expect(renderAndGetHidden({ exiting: true, runtimeAttached: true })).toBe(true);
	});

	it('shows the live input once the runtime is attached and not exiting', () => {
		expect(renderAndGetHidden({ exiting: false, runtimeAttached: true })).toBe(false);
	});

	it('still hides the live input when detached, regardless of exiting', () => {
		expect(renderAndGetHidden({ exiting: false, runtimeAttached: false })).toBe(true);
	});

	it('hides the prompt before the delayed exiting banner appears', () => {
		const hidden = renderAndGetHidden({ exiting: true, runtimeAttached: true });
		expect({ hidden, banner: screen.queryByText('Test R exiting...') }).toEqual({ hidden: true, banner: null });
	});

	it('shows the exiting banner when its delayed flag is set', () => {
		renderAndGetHidden({ exiting: true, runtimeAttached: true, showExitingBanner: true });
		expect(screen.getByText('Test R exiting...')).toBeInTheDocument();
	});

	it('does not show the exiting banner while the runtime is not exiting', () => {
		renderAndGetHidden({ exiting: false, runtimeAttached: true });
		expect(screen.queryByText('Test R exiting...')).not.toBeInTheDocument();
	});
});
