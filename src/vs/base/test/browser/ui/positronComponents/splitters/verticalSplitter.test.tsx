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
import { VerticalSplitter, VerticalSplitterResizeParams } from '../../../../../browser/ui/positronComponents/splitters/verticalSplitter.js';
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
 * that VerticalSplitter needs.
 */
function createMockServices(): { services: PositronReactServices; configChangeEmitter: Emitter<IConfigurationChangeEvent> } {
	const configChangeEmitter = new Emitter<IConfigurationChangeEvent>();

	const configurationService = {
		getValue: sinon.stub().callsFake((key: string) => {
			if (key === 'workbench.sash.size') { return 4; }
			if (key === 'workbench.sash.hoverDelay') { return 300; }
			return undefined;
		}),
		onDidChangeConfiguration: configChangeEmitter.event,
	} as Partial<IConfigurationService> as IConfigurationService;

	const services = { configurationService } as PositronReactServices;
	return { services, configChangeEmitter };
}

class VerticalSplitterFixture {
	constructor(private readonly container: HTMLElement) { }

	get splitter() {
		return this.container.querySelector<HTMLDivElement>('.vertical-splitter')!;
	}

	get sash() {
		return this.container.querySelector<HTMLDivElement>('.vertical-splitter .sash')!;
	}

	get expandCollapseButton() {
		return this.container.querySelector<HTMLButtonElement>('.expand-collapse-button');
	}

	get sashIndicator() {
		return this.container.querySelector<HTMLDivElement>('.sash-indicator');
	}
}

suite('VerticalSplitter', () => {
	const { render } = setupReactRenderer();
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let mockServices: PositronReactServices;
	let configChangeEmitter: Emitter<IConfigurationChangeEvent>;
	let onBeginResize: sinon.SinonStub<[], VerticalSplitterResizeParams>;
	let onResize: sinon.SinonStub;

	const defaultResizeParams: VerticalSplitterResizeParams = {
		startingWidth: 300,
		minimumWidth: 100,
		maximumWidth: 600,
	};

	setup(() => {
		const mock = createMockServices();
		mockServices = mock.services;
		configChangeEmitter = mock.configChangeEmitter;
		disposables.add(configChangeEmitter);

		onBeginResize = sinon.stub<[], VerticalSplitterResizeParams>().returns(defaultResizeParams);
		onResize = sinon.stub();
	});

	function renderSplitter(props?: {
		showSash?: boolean;
		invert?: boolean;
		collapsible?: boolean;
		isCollapsed?: boolean;
		onCollapsedChanged?: (collapsed: boolean) => void;
	}) {
		const container = render(
			<PositronReactServicesContext.Provider value={mockServices}>
				{props?.collapsible ? (
					<VerticalSplitter
						collapsible={true}
						invert={props?.invert}
						isCollapsed={props?.isCollapsed ?? false}
						showSash={props?.showSash}
						onBeginResize={onBeginResize}
						onCollapsedChanged={props?.onCollapsedChanged ?? sinon.stub()}
						onResize={onResize}
					/>
				) : (
					<VerticalSplitter
						invert={props?.invert}
						showSash={props?.showSash}
						onBeginResize={onBeginResize}
						onResize={onResize}
					/>
				)}
			</PositronReactServicesContext.Provider>
		);
		return new VerticalSplitterFixture(container);
	}

	suite('rendering', () => {
		test('renders the splitter and sash elements', () => {
			const fixture = renderSplitter();
			assert.ok(fixture.splitter, 'Should render the vertical-splitter container');
			assert.ok(fixture.sash, 'Should render the sash element');
		});

		test('does not render expand/collapse button when not collapsible', () => {
			const fixture = renderSplitter();
			assert.strictEqual(fixture.expandCollapseButton, null);
		});

		test('renders expand/collapse button when collapsible and collapsed', () => {
			const fixture = renderSplitter({ collapsible: true, isCollapsed: true });
			assert.ok(fixture.expandCollapseButton);
		});
	});

	suite('resize interaction', () => {
		test('calls onBeginResize on pointer down', () => {
			const fixture = renderSplitter();
			pointerEvent('pointerdown', fixture.sash, { clientX: 200, buttons: 1 });
			assert.strictEqual(onBeginResize.callCount, 1);
		});

		test('does not begin resize for non-left mouse button', () => {
			const fixture = renderSplitter();
			pointerEvent('pointerdown', fixture.sash, { clientX: 200, buttons: 2 });
			assert.strictEqual(onBeginResize.callCount, 0);
		});

		test('calls onResize with new width during drag', () => {
			const fixture = renderSplitter();
			const sash = fixture.sash;

			pointerEvent('pointerdown', sash, { clientX: 200, buttons: 1 });
			// Move right by 50px -> newWidth = 300 + 50 = 350
			pointerEvent('pointermove', sash, { clientX: 250 });

			assert.ok(onResize.called);
			assert.strictEqual(onResize.lastCall.args[0], 350);
		});

		test('inverts delta when invert is true', () => {
			const fixture = renderSplitter({ invert: true });
			const sash = fixture.sash;

			pointerEvent('pointerdown', sash, { clientX: 200, buttons: 1 });
			// Move right by 50px with invert -> newWidth = 300 - 50 = 250
			pointerEvent('pointermove', sash, { clientX: 250 });

			assert.ok(onResize.called);
			assert.strictEqual(onResize.lastCall.args[0], 250);
		});

		test('clamps width to minimum', () => {
			const fixture = renderSplitter();
			const sash = fixture.sash;

			pointerEvent('pointerdown', sash, { clientX: 200, buttons: 1 });
			// Move left 300px -> newWidth = 300 - 300 = 0, clamped to 100
			pointerEvent('pointermove', sash, { clientX: -100 });

			assert.strictEqual(onResize.lastCall.args[0], 100);
		});

		test('clamps width to maximum', () => {
			const fixture = renderSplitter();
			const sash = fixture.sash;

			pointerEvent('pointerdown', sash, { clientX: 200, buttons: 1 });
			// Move right 500px -> newWidth = 300 + 500 = 800, clamped to 600
			pointerEvent('pointermove', sash, { clientX: 700 });

			assert.strictEqual(onResize.lastCall.args[0], 600);
		});
	});

	suite('collapse', () => {
		test('calls onCollapsedChanged when dragged below half minimum width', () => {
			const onCollapsedChanged = sinon.stub();
			const fixture = renderSplitter({
				collapsible: true,
				isCollapsed: false,
				onCollapsedChanged,
			});
			const sash = fixture.sash;

			pointerEvent('pointerdown', sash, { clientX: 200, buttons: 1 });
			// Move left enough to go below minimumWidth/2 (50)
			// newWidth = 300 - 260 = 40 < 50 -> collapsed
			pointerEvent('pointermove', sash, { clientX: -60 });

			flushSync(() => { });
			assert.ok(onCollapsedChanged.calledWith(true));
		});
	});
});
