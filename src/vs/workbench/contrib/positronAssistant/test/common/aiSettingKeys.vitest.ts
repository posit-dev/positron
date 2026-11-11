/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAiSetting } from '../../common/aiSettingKeys.js';

describe('isAiSetting', () => {
	it('matches prefixed keys and exact keys only', () => {
		const keys = [
			'ai.allowed',
			'notebook.ai.enabled',
			'github.copilot.enable',
			'chat.disableAIFeatures',
			'editor.fontSize',
			'aiFoo',
			'chat.disableAIFeaturesExtra',
		];
		expect(keys.filter(isAiSetting)).toEqual([
			'ai.allowed',
			'notebook.ai.enabled',
			'github.copilot.enable',
			'chat.disableAIFeatures',
		]);
	});
});
