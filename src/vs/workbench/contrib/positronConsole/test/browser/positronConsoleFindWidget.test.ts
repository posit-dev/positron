/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-any-casts */

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { PositronConsoleFindWidget } from '../../browser/positronConsoleFind.js';

/**
 * Test subclass that exposes protected members for testing.
 */
class TestableConsoleFindWidget extends PositronConsoleFindWidget {
	async getResultCount() {
		return this._getResultCount();
	}

	testOnFindInputFocusTrackerFocus() {
		this._onFindInputFocusTrackerFocus();
	}

	testOnFindInputFocusTrackerBlur() {
		this._onFindInputFocusTrackerBlur();
	}
}

/**
 * Creates a console DOM structure with a visible .console-instance
 * containing div elements for each line.
 *
 * Each line can be a string (single text node) or an array of strings
 * (multiple span elements within one div, for cross-node matching tests).
 */
function createConsoleDOM(...lines: (string | string[])[]): HTMLElement {
	const container = document.createElement('div');
	const instance = document.createElement('div');
	instance.className = 'console-instance';
	instance.style.zIndex = '0';
	for (const line of lines) {
		const div = document.createElement('div');
		if (typeof line === 'string') {
			div.textContent = line;
		} else {
			for (const text of line) {
				const span = document.createElement('span');
				span.textContent = text;
				div.appendChild(span);
			}
		}
		instance.appendChild(div);
	}
	container.appendChild(instance);
	return container;
}

suite('PositronConsoleFindWidget', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let widget: TestableConsoleFindWidget;
	let consoleContainer: HTMLElement;
	let contextKeyService: MockContextKeyService;

	function createWidget(...lines: (string | string[])[]) {
		consoleContainer = createConsoleDOM(...lines);
		document.body.appendChild(consoleContainer);

		const instantiationService = workbenchInstantiationService(undefined, disposables);
		contextKeyService = instantiationService.get(IContextKeyService) as MockContextKeyService;
		widget = disposables.add(
			instantiationService.createInstance(TestableConsoleFindWidget)
		);
		// Attach the widget to the visible console instance element
		// (mirrors what ConsoleInstance does via useEffect).
		const instance = consoleContainer.querySelector('.console-instance')!;
		instance.appendChild(widget.getDomNode());
	}

	teardown(() => {
		consoleContainer?.remove();
	});

	suite('Search', () => {
		test('finds a simple match', async () => {
			createWidget('Hello world');
			widget.reveal('Hello');
			const result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 1);
		});

		test('finds multiple matches across lines', async () => {
			createWidget('apple', 'apple pie', 'banana');
			widget.reveal('apple');
			const result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 2);
		});

		test('finds multiple matches within one line', async () => {
			createWidget('cat cat cat');
			widget.reveal('cat');
			const result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 3);
		});

		test('matches across text nodes within one block element', async () => {
			createWidget(['hel', 'lo']);
			widget.reveal('hello');
			const result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 1);
		});

		test('does not match across different block elements', async () => {
			createWidget('hel', 'lo');
			widget.reveal('hello');
			const result = await widget.getResultCount();
			assert.strictEqual(result, undefined);
		});

		test('case-insensitive by default', async () => {
			createWidget('Hello HELLO hello');
			widget.reveal('hello');
			const result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 3);
		});

		test('case-sensitive when toggled', async () => {
			createWidget('Hello HELLO hello');
			(widget as any)._findInput.setCaseSensitive(true);
			widget.reveal('hello');
			const result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 1);
		});

		test('whole word matching', async () => {
			createWidget('cat concatenate cat');
			(widget as any)._findInput.setWholeWords(true);
			widget.reveal('cat');
			const result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 2);
		});

		test('regex matching', async () => {
			createWidget('foo123 bar456 baz');
			(widget as any)._findInput.setRegex(true);
			widget.reveal('[a-z]+\\d+');
			const result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 2);
		});

		test('invalid regex does not throw', async () => {
			createWidget('some text');
			(widget as any)._findInput.setRegex(true);
			widget.reveal('[invalid');
			const result = await widget.getResultCount();
			assert.strictEqual(result, undefined);
		});

		test('empty search produces no matches', async () => {
			createWidget('some text');
			widget.reveal('');
			const result = await widget.getResultCount();
			assert.strictEqual(result, undefined);
		});

		test('starts at last (bottom-most) match', async () => {
			createWidget('a', 'a', 'a');
			widget.reveal('a');
			const result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 3);
			assert.strictEqual(result?.resultIndex, 2);
		});

		test('only searches visible console instance', async () => {
			consoleContainer = document.createElement('div');

			// Hidden instance (zIndex -1)
			const hidden = document.createElement('div');
			hidden.className = 'console-instance';
			hidden.style.zIndex = '-1';
			const hiddenLine = document.createElement('div');
			hiddenLine.textContent = 'secret';
			hidden.appendChild(hiddenLine);
			consoleContainer.appendChild(hidden);

			// Visible instance (zIndex 0)
			const visible = document.createElement('div');
			visible.className = 'console-instance';
			visible.style.zIndex = '0';
			const visibleLine = document.createElement('div');
			visibleLine.textContent = 'visible';
			visible.appendChild(visibleLine);
			consoleContainer.appendChild(visible);

			document.body.appendChild(consoleContainer);

			const instantiationService = workbenchInstantiationService(undefined, disposables);
			contextKeyService = instantiationService.get(IContextKeyService) as MockContextKeyService;
			widget = disposables.add(
				instantiationService.createInstance(TestableConsoleFindWidget)
			);
			// Attach the widget to the visible instance
			// (mirrors what ConsoleInstance does via useEffect).
			visible.appendChild(widget.getDomNode());

			widget.reveal('secret');
			let result = await widget.getResultCount();
			assert.strictEqual(result, undefined, 'should not find text in hidden instance');

			widget.reveal('visible');
			result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 1, 'should find text in visible instance');
		});
	});

	suite('Navigation', () => {
		test('find(false) advances forward with wrapping', async () => {
			createWidget('a', 'a', 'a');
			widget.reveal('a');

			// Starts at last match (index 2)
			let result = await widget.getResultCount();
			assert.strictEqual(result?.resultIndex, 2);

			widget.find(false);
			result = await widget.getResultCount();
			assert.strictEqual(result?.resultIndex, 0, 'should wrap to first');

			widget.find(false);
			result = await widget.getResultCount();
			assert.strictEqual(result?.resultIndex, 1);

			widget.find(false);
			result = await widget.getResultCount();
			assert.strictEqual(result?.resultIndex, 2, 'should wrap back to last');
		});

		test('find(true) goes backward with wrapping', async () => {
			createWidget('a', 'a', 'a');
			widget.reveal('a');

			// Starts at last match (index 2)
			widget.find(true);
			let result = await widget.getResultCount();
			assert.strictEqual(result?.resultIndex, 1);

			widget.find(true);
			result = await widget.getResultCount();
			assert.strictEqual(result?.resultIndex, 0);

			widget.find(true);
			result = await widget.getResultCount();
			assert.strictEqual(result?.resultIndex, 2, 'should wrap to last');
		});

		test('find() is a no-op with no matches', async () => {
			createWidget('text');
			widget.reveal('nonexistent');
			widget.find(false);
			const result = await widget.getResultCount();
			assert.strictEqual(result, undefined);
		});

		test('findFirst() jumps to index 0', async () => {
			createWidget('a', 'a', 'a');
			widget.reveal('a');

			// Starts at index 2, move backward
			widget.find(true);
			let result = await widget.getResultCount();
			assert.strictEqual(result?.resultIndex, 1);

			widget.findFirst();
			result = await widget.getResultCount();
			assert.strictEqual(result?.resultIndex, 0);
		});

		test('findFirst() is a no-op with no matches', async () => {
			createWidget('text');
			widget.reveal('nonexistent');
			widget.findFirst();
			const result = await widget.getResultCount();
			assert.strictEqual(result, undefined);
		});
	});

	suite('Lifecycle', () => {
		test('reveal() sets visible context key', () => {
			createWidget('text');
			widget.reveal('test');
			assert.strictEqual(
				contextKeyService.getContextKeyValue('positronConsoleFindVisible'),
				true
			);
		});

		test('hide() clears matches and resets visible context key', async () => {
			createWidget('text');
			widget.reveal('text');

			let result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 1, 'should have a match before hide');

			widget.hide();
			result = await widget.getResultCount();
			assert.strictEqual(result, undefined, 'should have no matches after hide');
			assert.strictEqual(
				contextKeyService.getContextKeyValue('positronConsoleFindVisible'),
				false
			);
		});

		test('refreshSearch() re-runs search when visible', async () => {
			createWidget('word');
			widget.reveal('word');
			let result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 1);

			// Add another line with the search term
			const instance = consoleContainer.querySelector('.console-instance')!;
			const newLine = document.createElement('div');
			newLine.textContent = 'word';
			instance.appendChild(newLine);

			widget.refreshSearch();
			result = await widget.getResultCount();
			assert.strictEqual(result?.resultCount, 2);
		});

		test('refreshSearch() is a no-op when hidden', () => {
			createWidget('text');
			// Don't reveal - widget is hidden
			widget.refreshSearch();
			// Should not throw
		});
	});

	suite('Context Keys', () => {
		test('input focus tracker sets and resets findInputFocused', () => {
			createWidget('text');

			widget.testOnFindInputFocusTrackerFocus();
			assert.strictEqual(
				contextKeyService.getContextKeyValue('positronConsoleFindInputFocused'),
				true
			);

			widget.testOnFindInputFocusTrackerBlur();
			assert.strictEqual(
				contextKeyService.getContextKeyValue('positronConsoleFindInputFocused'),
				false
			);
		});
	});
});
