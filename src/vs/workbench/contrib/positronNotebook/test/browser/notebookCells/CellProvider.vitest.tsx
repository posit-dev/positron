/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { renderHook } from '@testing-library/react';
import { CellProvider, useCell } from '../../../browser/notebookCells/CellProvider.js';
import { IPositronNotebookCodeCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';

describe('CellProvider', () => {
	it('exposes the cell to descendants via useCell()', () => {
		const fakeCell = stubInterface<IPositronNotebookCodeCell>({});
		const { result } = renderHook(() => useCell(), {
			wrapper: ({ children }) => <CellProvider cell={fakeCell}>{children}</CellProvider>,
		});
		expect(result.current).toBe(fakeCell);
	});

	it('returns undefined when not wrapped in a provider', () => {
		const { result } = renderHook(() => useCell());
		expect(result.current).toBeUndefined();
	});
});
