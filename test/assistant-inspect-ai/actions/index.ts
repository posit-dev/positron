/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SampleActions, ActionContext } from './types';

// Import all sample action modules
// Add new samples here as they are created
import { actions as sample_1 } from './sample_1';
import { actions as sample_2 } from './sample_2';
import { actions as sample_3 } from './sample_3';
import { actions as sample_4 } from './sample_4';
import { actions as notebook_1 } from './notebook_1';
import { actions as notebook_2 } from './notebook_2';
import { actions as notebook_3 } from './notebook_3';
import { actions as notebook_4 } from './notebook_4';
import { actions as notebook_5 } from './notebook_5';

/**
 * Registry of all sample actions, keyed by sample ID.
 * Add new entries here when creating new samples.
 */
const actionsRegistry: Record<string, SampleActions> = {
	sample_1,
	sample_2,
	sample_3,
	sample_4,
	notebook_1,
	notebook_2,
	notebook_3,
	notebook_4,
	notebook_5,
};

/**
 * Gets the actions for a specific sample ID.
 * Returns an empty object if no actions are defined for the sample.
 */
export function getActionsForSample(sampleId: string): SampleActions {
	return actionsRegistry[sampleId] || {};
}

export { SampleActions, ActionContext };
