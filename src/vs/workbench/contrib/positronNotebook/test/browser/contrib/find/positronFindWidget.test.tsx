/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../../base/test/browser/react.js';
import { ISettableObservable, observableValue } from '../../../../../../../base/common/observable.js';
import { MockContextKeyService } from '../../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IContextViewService } from '../../../../../../../platform/contextview/browser/contextView.js';
import { unthemedInboxStyles } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { unthemedToggleStyles } from '../../../../../../../base/browser/ui/toggle/toggle.js';
import { PositronFindWidget, PositronFindWidgetProps } from '../../../../browser/contrib/find/PositronFindWidget.js';

class PositronFindWidgetFixture {
	constructor(public readonly container: HTMLDivElement) { }

	get results() {
		const el = this.container.querySelector('.results');
		assert.ok(el, 'Expected results element to exist');
		return el;
	}

	get navigationButtons() {
		return this.container.querySelectorAll<HTMLButtonElement>('.navigation-buttons button');
	}

	get previousButton() {
		const button = this.navigationButtons[0];
		assert.ok(button, 'Expected previous button to exist');
		return button;
	}

	get nextButton() {
		const button = this.navigationButtons[1];
		assert.ok(button, 'Expected next button to exist');
		return button;
	}

	get closeButton() {
		const button = this.container.querySelector<HTMLButtonElement>('button.close-button');
		assert.ok(button, 'Expected close button to exist');
		return button;
	}

	get isVisible() {
		return this.container.classList.contains('visible');
	}

	get hasErrorStyling() {
		return this.container.classList.contains('no-results');
	}
}

suite('PositronFindWidget', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	let findText: ISettableObservable<string>;
	let matchCase: ISettableObservable<boolean>;
	let matchWholeWord: ISettableObservable<boolean>;
	let useRegex: ISettableObservable<boolean>;
	let matchIndex: ISettableObservable<number | undefined>;
	let matchCount: ISettableObservable<number | undefined>;
	let isVisible: ISettableObservable<boolean>;
	let inputFocused: ISettableObservable<boolean>;
	let onPreviousMatch: sinon.SinonStub;
	let onNextMatch: sinon.SinonStub;

	function renderWidget(overrides?: Partial<PositronFindWidgetProps>) {
		const container = render(
			<PositronFindWidget
				contextKeyService={new MockContextKeyService()}
				// ContextViewService is only used by FindInput for validation message
				// popups, which these tests don't trigger.
				contextViewService={{} as IContextViewService}
				findInputOptions={{
					label: 'Find',
					inputBoxStyles: unthemedInboxStyles,
					toggleStyles: unthemedToggleStyles,
				}}
				findText={findText}
				inputFocused={inputFocused}
				isVisible={isVisible}
				matchCase={matchCase}
				matchCount={matchCount}
				matchIndex={matchIndex}
				matchWholeWord={matchWholeWord}
				useRegex={useRegex}
				onNextMatch={onNextMatch}
				onPreviousMatch={onPreviousMatch}
				{...overrides}
			/>
		);
		const widgetContainer = container.querySelector<HTMLDivElement>('.positron-find-widget');
		assert.ok(widgetContainer, 'Expected PositronFindWidget to be rendered');
		return new PositronFindWidgetFixture(widgetContainer);
	}

	setup(() => {
		findText = observableValue('findText', '');
		matchCase = observableValue('matchCase', false);
		matchWholeWord = observableValue('matchWholeWord', false);
		useRegex = observableValue('useRegex', false);
		matchIndex = observableValue<number | undefined>('matchIndex', undefined);
		matchCount = observableValue<number | undefined>('matchCount', undefined);
		isVisible = observableValue('isVisible', true);
		inputFocused = observableValue('inputFocused', false);
		onPreviousMatch = sinon.stub();
		onNextMatch = sinon.stub();
	});

	teardown(() => {
		sinon.restore();
	});

	test('is visible after first render', () => {
		const widget = renderWidget();

		assert.ok(widget.isVisible, 'Expected find widget to be visible');
	});

	test('no toggle replace button when useReplace is not set', () => {
		const widget = renderWidget();

		const toggle = widget.container.querySelector('.positron-find-widget button.toggle-replace');
		assert.strictEqual(toggle, null, 'Expected no toggle replace button');
	});

	test('hides when close button is clicked', () => {
		const widget = renderWidget();

		flushSync(() => widget.closeButton.click());

		assert.ok(!widget.isVisible, 'Expected find widget to be hidden after close');
		assert.ok(!isVisible.get(), 'Expected isVisible observable to be false after close');
	});

	test('hides when isVisible changes', () => {
		const widget = renderWidget();

		flushSync(() => isVisible.set(false, undefined));

		assert.ok(!widget.isVisible, 'Expected find widget to be hidden');
	});

	test('has no error styling when there is no query', () => {
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, 'No results');
		assert.ok(!widget.hasErrorStyling, 'Expected find widget to have no error styling without a query');
	});

	test('has error styling when there is a query but no matches', () => {
		findText.set('foo', undefined);
		matchCount.set(0, undefined);
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, 'No results');
		assert.ok(widget.hasErrorStyling, 'Expected find widget to indicate no results found');
	});

	test('shows empty results while matchCount is loading', () => {
		findText.set('foo', undefined);
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, '');
	});

	test('navigation buttons are disabled when there are no matches', () => {
		matchCount.set(0, undefined);
		const widget = renderWidget();

		assert.ok(widget.previousButton.disabled, 'Expected previous button to be disabled');
		assert.ok(widget.nextButton.disabled, 'Expected next button to be disabled');
	});

	test('previous match button calls onPreviousMatch', () => {
		matchCount.set(3, undefined);
		const widget = renderWidget();

		widget.previousButton.click();

		assert.ok(onPreviousMatch.calledOnce, 'Expected onPreviousMatch to be called once');
	});

	test('next match button calls onNextMatch', () => {
		matchCount.set(3, undefined);
		const widget = renderWidget();

		widget.nextButton.click();

		assert.ok(onNextMatch.calledOnce, 'Expected onNextMatch to be called once');
	});

	test('shows "1 of N" when matchIndex is undefined', () => {
		findText.set('foo', undefined);
		matchCount.set(3, undefined);
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, '1 of 3');
	});

	test('shows match index and count', () => {
		findText.set('foo', undefined);
		matchCount.set(5, undefined);
		matchIndex.set(2, undefined);
		const widget = renderWidget();

		assert.strictEqual(widget.results.textContent, '3 of 5');
	});

	suite('Replace', () => {
		let replaceExpanded: ISettableObservable<boolean>;
		let replaceText: ISettableObservable<string>;
		let preserveCase: ISettableObservable<boolean>;
		let replaceInputFocused: ISettableObservable<boolean>;
		let onReplace: sinon.SinonStub;
		let onReplaceAll: sinon.SinonStub;

		function renderReplaceWidget(overrides?: Partial<PositronFindWidgetProps>) {
			renderWidget({
				replace: {
					expanded: replaceExpanded,
					replaceText,
					preserveCase,
					replaceInputFocused,
					replaceInputOptions: {
						label: 'Replace',
						inputBoxStyles: unthemedInboxStyles,
						toggleStyles: unthemedToggleStyles,
					},
					onReplace,
					onReplaceAll,
				},
				...overrides,
			});
		}

		setup(() => {
			replaceExpanded = observableValue('replaceExpanded', false);
			replaceText = observableValue('replaceText', '');
			preserveCase = observableValue('preserveCase', false);
			replaceInputFocused = observableValue('replaceInputFocused', false);
			onReplace = sinon.stub();
			onReplaceAll = sinon.stub();
		});

		suite('Toggle behavior', () => {
			test('toggle button present when useReplace is true', () => {
				renderReplaceWidget();

				const toggle = container().querySelector('.positron-find-widget button.toggle-replace') as HTMLButtonElement;
				assert.ok(toggle, 'Expected toggle replace button to exist');
				assert.strictEqual(toggle.ariaLabel, 'Toggle Replace');
			});

			test('replace row hidden when collapsed', () => {
				replaceExpanded.set(false, undefined);
				renderReplaceWidget();

				const replacePart = container().querySelector('.positron-find-widget .replace-part');
				assert.strictEqual(replacePart, null, 'Expected replace row to not be in DOM when collapsed');
			});

			test('replace row visible when expanded', () => {
				replaceExpanded.set(true, undefined);
				renderReplaceWidget();

				const replacePart = container().querySelector('.positron-find-widget .replace-part');
				assert.ok(replacePart, 'Expected replace row to be in DOM when expanded');
			});

			test('clicking toggle expands/collapses replace', () => {
				renderReplaceWidget();

				const toggle = container().querySelector('.positron-find-widget button.toggle-replace') as HTMLButtonElement;
				assert.ok(toggle, 'Expected toggle button to exist');

				// Initially collapsed
				assert.strictEqual(replaceExpanded.get(), false);

				// Click to expand
				toggle.click();
				assert.strictEqual(replaceExpanded.get(), true, 'Expected replaceExpanded to be true after click');

				// Re-render to reflect new state, then click to collapse
				renderReplaceWidget();
				const toggle2 = container().querySelector('.positron-find-widget button.toggle-replace') as HTMLButtonElement;
				toggle2.click();
				assert.strictEqual(replaceExpanded.get(), false, 'Expected replaceExpanded to be false after second click');
			});
		});

		suite('Replace input', () => {
			test('replace input renders when expanded', () => {
				replaceExpanded.set(true, undefined);
				renderReplaceWidget();

				const replaceInput = container().querySelector('.positron-find-widget .replace-input-container');
				assert.ok(replaceInput, 'Expected .replace-input-container to exist');
			});
		});

		suite('Replace buttons', () => {
			test('replace button calls onReplace', () => {
				replaceExpanded.set(true, undefined);
				findText.set('foo', undefined);
				renderReplaceWidget();

				const replaceButton = container().querySelector('.positron-find-widget button.replace-button') as HTMLButtonElement;
				assert.ok(replaceButton, 'Expected replace button to exist');
				replaceButton.click();

				assert.ok(onReplace.calledOnce, 'Expected onReplace to be called once');
			});

			test('replace all button calls onReplaceAll', () => {
				replaceExpanded.set(true, undefined);
				findText.set('foo', undefined);
				renderReplaceWidget();

				const replaceAllButton = container().querySelector('.positron-find-widget button.replace-all-button') as HTMLButtonElement;
				assert.ok(replaceAllButton, 'Expected replace all button to exist');
				replaceAllButton.click();

				assert.ok(onReplaceAll.calledOnce, 'Expected onReplaceAll to be called once');
			});

			test('replace button has correct tooltip', () => {
				replaceExpanded.set(true, undefined);
				renderReplaceWidget();

				const replaceButton = container().querySelector('.positron-find-widget button.replace-button') as HTMLButtonElement;
				assert.ok(replaceButton, 'Expected replace button to exist');
				assert.strictEqual(replaceButton.ariaLabel, 'Replace');
			});

			test('replace all button has correct tooltip', () => {
				replaceExpanded.set(true, undefined);
				renderReplaceWidget();

				const replaceAllButton = container().querySelector('.positron-find-widget button.replace-all-button') as HTMLButtonElement;
				assert.ok(replaceAllButton, 'Expected replace all button to exist');
				assert.strictEqual(replaceAllButton.ariaLabel, 'Replace All');
			});

			test('replace buttons enabled when find text is non-empty', () => {
				replaceExpanded.set(true, undefined);
				findText.set('foo', undefined);
				matchCount.set(0, undefined);
				renderReplaceWidget();

				const replaceButton = container().querySelector('.positron-find-widget button.replace-button') as HTMLButtonElement;
				const replaceAllButton = container().querySelector('.positron-find-widget button.replace-all-button') as HTMLButtonElement;
				assert.strictEqual(replaceButton.disabled, false, 'Expected replace button to be enabled');
				assert.strictEqual(replaceAllButton.disabled, false, 'Expected replace all button to be enabled');
			});

			test('replace buttons disabled when find text is empty', () => {
				replaceExpanded.set(true, undefined);
				renderReplaceWidget();

				const replaceButton = container().querySelector('.positron-find-widget button.replace-button') as HTMLButtonElement;
				const replaceAllButton = container().querySelector('.positron-find-widget button.replace-all-button') as HTMLButtonElement;
				assert.strictEqual(replaceButton.disabled, true, 'Expected replace button to be disabled');
				assert.strictEqual(replaceAllButton.disabled, true, 'Expected replace all button to be disabled');
			});
		});

		suite('Toggle icon', () => {
			test('toggle icon is chevronRight when collapsed', () => {
				replaceExpanded.set(false, undefined);
				renderReplaceWidget();

				const toggle = container().querySelector('.positron-find-widget button.toggle-replace');
				assert.ok(toggle, 'Expected toggle button to exist');
				const icon = toggle.querySelector('.codicon-chevron-right');
				assert.ok(icon, 'Expected chevron-right icon when collapsed');
			});

			test('toggle icon is chevronDown when expanded', () => {
				replaceExpanded.set(true, undefined);
				renderReplaceWidget();

				const toggle = container().querySelector('.positron-find-widget button.toggle-replace');
				assert.ok(toggle, 'Expected toggle button to exist');
				const icon = toggle.querySelector('.codicon-chevron-down');
				assert.ok(icon, 'Expected chevron-down icon when expanded');
			});
		});
	});
});
