/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isSameWebviewFrame } from '../../common/webviewManagerService.js';

describe('isSameWebviewFrame', () => {
	it('follows a frame to another document by its place in the frame tree', () => {
		// The Viewer's app frame, before a link takes it to another document.
		const frame = { processId: 11, routingId: 6, frameTreeNodeId: 42 };

		expect({
			navigated: isSameWebviewFrame({ processId: 12, routingId: 9, frameTreeNodeId: 42 }, frame),
			otherFrame: isSameWebviewFrame({ processId: 11, routingId: 7, frameTreeNodeId: 43 }, frame),
			noTreeNode: isSameWebviewFrame({ processId: 11, routingId: 6 }, frame),
			noTreeNodeOtherFrame: isSameWebviewFrame({ processId: 11, routingId: 7 }, frame),
		}).toEqual({ navigated: true, otherFrame: false, noTreeNode: true, noTreeNodeOtherFrame: false });
	});
});
