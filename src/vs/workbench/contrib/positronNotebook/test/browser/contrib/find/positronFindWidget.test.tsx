/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../../base/test/browser/react.js';
import { observableValue } from '../../../../../../../base/common/observable.js';
import { MockContextKeyService } from '../../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IContextViewService } from '../../../../../../../platform/contextview/browser/contextView.js';
import { unthemedInboxStyles } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { unthemedToggleStyles } from '../../../../../../../base/browser/ui/toggle/toggle.js';
import { PositronFindWidget, PositronFindWidgetProps } from '../../../../browser/contrib/find/PositronFindWidget.js';

suite('PositronFindWidget', () => {
	const { render, container } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	function renderWidget(overrides?: Partial<PositronFindWidgetProps>) {
		const props: PositronFindWidgetProps = {
			findText: observableValue('findText', ''),
			contextKeyService: new MockContextKeyService(),
			// ContextViewService is only used by FindInput for validation message
			// popups, which these tests don't trigger.
			contextViewService: {} as IContextViewService,
			matchCase: observableValue('matchCase', false),
			matchWholeWord: observableValue('matchWholeWord', false),
			useRegex: observableValue('useRegex', false),
			matchIndex: observableValue<number | undefined>('matchIndex', undefined),
			matchCount: observableValue<number | undefined>('matchCount', undefined),
			findInputOptions: {
				label: 'Find',
				inputBoxStyles: unthemedInboxStyles,
				toggleStyles: unthemedToggleStyles,
			},
			isVisible: observableValue('isVisible', true),
			inputFocused: observableValue('inputFocused', false),
			onPreviousMatch: sinon.stub(),
			onNextMatch: sinon.stub(),
			...overrides,
		};
		render(<PositronFindWidget {...props} />);
	}

	teardown(() => {
		sinon.restore();
	});

	suite('Rendering & Visibility', () => {
		test('renders when visible', () => {
			renderWidget();

			const widget = container().querySelector('.positron-find-widget.visible');
			assert.ok(widget, 'Expected .positron-find-widget.visible to exist');
		});

		test('hidden when not visible', () => {
			const isVisible = observableValue('isVisible', false);
			renderWidget({ isVisible });

			const widget = container().querySelector('.positron-find-widget');
			assert.ok(widget, 'Expected .positron-find-widget to exist');
			assert.ok(
				!widget.classList.contains('visible'),
				'Expected widget to lack .visible class'
			);
		});

		test('contains find input container', () => {
			renderWidget();

			const findInput = container().querySelector('.positron-find-widget .find-input-container');
			assert.ok(findInput, 'Expected .find-input-container to exist');
		});

		test('contains navigation buttons', () => {
			renderWidget();

			const navButtons = container().querySelector('.positron-find-widget .navigation-buttons');
			assert.ok(navButtons, 'Expected .navigation-buttons to exist');

			const buttons = navButtons.querySelectorAll('button.action-button');
			assert.strictEqual(buttons.length, 2, 'Expected 2 navigation buttons');
		});

		test('contains close button', () => {
			renderWidget();

			const closeButton = container().querySelector('.positron-find-widget button.close-button');
			assert.ok(closeButton, 'Expected close button to exist');
		});
	});

	suite('FindResult display', () => {
		test('shows "No results" when find text is empty', () => {
			renderWidget();

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, 'No results');
		});

		test('shows empty results when matchCount is undefined', () => {
			const findText = observableValue('findText', 'foo');
			const matchCount = observableValue<number | undefined>('matchCount', undefined);
			renderWidget({ findText, matchCount });

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, '');
		});

		test('shows "No results" with error styling when no matches', () => {
			const findText = observableValue('findText', 'foo');
			const matchCount = observableValue<number | undefined>('matchCount', 0);
			renderWidget({ findText, matchCount });

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, 'No results');

			const widget = container().querySelector('.positron-find-widget.no-results');
			assert.ok(widget, 'Expected widget to have .no-results class');
		});

		test('shows match count when matches exist', () => {
			const findText = observableValue('findText', 'foo');
			const matchCount = observableValue<number | undefined>('matchCount', 5);
			const matchIndex = observableValue<number | undefined>('matchIndex', 2);
			renderWidget({ findText, matchCount, matchIndex });

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, '3 of 5');
		});

		test('shows "1 of N" when matchIndex is undefined', () => {
			const findText = observableValue('findText', 'foo');
			const matchCount = observableValue<number | undefined>('matchCount', 3);
			const matchIndex = observableValue<number | undefined>('matchIndex', undefined);
			renderWidget({ findText, matchCount, matchIndex });

			const results = container().querySelector('.positron-find-widget .results');
			assert.ok(results, 'Expected .results to exist');
			assert.strictEqual(results.textContent, '1 of 3');
		});
	});

	suite('Navigation buttons', () => {
		test('previous match button disabled when no matches', () => {
			const matchCount = observableValue<number | undefined>('matchCount', 0);
			renderWidget({ matchCount });

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const prevButton = buttons[0] as HTMLButtonElement;
			assert.ok(prevButton, 'Expected previous button to exist');
			assert.strictEqual(prevButton.disabled, true, 'Expected previous button to be disabled');
		});

		test('next match button disabled when no matches', () => {
			const matchCount = observableValue<number | undefined>('matchCount', 0);
			renderWidget({ matchCount });

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const nextButton = buttons[1] as HTMLButtonElement;
			assert.ok(nextButton, 'Expected next button to exist');
			assert.strictEqual(nextButton.disabled, true, 'Expected next button to be disabled');
		});

		test('previous match button enabled when matches exist', () => {
			const matchCount = observableValue<number | undefined>('matchCount', 3);
			renderWidget({ matchCount });

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const prevButton = buttons[0] as HTMLButtonElement;
			assert.ok(prevButton, 'Expected previous button to exist');
			assert.strictEqual(prevButton.disabled, false, 'Expected previous button to be enabled');
		});

		test('next match button enabled when matches exist', () => {
			const matchCount = observableValue<number | undefined>('matchCount', 3);
			renderWidget({ matchCount });

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const nextButton = buttons[1] as HTMLButtonElement;
			assert.ok(nextButton, 'Expected next button to exist');
			assert.strictEqual(nextButton.disabled, false, 'Expected next button to be enabled');
		});

		test('previous match button calls onPreviousMatch', () => {
			const matchCount = observableValue<number | undefined>('matchCount', 3);
			const onPreviousMatch = sinon.stub();
			renderWidget({ matchCount, onPreviousMatch });

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const prevButton = buttons[0] as HTMLButtonElement;
			prevButton.click();

			assert.ok(onPreviousMatch.calledOnce, 'Expected onPreviousMatch to be called once');
		});

		test('next match button calls onNextMatch', () => {
			const matchCount = observableValue<number | undefined>('matchCount', 3);
			const onNextMatch = sinon.stub();
			renderWidget({ matchCount, onNextMatch });

			const buttons = container().querySelectorAll('.positron-find-widget .navigation-buttons button');
			const nextButton = buttons[1] as HTMLButtonElement;
			nextButton.click();

			assert.ok(onNextMatch.calledOnce, 'Expected onNextMatch to be called once');
		});
	});

	suite('Close button', () => {
		test('sets isVisible to false', () => {
			const isVisible = observableValue('isVisible', true);
			renderWidget({ isVisible });

			const closeButton = container().querySelector('.positron-find-widget button.close-button') as HTMLButtonElement;
			assert.ok(closeButton, 'Expected close button to exist');
			closeButton.click();

			assert.strictEqual(isVisible.get(), false, 'Expected isVisible to be false after close');
		});
	});

	suite('Tab order', () => {
		test('disabled navigation buttons are excluded from tab order', () => {
			const matchCount = observableValue<number | undefined>('matchCount', 0);
			renderWidget({ matchCount });

			const navButtons = container().querySelectorAll('.positron-find-widget .navigation-buttons button') as NodeListOf<HTMLButtonElement>;
			for (const btn of navButtons) {
				assert.strictEqual(btn.disabled, true, `Expected navigation button "${btn.ariaLabel}" to be disabled`);
			}

			// Close button should still be enabled
			const closeButton = container().querySelector('.positron-find-widget button.close-button') as HTMLButtonElement;
			assert.strictEqual(closeButton.disabled, false, 'Expected close button to remain enabled');
		});
	});

	suite('Reactivity', () => {
		test('re-renders when matchCount changes', () => {
			const findText = observableValue('findText', 'foo');
			const matchCount = observableValue<number | undefined>('matchCount', 3);
			const matchIndex = observableValue<number | undefined>('matchIndex', 0);
			renderWidget({ findText, matchCount, matchIndex });

			let results = container().querySelector('.positron-find-widget .results');
			assert.strictEqual(results?.textContent, '1 of 3');

			matchCount.set(5, undefined);
			renderWidget({ findText, matchCount, matchIndex });

			results = container().querySelector('.positron-find-widget .results');
			assert.strictEqual(results?.textContent, '1 of 5');
		});

		test('re-renders when findText changes', () => {
			const findText = observableValue('findText', '');
			renderWidget({ findText });

			let results = container().querySelector('.positron-find-widget .results');
			assert.strictEqual(results?.textContent, 'No results');

			findText.set('foo', undefined);
			renderWidget({ findText });

			results = container().querySelector('.positron-find-widget .results');
			assert.strictEqual(results?.textContent, '');
		});

		test('re-renders when visibility changes', () => {
			const isVisible = observableValue('isVisible', true);
			renderWidget({ isVisible });

			let widget = container().querySelector('.positron-find-widget');
			assert.ok(widget?.classList.contains('visible'), 'Expected widget to be visible');

			isVisible.set(false, undefined);
			renderWidget({ isVisible });

			widget = container().querySelector('.positron-find-widget');
			assert.ok(!widget?.classList.contains('visible'), 'Expected widget to not be visible');
		});
	});
});
