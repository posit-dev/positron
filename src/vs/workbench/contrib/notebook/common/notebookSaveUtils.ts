/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { filter } from '../../../../base/common/objects.js';
import { hasKey } from '../../../../base/common/types.js';
import { ICellDto2 } from './notebookCommon.js';

/**
 * Remove execution counts from output metadata on a cell DTO
 * for more version control friendly notebooks.
 * Mutates the cell DTO in place.
 */
export function removeOutputExecutionCounts(cellData: ICellDto2): void {
	cellData.outputs = cellData.outputs.map(output => {
		if (!output.metadata || !hasKey(output.metadata, { executionCount: true })) {
			return output;
		}
		const metadata = filter(output.metadata, key => key !== 'executionCount');
		return { ...output, metadata: Object.keys(metadata).length > 0 ? metadata : undefined };
	});
}
