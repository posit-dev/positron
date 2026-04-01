/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { Emitter } from '../../../../../common/event.js';
import { setupReactRenderer } from '../../../react.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../common/utils.js';
import { HorizontalSplitter, HorizontalSplitterResizeParams } from '../../../../../browser/ui/positronComponents/splitters/horizontalSplitter.js';
import { PositronReactServicesContext } from '../../../../../browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../../browser/positronReactServices.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';

/**
 * Helper to create and dispatch pointer events on an element.
 */
function pointerEvent(type: string, el: Element, opts: PointerEventInit = {}) {
	el.dispatchEvent(new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		pointerType: 'mouse',
		...opts,
	}));
}

/**
 * Creates a minimal mock of PositronReactServices with only the configurationService
 * that HorizontalSplitter needs.
 */
function createMockServices(): { services: PositronReactServices; configChangeEmitter: Emitter<IConfigurationChangeEvent> } {
	const configChangeEmitter = new Emitter<IConfigurationChangeEvent>();

	const configurationService = {
		getValue: sinon.stub().callsFake((key: string) => {
			if (key === 'workbench.sash.hoverDelay') { return 300; }
			return undefined;
		}),
		onDidChangeConfiguration: configChangeEmitter.event,
	} as Partial<IConfigurationService> as IConfigurationService;

	const services = { configurationService } as PositronReactServices;
	return { services, configChangeEmitter };
}

class HorizontalSplitterFixture {
	constructor(private readonly container: HTMLElement) { }

	get splitter() {
		return this.container.querySelector<HTMLDivElement>('.horizontal-splitter')!;
	}

	get sizer() {
		return this.container.querySelector<HTMLDivElement>('.horizontal-splitter .sizer')!;
	}
}

suite('HorizontalSplitter', () => {
	const { render } = setupReactRenderer();
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let mockServices: PositronReactServices;
	let configChangeEmitter: Emitter<IConfigurationChangeEvent>;
	let onBeginResize: sinon.SinonStub<[], HorizontalSplitterResizeParams>;
	let onResize: sinon.SinonStub;
	let onDoubleClick: sinon.SinonStub;

	const defaultResizeParams: HorizontalSplitterResizeParams = {
		startingHeight: 200,
		minimumHeight: 50,
		maximumHeight: 400,
	};

	setup(() => {
		const mock = createMockServices();
		mockServices = mock.services;
		configChangeEmitter = mock.configChangeEmitter;
		disposables.add(configChangeEmitter);

		onBeginResize = sinon.stub<[], HorizontalSplitterResizeParams>().returns(defaultResizeParams);
		onResize = sinon.stub();
		onDoubleClick = sinon.stub();
	});

	function renderSplitter(props?: { showResizeIndicator?: boolean }) {
		const container = render(
			<PositronReactServicesContext.Provider value={mockServices}>
				<HorizontalSplitter
					showResizeIndicator={props?.showResizeIndicator}
					onBeginResize={onBeginResize}
					onDoubleClick={onDoubleClick}
					onResize={onResize}
				/>
			</PositronReactServicesContext.Provider>
		);
		return new HorizontalSplitterFixture(container);
	}

	suite('rendering', () => {
		test('renders the splitter and sizer elements', () => {
			const fixture = renderSplitter();
			assert.ok(fixture.splitter, 'Should render the horizontal-splitter container');
			assert.ok(fixture.sizer, 'Should render the sizer element');
		});

		test('sizer does not have resizing class by default', () => {
			const fixture = renderSplitter({ showResizeIndicator: true });
			assert.ok(!fixture.sizer.classList.contains('resizing'));
		});
	});

	suite('resize interaction', () => {
		test('calls onBeginResize on pointer down', () => {
			const fixture = renderSplitter();
			pointerEvent('pointerdown', fixture.sizer, { clientY: 100, buttons: 1 });
			assert.strictEqual(onBeginResize.callCount, 1);
		});

		test('does not begin resize for non-left mouse button', () => {
			const fixture = renderSplitter();
			pointerEvent('pointerdown', fixture.sizer, { clientY: 100, buttons: 2 });
			assert.strictEqual(onBeginResize.callCount, 0);
		});

		test('calls onResize with new height during drag', () => {
			const fixture = renderSplitter();
			const sizer = fixture.sizer;

			pointerEvent('pointerdown', sizer, { clientY: 100, buttons: 1 });
			pointerEvent('pointermove', sizer, { clientY: 150 });

			assert.ok(onResize.called, 'onResize should have been called');
			assert.strictEqual(onResize.lastCall.args[0], 250);
		});

		test('clamps height to minimum', () => {
			const fixture = renderSplitter();
			const sizer = fixture.sizer;

			pointerEvent('pointerdown', sizer, { clientY: 100, buttons: 1 });
			pointerEvent('pointermove', sizer, { clientY: -100 });

			assert.strictEqual(onResize.lastCall.args[0], 50);
		});

		test('clamps height to maximum', () => {
			const fixture = renderSplitter();
			const sizer = fixture.sizer;

			pointerEvent('pointerdown', sizer, { clientY: 100, buttons: 1 });
			pointerEvent('pointermove', sizer, { clientY: 400 });

			assert.strictEqual(onResize.lastCall.args[0], 400);
		});

		test('does not call onResize on release without drag', () => {
			const fixture = renderSplitter();
			const sizer = fixture.sizer;

			pointerEvent('pointerdown', sizer, { clientY: 100, buttons: 1 });
			pointerEvent('lostpointercapture', sizer, { clientY: 100 });

			assert.strictEqual(onResize.callCount, 0,
				'onResize should not be called on click without drag');
		});

		test('calls onResize on release after drag', () => {
			const fixture = renderSplitter();
			const sizer = fixture.sizer;

			pointerEvent('pointerdown', sizer, { clientY: 100, buttons: 1 });
			pointerEvent('pointermove', sizer, { clientY: 150 });
			const resizeCountAfterMove = onResize.callCount;

			pointerEvent('lostpointercapture', sizer, { clientY: 160 });

			assert.ok(onResize.callCount > resizeCountAfterMove,
				'onResize should be called once more on release');
			assert.strictEqual(onResize.lastCall.args[0], 260);
		});

		test('adds resizing class during drag when showResizeIndicator is true', () => {
			const fixture = renderSplitter({ showResizeIndicator: true });
			const sizer = fixture.sizer;

			pointerEvent('pointerdown', sizer, { clientY: 100, buttons: 1 });
			flushSync(() => { });
			assert.ok(sizer.classList.contains('resizing'), 'Should have resizing class during drag');

			flushSync(() => {
				pointerEvent('lostpointercapture', sizer, { clientY: 100 });
			});
			assert.ok(!sizer.classList.contains('resizing'), 'Should not have resizing class after drag');
		});
	});

	suite('double-click', () => {
		test('calls onDoubleClick handler', () => {
			const fixture = renderSplitter();
			fixture.sizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
			assert.strictEqual(onDoubleClick.callCount, 1);
		});
	});

	suite('hover', () => {
		test('does not have hovering class by default', () => {
			const fixture = renderSplitter({ showResizeIndicator: true });
			assert.ok(!fixture.sizer.classList.contains('hovering'));
		});

		test('shows hovering class immediately during drag', () => {
			const fixture = renderSplitter({ showResizeIndicator: true });
			const sizer = fixture.sizer;

			pointerEvent('pointerdown', sizer, { clientY: 100, buttons: 1 });
			flushSync(() => { });
			assert.ok(sizer.classList.contains('hovering'), 'Should hover immediately during drag');
		});

		test('removes hovering class after drag ends', () => {
			const fixture = renderSplitter({ showResizeIndicator: true });
			const sizer = fixture.sizer;

			pointerEvent('pointerdown', sizer, { clientY: 100, buttons: 1 });
			flushSync(() => { });
			assert.ok(sizer.classList.contains('hovering'));

			flushSync(() => {
				pointerEvent('lostpointercapture', sizer, { clientY: 100 });
			});
			assert.ok(!sizer.classList.contains('hovering'), 'Should remove hovering after drag');
		});
	});
});
