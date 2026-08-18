/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRange } from '../../../../editor/common/core/range.js';
import { DocumentSymbol } from '../../../../editor/common/languages.js';

/**
 * One cell's symbols, and where that cell's code sits in the source document.
 *
 * This is the answer shape of `_executeQuartoCellSymbolProvider`, so it lives in
 * `common` rather than beside the implementation: the extension host converter
 * behind `positron.executeQuartoCellSymbolProvider` has to describe the same
 * shape, and `api/common` cannot import from `positronQuarto/browser`.
 */
export interface IQuartoCellSymbols {
	/** The cell's code span in source coordinates, fences excluded. */
	readonly range: IRange;

	/** Already remapped into source coordinates. Never empty. */
	readonly symbols: DocumentSymbol[];
}
