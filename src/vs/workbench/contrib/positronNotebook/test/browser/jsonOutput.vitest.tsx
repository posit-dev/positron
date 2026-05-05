/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { render, screen } from '@testing-library/react';
import { JsonOutput } from '../../browser/notebookCells/JsonOutput.js';

describe('JsonOutput', () => {
	it('renders object with syntax-highlighted tokens', () => {
		render(<JsonOutput data={{ name: 'test', count: 42, active: true, value: null }} />);

		const pre = screen.getByText((_content, element) =>
			element?.tagName === 'PRE' && element.classList.contains('json-output')
		);
		expect(pre).toBeInTheDocument();

		// Keys
		expect(screen.getByText('"name"', { selector: '.json-key' })).toBeInTheDocument();
		expect(screen.getByText('"count"', { selector: '.json-key' })).toBeInTheDocument();
		expect(screen.getByText('"active"', { selector: '.json-key' })).toBeInTheDocument();
		expect(screen.getByText('"value"', { selector: '.json-key' })).toBeInTheDocument();

		// Values
		expect(screen.getByText('"test"', { selector: '.json-string' })).toBeInTheDocument();
		expect(screen.getByText('42', { selector: '.json-number' })).toBeInTheDocument();
		expect(screen.getByText('true', { selector: '.json-boolean' })).toBeInTheDocument();
		expect(screen.getByText('null', { selector: '.json-null' })).toBeInTheDocument();
	});

	it('renders arrays', () => {
		render(<JsonOutput data={[1, 'two', false]} />);

		expect(screen.getByText('1', { selector: '.json-number' })).toBeInTheDocument();
		expect(screen.getByText('"two"', { selector: '.json-string' })).toBeInTheDocument();
		expect(screen.getByText('false', { selector: '.json-boolean' })).toBeInTheDocument();
	});

	it('renders nested structures', () => {
		render(<JsonOutput data={{ nested: { deep: 'value' } }} />);

		expect(screen.getByText('"nested"', { selector: '.json-key' })).toBeInTheDocument();
		expect(screen.getByText('"deep"', { selector: '.json-key' })).toBeInTheDocument();
		expect(screen.getByText('"value"', { selector: '.json-string' })).toBeInTheDocument();
	});

	it('renders primitive values at top level', () => {
		render(<JsonOutput data='just a string' />);

		expect(screen.getByText('"just a string"', { selector: '.json-string' })).toBeInTheDocument();
	});
});
