/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { logMetric } from './api.js';
import { MultiLogger, ConsoleLogger } from '../../infra/logger.js';
import { setSpecName } from '../../fixtures/test-setup/constants.js';

// Test script to verify spec_name is automatically included
async function testSpecName() {
	// Simulate setting a spec name like in a real test
	setSpecName('test-data-explorer-csv.spec.ts');

	const logger = new MultiLogger([new ConsoleLogger()]);

	// Test with explicit spec_name
	await logMetric({
		feature_area: 'data_explorer',
		action: 'load_data',
		target_type: 'file.csv',
		duration_ms: 150,
		target_description: 'Loading CSV file',
		spec_name: 'custom-spec-name.spec.ts'
	}, true, logger);

	// Test without explicit spec_name (should use global SPEC_NAME)
	await logMetric({
		feature_area: 'data_explorer',
		action: 'filter',
		target_type: 'file.csv',
		duration_ms: 75,
		target_description: 'Filtering CSV data'
	}, true, logger);
}

// Export for testing purposes
export { testSpecName };
}
}

// Export for testing purposes
export { testSpecName };
