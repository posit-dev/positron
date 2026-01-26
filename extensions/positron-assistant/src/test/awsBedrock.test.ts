/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AWSModelProvider } from '../providers/aws/awsBedrockProvider';

suite('AWSModelProvider', () => {
	suite('deriveInferenceProfileRegion', () => {
		test('returns "us" for us-east-1', () => {
			const result = AWSModelProvider.deriveInferenceProfileRegion('us-east-1');
			assert.strictEqual(result, 'us');
		});

		test('returns "apac" for ap-northeast-1', () => {
			const result = AWSModelProvider.deriveInferenceProfileRegion('ap-northeast-1');
			assert.strictEqual(result, 'apac');
		});
	});
});
