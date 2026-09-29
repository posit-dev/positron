/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { ActivityItemStream, ActivityItemStreamType } from '../../../../services/positronConsole/browser/classes/activityItemStream.js';
import { ActivityErrorStream } from '../../browser/components/activityErrorStream.js';

/**
 * Regression test for a console UX bug: a kernel writing a bare newline to
 * stderr while handling an interrupt (e.g. during a restart) rendered as an
 * empty row in the transcript. During a slow exit, that blank row sits there
 * with nothing else happening, reading as a layout bug rather than the
 * meaningless stream chunk it actually is.
 */
describe('ActivityErrorStream', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function createStream(text: string): ActivityItemStream {
		return new ActivityItemStream(
			'stream-id', 'parent-id', new Date(), ActivityItemStreamType.ERROR, text);
	}

	it('renders nothing for a chunk with no visible characters', () => {
		const { container } = rtl.render(
			<ActivityErrorStream activityItemStream={createStream('\n')} />
		);
		expect(container).toBeEmptyDOMElement();
	});

	it('renders normally for a chunk with real content', () => {
		const { container } = rtl.render(
			<ActivityErrorStream activityItemStream={createStream('a problem occurred\n')} />
		);
		expect(container).toHaveTextContent('a problem occurred');
	});
});
