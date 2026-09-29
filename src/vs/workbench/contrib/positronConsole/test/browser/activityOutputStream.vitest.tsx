/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { ActivityItemStream, ActivityItemStreamType } from '../../../../services/positronConsole/browser/classes/activityItemStream.js';
import { ActivityOutputStream } from '../../browser/components/activityOutputStream.js';

/** See activityErrorStream.vitest.tsx; same rule applies to stdout chunks. */
describe('ActivityOutputStream', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function createStream(text: string): ActivityItemStream {
		return new ActivityItemStream(
			'stream-id', 'parent-id', new Date(), ActivityItemStreamType.OUTPUT, text);
	}

	it('renders nothing for a chunk with no visible characters', () => {
		const { container } = rtl.render(
			<ActivityOutputStream activityItemStream={createStream('\n')} />
		);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders normally for a chunk with real content', () => {
		const { container } = rtl.render(
			<ActivityOutputStream activityItemStream={createStream('hello\n')} />
		);
		expect(container).toHaveTextContent('hello');
	});
});
