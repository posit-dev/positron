/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import React, { createRef } from 'react';
import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ColorScheme } from '../../../theme/common/theme.js';
import { TestColorTheme, TestThemeService } from '../../../theme/test/common/testThemeService.js';
import { PositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../base/browser/positronReactServices.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../base/test/browser/react.js';
import { DevErrorIcon, Icon, ThemeIcon, URIIcon } from '../../browser/components/icon.js';
import { asCssVariable } from '../../../theme/common/colorUtils.js';
import { editorErrorForeground } from '../../../theme/common/colorRegistry.js';

suite('ThemeIcon', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	function renderThemeIcon(element: React.ReactElement): HTMLDivElement {
		const container = render(element);
		const el = container.querySelector<HTMLDivElement>('div');
		assert.ok(el);
		return el;
	}

	test('renders codicon CSS classes from icon', () => {
		const el = renderThemeIcon(<ThemeIcon icon={Codicon.copy} />);
		assert.ok(el.classList.contains('codicon'));
		assert.ok(el.classList.contains('codicon-copy'));
	});

	test('merges additional className with icon classes', () => {
		const el = renderThemeIcon(<ThemeIcon className='my-custom-class' icon={Codicon.arrowUp} />);
		assert.ok(el.classList.contains('my-custom-class'));
		assert.ok(el.classList.contains('codicon'));
		assert.ok(el.classList.contains('codicon-arrow-up'));
	});

	test('forwards ref to the underlying div', () => {
		const ref = createRef<HTMLDivElement>();
		render(<ThemeIcon ref={ref} icon={Codicon.warning} />);
		assert.ok(ref.current);
		assert.strictEqual(ref.current.tagName, 'DIV');
		assert.ok(ref.current.classList.contains('codicon-warning'));
	});

	test('spreads HTML attributes onto the div', () => {
		const el = renderThemeIcon(
			<ThemeIcon aria-hidden='true' data-testid='icon' icon={Codicon.blank} />
		);
		assert.strictEqual(el.getAttribute('aria-hidden'), 'true');
		assert.strictEqual(el.getAttribute('data-testid'), 'icon');
	});

});

suite('URIIcon', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	let themeService: TestThemeService;
	let mockServices: PositronReactServices;

	setup(() => {
		themeService = new TestThemeService();
		mockServices = { themeService } as unknown as PositronReactServices;
	});

	const darkUri = URI.parse('https://example.com/dark-icon.png');
	const lightUri = URI.parse('https://example.com/light-icon.png');

	function renderURIIcon(element: React.ReactElement, colorScheme?: ColorScheme): HTMLDivElement {
		if (colorScheme !== undefined) {
			themeService.setTheme(new TestColorTheme({}, colorScheme));
		}
		const container = render(
			<PositronReactServicesContext.Provider value={mockServices}>
				{element}
			</PositronReactServicesContext.Provider>
		);
		const el = container.querySelector<HTMLDivElement>('div');
		assert.ok(el);
		return el;
	}

	test('renders dark icon in dark theme', () => {
		const el = renderURIIcon(
			<URIIcon icon={{ dark: darkUri, light: lightUri }} />,
			ColorScheme.DARK
		);
		assert.strictEqual(el.style.width, '16px');
		assert.strictEqual(el.style.height, '16px');
		assert.ok(el.style.backgroundImage.includes('dark-icon.png'), 'Should use dark URI');
	});

	test('renders light icon in light theme', () => {
		const el = renderURIIcon(
			<URIIcon icon={{ dark: darkUri, light: lightUri }} />,
			ColorScheme.LIGHT
		);
		assert.ok(el.style.backgroundImage.includes('light-icon.png'), 'Should use light URI');
	});

	test('falls back to dark icon when light is not provided in light theme', () => {
		const el = renderURIIcon(
			<URIIcon icon={{ dark: darkUri }} />,
			ColorScheme.LIGHT
		);
		assert.ok(el.style.backgroundImage.includes('dark-icon.png'), 'Should fallback to dark URI');
	});

	test('renders no background image when no URIs provided', () => {
		const el = renderURIIcon(
			<URIIcon icon={{}} />,
			ColorScheme.DARK
		);
		assert.strictEqual(el.style.backgroundImage, '', 'Should have no background image');
	});

	test('renders dark icon in high contrast dark theme', () => {
		const el = renderURIIcon(
			<URIIcon icon={{ dark: darkUri, light: lightUri }} />,
			ColorScheme.HIGH_CONTRAST_DARK
		);
		assert.ok(el.style.backgroundImage.includes('dark-icon.png'), 'Should use dark URI');
	});

	test('renders light icon in high contrast light theme', () => {
		const el = renderURIIcon(
			<URIIcon icon={{ dark: darkUri, light: lightUri }} />,
			ColorScheme.HIGH_CONTRAST_LIGHT
		);
		assert.ok(el.style.backgroundImage.includes('light-icon.png'), 'Should use light URI');
	});

	test('forwards ref to the underlying div', () => {
		const ref = createRef<HTMLDivElement>();
		renderURIIcon(<URIIcon ref={ref} icon={{ dark: darkUri }} />);
		assert.ok(ref.current);
		assert.strictEqual(ref.current.tagName, 'DIV');
	});

	test('merges className and style with icon styles', () => {
		const el = renderURIIcon(
			<URIIcon
				className='custom-uri-icon'
				icon={{ dark: darkUri }}
				style={{ border: '1px solid red' }}
			/>
		);
		assert.strictEqual(el.style.border, '1px solid red');
		assert.strictEqual(el.style.width, '16px');
	});

	test('spreads HTML attributes onto the div', () => {
		const el = renderURIIcon(
			<URIIcon aria-label='test icon' icon={{ dark: darkUri }} role='img' />
		);
		assert.strictEqual(el.getAttribute('aria-label'), 'test icon');
	});
});

suite('Icon', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	let mockServices: PositronReactServices;

	setup(() => {
		mockServices = { themeService: new TestThemeService() } as unknown as PositronReactServices;
	});

	function renderIcon(element: React.ReactElement): HTMLDivElement {
		const container = render(
			<PositronReactServicesContext.Provider value={mockServices}>
				{element}
			</PositronReactServicesContext.Provider>
		);
		const el = container.querySelector<HTMLDivElement>('div');
		assert.ok(el);
		return el;
	}

	test('delegates to ThemeIcon for codicon-based icons', () => {
		const el = renderIcon(<Icon icon={Codicon.copy} />);
		assert.ok(el.classList.contains('codicon-copy'), 'Should render a ThemeIcon with codicon-copy class');
	});

	test('delegates to URIIcon for URI-based icons', () => {
		const darkUri = URI.parse('https://example.com/icon.png');
		const el = renderIcon(<Icon icon={{ dark: darkUri }} />);
		assert.ok(el.style.backgroundImage, 'Should render a URIIcon with background image');
	});

	test('forwards ref for ThemeIcon path', () => {
		const ref = createRef<HTMLDivElement>();
		renderIcon(<Icon ref={ref} icon={Codicon.arrowDown} />);
		assert.ok(ref.current);
		assert.ok(ref.current.classList.contains('codicon-arrow-down'));
	});

	test('forwards ref for URIIcon path', () => {
		const ref = createRef<HTMLDivElement>();
		const darkUri = URI.parse('https://example.com/icon.png');
		renderIcon(<Icon ref={ref} icon={{ dark: darkUri }} />);
		assert.ok(ref.current);
		assert.ok(ref.current.style.backgroundImage);
	});

	test('passes className and additional props through for ThemeIcon path', () => {
		const el = renderIcon(
			<Icon aria-hidden='true' className='extra-class' icon={Codicon.warning} />
		);
		assert.ok(el.classList.contains('codicon-warning'));
		assert.strictEqual(el.getAttribute('aria-hidden'), 'true');
	});

	test('passes className and additional props through for URIIcon path', () => {
		const darkUri = URI.parse('https://example.com/icon.png');
		const el = renderIcon(
			<Icon aria-label='uri icon' className='uri-extra' data-testid='uri' icon={{ dark: darkUri }} />
		);
		assert.strictEqual(el.getAttribute('aria-label'), 'uri icon');
		assert.strictEqual(el.getAttribute('data-testid'), 'uri');
	});
});

suite('DevErrorIcon', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	let mockServices: PositronReactServices;

	setup(() => {
		mockServices = { themeService: new TestThemeService() } as unknown as PositronReactServices;
	});

	function renderDevErrorIcon(): HTMLDivElement {
		const container = render(
			<PositronReactServicesContext.Provider value={mockServices}>
				<DevErrorIcon />
			</PositronReactServicesContext.Provider>
		);
		const el = container.querySelector<HTMLDivElement>('div');
		assert.ok(el);
		return el;
	}

	test('renders with blank codicon and error background color', () => {
		const el = renderDevErrorIcon();
		assert.ok(el.classList.contains('codicon-blank'), 'Should render with codicon-blank class');
		assert.strictEqual(
			el.style.backgroundColor,
			asCssVariable(editorErrorForeground),
			'Should have error foreground background color'
		);
	});
});
