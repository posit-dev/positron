/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export * from './base.js';
export * from './api.js';

// Recordable features
export * from './data-explorer.js';
export * from './notebooks.js';

// Combined types for backward compatibility
import type { DataExplorerMetric } from './data-explorer.js';
import type { NotebookMetric } from './notebooks.js';

export type PerfMetric = DataExplorerMetric | NotebookMetric;
