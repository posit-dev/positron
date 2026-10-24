/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { EditorFontLigatures, EditorFontVariations } from '../../../../../editor/common/config/editorOptions.js';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ActivityItemErrorMessage } from '../../../../services/positronConsole/browser/classes/activityItemErrorMessage.js';
import { ActivityItemInput, ActivityItemInputState } from '../../../../services/positronConsole/browser/classes/activityItemInput.js';
import { RuntimeItemActivity } from '../../../../services/positronConsole/browser/classes/runtimeItemActivity.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { registerTestErrorActionHandler } from '../../../positronAssistant/test/browser/errorActionTestUtils.js';
import { RuntimeActivity } from '../../browser/components/runtimeActivity.js';

// Replace the input renderer: colorizing the input needs the tokenization
// registry, and these tests only care about what reaches the error's buttons.
vi.mock('../../browser/components/activityInput.js', () => ({
	ActivityInput: () => null,
}));

const when = new Date(0);

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

function createInput(code: string) {
	return new ActivityItemInput('input', 'activity', when, ActivityItemInputState.Completed, '>>> ', '... ', code);
}

function createError() {
	return new ActivityItemErrorMessage('error', 'activity', when, 'NameError', 'name \'x\' is not defined', []);
}

describe('RuntimeActivity error code', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const ask = vi.fn();

	const positronConsoleInstance = stubInterface<IPositronConsoleInstance>({
		sessionId: 'python-1234',
		sessionName: 'Python 3.12.1',
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'python' }),
	});

	beforeEach(() => {
		ask.mockReset().mockResolvedValue(undefined);
		registerTestErrorActionHandler(ctx, { ask });
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration('console.assistantActions.enabled', true);
	});

	/** Render an activity and click Fix on its error. */
	async function clickFix(activity: RuntimeItemActivity) {
		rtl.render(<RuntimeActivity fontInfo={createFontInfo()} positronConsoleInstance={positronConsoleInstance} runtimeItemActivity={activity} version={activity.version} />);
		await userEvent.setup().click(screen.getByRole('button', { name: 'Ask Test Assistant to fix' }));
		return ask.mock.calls[0][1];
	}

	it('sends the input that ran with the error', async () => {
		const activity = new RuntimeItemActivity('activity', createInput('print(x)'));
		activity.addActivityItem(createError());

		expect(await clickFix(activity)).toEqual({
			kind: 'console',
			error: 'NameError: name \'x\' is not defined',
			sessionId: 'python-1234',
			sessionName: 'Python 3.12.1',
			languageId: 'python',
			code: 'print(x)',
		});
	});

	it('sends no code when the activity has no input, e.g. once scrollback trimming removed it', async () => {
		const activity = new RuntimeItemActivity('activity', createError());

		expect(await clickFix(activity)).toMatchObject({ kind: 'console', code: undefined });
	});

	it('sends no code when the input is blank', async () => {
		const activity = new RuntimeItemActivity('activity', createInput('  \n'));
		activity.addActivityItem(createError());

		expect(await clickFix(activity)).toMatchObject({ kind: 'console', code: undefined });
	});
});
