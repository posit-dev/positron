/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { renderHook } from '@testing-library/react';
import { CellProvider, useCell, useCodeCell } from '../../../browser/notebookCells/CellProvider.js';
import { IPositronNotebookCell, IPositronNotebookCodeCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';

describe('CellProvider', () => {
	it('exposes the cell to descendants via useCell()', () => {
		const fakeCell = stubInterface<IPositronNotebookCell>({});
		const { result } = renderHook(() => useCell(), {
			wrapper: ({ children }) => <CellProvider cell={fakeCell}>{children}</CellProvider>,
		});
		expect(result.current).toBe(fakeCell);
	});

	it('throws when not wrapped in a provider', () => {
		expect(() => renderHook(() => useCell())).toThrow('useCell must be used within a CellProvider');
	});
});

describe('useCodeCell', () => {
	it('returns the cell when it is a code cell', () => {
		const fakeCell = stubInterface<IPositronNotebookCodeCell>({
			// vi.fn() can't satisfy `() => this is T` type predicates
			isCodeCell: vi.fn().mockReturnValue(true) as never,
		});
		const { result } = renderHook(() => useCodeCell(), {
			wrapper: ({ children }) => <CellProvider cell={fakeCell}>{children}</CellProvider>,
		});
		expect(result.current).toBe(fakeCell);
	});

	it('throws when the cell is not a code cell', () => {
		const fakeCell = stubInterface<IPositronNotebookCell>({
			isCodeCell: vi.fn().mockReturnValue(false) as never,
		});
		expect(() => renderHook(() => useCodeCell(), {
			wrapper: ({ children }) => <CellProvider cell={fakeCell}>{children}</CellProvider>,
		})).toThrow('useCodeCell must be used within a code cell');
	});
});
