/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { JsonOutput } from '../../browser/notebookCells/JsonOutput.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
describe('JsonOutput', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders object keys and string values', () => {
		rtl.render(<JsonOutput data={{ name: 'test', count: 42 }} />);

		expect(screen.getByText('name:', { selector: '.json-key' })).toBeInTheDocument();
		expect(screen.getByText('"test"', { selector: '.json-string' })).toBeInTheDocument();
		expect(screen.getByText('42', { selector: '.json-number' })).toBeInTheDocument();
	});

	it('renders booleans and null', () => {
		rtl.render(<JsonOutput data={{ active: true, value: null }} />);

		expect(screen.getByText('true', { selector: '.json-boolean' })).toBeInTheDocument();
		expect(screen.getByText('null', { selector: '.json-null' })).toBeInTheDocument();
	});

	it('renders arrays without key names on items', () => {
		rtl.render(<JsonOutput data={[1, 'two', false]} />);

		expect(screen.getByText('1', { selector: '.json-number' })).toBeInTheDocument();
		expect(screen.getByText('"two"', { selector: '.json-string' })).toBeInTheDocument();
		expect(screen.getByText('false', { selector: '.json-boolean' })).toBeInTheDocument();
	});

	it('renders nested structures with collapsible nodes', () => {
		rtl.render(<JsonOutput data={{ nested: { deep: 'value' } }} />);

		expect(screen.getByText('nested:', { selector: '.json-key' })).toBeInTheDocument();
		expect(screen.getByText('deep:', { selector: '.json-key' })).toBeInTheDocument();
		expect(screen.getByText('"value"', { selector: '.json-string' })).toBeInTheDocument();
	});

	it('collapses and expands on click', async () => {
		const user = userEvent.setup();
		rtl.render(<JsonOutput data={{ items: [1, 2, 3] }} />);

		// Items should be visible initially
		expect(screen.getByText('1', { selector: '.json-number' })).toBeInTheDocument();

		// Click the collapsible header for the 'items' array
		const header = screen.getByText('items:', { selector: '.json-key' }).closest('.json-collapsible-header')!;
		await user.click(header);

		// Items should be hidden, preview shown
		expect(screen.queryByText('1', { selector: '.json-number' })).not.toBeInTheDocument();
		expect(screen.getByText(/3 items/)).toBeInTheDocument();

		// Click again to expand
		await user.click(header);
		expect(screen.getByText('1', { selector: '.json-number' })).toBeInTheDocument();
	});


	it('renders empty objects compactly', () => {
		rtl.render(<JsonOutput data={{ empty: {} }} />);

		expect(screen.getByText('empty:', { selector: '.json-key' })).toBeInTheDocument();
		expect(screen.getByText('{}', { selector: '.json-punct' })).toBeInTheDocument();
	});

	it('renders primitive values at top level', () => {
		rtl.render(<JsonOutput data='just a string' />);

		expect(screen.getByText('"just a string"', { selector: '.json-string' })).toBeInTheDocument();
	});

	it('marks the root element with the output id', () => {
		rtl.render(<JsonOutput data={{ value: 1 }} outputId='output-123' />);

		const output = screen.getByText('value:', { selector: '.json-key' }).closest('.json-output');
		expect(output).toHaveAttribute('data-positron-json-output-id', 'output-123');
	});

	it('truncates long strings and expands on click', async () => {
		const user = userEvent.setup();
		const longStr = 'x'.repeat(200);
		rtl.render(<JsonOutput data={{ msg: longStr }} />);

		// Should be truncated -- full string not present
		expect(screen.queryByText(`"${longStr}"`, { selector: '.json-string' })).not.toBeInTheDocument();

		// "more" button with descriptive aria-label
		const expandBtn = screen.getByRole('button', { name: /expand to see all 200 characters/i });
		expect(expandBtn).toHaveTextContent('more');

		// Click to expand
		await user.click(expandBtn);
		expect(screen.getByText(`"${longStr}"`, { selector: '.json-string' })).toBeInTheDocument();
		expect(expandBtn).toHaveTextContent('less');
		expect(expandBtn).toHaveAttribute('aria-expanded', 'true');
	});
});
