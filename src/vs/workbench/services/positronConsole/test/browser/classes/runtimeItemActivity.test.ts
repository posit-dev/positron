/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ActivityItemErrorMessage } from '../../../browser/classes/activityItemErrorMessage.js';
import { ActivityItemInput, ActivityItemInputState } from '../../../browser/classes/activityItemInput.js';
import { ActivityItemOutputMessage } from '../../../browser/classes/activityItemOutputMessage.js';
import { ActivityItemStream, ActivityItemStreamType } from '../../../browser/classes/activityItemStream.js';
import { RuntimeItemActivity } from '../../../browser/classes/runtimeItemActivity.js';

// A weight-1 activity item that never self-trims. ActivityItemErrorMessage fits: simple
// constructor, counts as 1 scrollback unit, and has no merge logic in addActivityItem.
const errItem = (id: string) =>
	new ActivityItemErrorMessage(id, 'parent', new Date(0), '', 'message', []);

// A multi-line activity item that can self-trim. ActivityItemOutputMessage slices its output
// lines to fit the incoming scrollbackSize, which makes it easy to construct an over-sized
// item and watch it shrink.
const linesItem = (id: string, lineCount: number) =>
	new ActivityItemOutputMessage(
		id,
		'parent',
		new Date(0),
		{ 'text/plain': Array.from({ length: lineCount }, (_, i) => `line${i}`).join('\n') }
	);

const stream = (id: string, parentId: string, text: string) =>
	new ActivityItemStream(id, parentId, new Date(0), ActivityItemStreamType.OUTPUT, text);

const input = (id: string, parentId: string, state: ActivityItemInputState, code = 'x') =>
	new ActivityItemInput(id, parentId, new Date(0), state, '>', '+', code);

suite('RuntimeItemActivity.trimScrollback', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('single weight-1 item that fits: no version bump, no splice', () => {
		const item = errItem('a');
		const activity = new RuntimeItemActivity('activity', item);
		const initialVersion = activity.version;

		const remaining = activity.trimScrollback(10);

		assert.strictEqual(remaining, 9, 'weight-1 item consumed one unit out of 10');
		assert.strictEqual(activity.activityItems.length, 1);
		assert.strictEqual(activity.version, initialVersion, 'no version bump when nothing trimmed');
	});

	test('single multi-line item that self-trims: bumps version without a splice', () => {
		// 5 output lines, scrollbackSize 2 -> item trims in place and fills the scrollback.
		const item = linesItem('a', 5);
		const activity = new RuntimeItemActivity('activity', item);
		const initialVersion = activity.version;

		const remaining = activity.trimScrollback(2);

		assert.strictEqual(remaining, 0, 'over-sized item consumed the full scrollbackSize');
		assert.strictEqual(activity.activityItems.length, 1, 'no splice - the trimming item is the only one');
		assert.strictEqual(activity.version, initialVersion + 1, 'version bumps because the item self-trimmed');
		assert.strictEqual(item.outputLines.length, 2, 'item was trimmed in-place to scrollbackSize');
	});

	test('multiple items all fit: no version bump, no splice', () => {
		const items = [errItem('a'), errItem('b'), errItem('c')];
		const activity = new RuntimeItemActivity('activity', items[0]);
		activity.addActivityItem(items[1]);
		activity.addActivityItem(items[2]);
		const baselineVersion = activity.version;

		const remaining = activity.trimScrollback(10);

		assert.strictEqual(remaining, 7, 'three weight-1 items consumed 3 units out of 10');
		assert.strictEqual(activity.activityItems.length, 3);
		assert.strictEqual(activity.version, baselineVersion, 'no trim occurred, no version bump');
	});

	test('scrollback exhausted mid-walk: splices older items and bumps version', () => {
		// Walking tail-first with scrollbackSize 2 over 3 weight-1 items: c fits (remaining=1),
		// b fits (remaining=0), loop exits before visiting a. firstKeepIndex=1 splices a.
		const items = [errItem('a'), errItem('b'), errItem('c')];
		const activity = new RuntimeItemActivity('activity', items[0]);
		activity.addActivityItem(items[1]);
		activity.addActivityItem(items[2]);
		const baselineVersion = activity.version;

		const remaining = activity.trimScrollback(2);

		assert.strictEqual(remaining, 0);
		assert.strictEqual(activity.activityItems.length, 2);
		assert.strictEqual(activity.activityItems[0].id, 'b', 'a was spliced off');
		assert.strictEqual(activity.activityItems[1].id, 'c');
		assert.strictEqual(activity.version, baselineVersion + 1, 'splice forces a version bump');
	});

	test('item self-trims AND scrollback exhausts: one version bump, not two', () => {
		// Walking tail-first with scrollbackSize 3: c fits weight-1 (remaining=2), b self-trims
		// to 2 lines and fills the rest (remaining=0). Loop exits at b; firstKeepIndex=1 splices
		// a. Both signals (b.trimmed AND splice) would independently bump version - assert
		// exactly one bump.
		const b = linesItem('b', 5);
		const activity = new RuntimeItemActivity('activity', errItem('a'));
		activity.addActivityItem(b);
		activity.addActivityItem(errItem('c'));
		const baselineVersion = activity.version;

		activity.trimScrollback(3);

		assert.strictEqual(activity.activityItems.length, 2, 'a spliced; b and c remain');
		assert.strictEqual(activity.activityItems[0].id, 'b');
		assert.strictEqual(activity.activityItems[1].id, 'c');
		assert.strictEqual(b.outputLines.length, 2, 'b was trimmed in place');
		assert.strictEqual(activity.version, baselineVersion + 1, 'exactly one bump');
	});

	test('non-positive scrollback size short-circuits: no work, no version bump', () => {
		const item = linesItem('a', 5);
		const activity = new RuntimeItemActivity('activity', item);
		const baselineVersion = activity.version;

		assert.strictEqual(activity.trimScrollback(0), 0);
		assert.strictEqual(activity.trimScrollback(-5), 0);
		assert.strictEqual(item.outputLines.length, 5, 'item untouched on the guard path');
		assert.strictEqual(activity.version, baselineVersion);
	});
});

suite('RuntimeItemActivity.addActivityItem - version bump semantics', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('stream-merge that absorbs (no newline): length unchanged, version still bumps', () => {
		// The second stream has no newline, so addActivityItemStream on the first returns
		// undefined and addActivityItem early-returns without pushing. _version must still
		// advance because content was appended into the existing stream.
		const first = stream('s1', 'p', 'hello');
		const activity = new RuntimeItemActivity('activity', first);
		const baselineVersion = activity.version;

		activity.addActivityItem(stream('s2', 'p', ' world'));

		assert.strictEqual(activity.activityItems.length, 1, 'second stream was absorbed into the first');
		assert.strictEqual(activity.version, baselineVersion + 1, 'absorbed merges must still bump version');
	});

	test('stream-merge across different parentIds: pushes as new item, bumps version', () => {
		const first = stream('s1', 'pA', 'hello');
		const activity = new RuntimeItemActivity('activity', first);
		const baselineVersion = activity.version;

		activity.addActivityItem(stream('s2', 'pB', ' world'));

		assert.strictEqual(activity.activityItems.length, 2, 'different parentId - no merge');
		assert.strictEqual(activity.version, baselineVersion + 1);
	});

	test('provisional ActivityItemInput replaced by non-provisional: in-place swap, version bumps', () => {
		const provisional = input('i1', 'p', ActivityItemInputState.Provisional);
		const activity = new RuntimeItemActivity('activity', provisional);
		const baselineVersion = activity.version;

		const executing = input('i2', 'p', ActivityItemInputState.Executing);
		activity.addActivityItem(executing);

		assert.strictEqual(activity.activityItems.length, 1, 'replacement, not append');
		assert.strictEqual(activity.activityItems[0], executing, 'slot now holds the new input');
		assert.strictEqual(executing.state, ActivityItemInputState.Executing, 'state not forced - prior was Provisional');
		assert.strictEqual(activity.version, baselineVersion + 1);
	});

	test('replacing an already-Completed input forces the new input to Completed', () => {
		// Simulates idle arriving before the input message: the ActivityItemInput already sitting
		// in the list is Completed. When the "real" Executing ActivityItemInput arrives later,
		// the replacement logic propagates the Completed state so the UI doesn't regress to
		// Executing.
		const alreadyCompleted = input('i1', 'p', ActivityItemInputState.Completed);
		const activity = new RuntimeItemActivity('activity', alreadyCompleted);
		const baselineVersion = activity.version;

		const executing = input('i2', 'p', ActivityItemInputState.Executing);
		activity.addActivityItem(executing);

		assert.strictEqual(activity.activityItems.length, 1);
		assert.strictEqual(activity.activityItems[0], executing, 'slot holds the replacement');
		assert.strictEqual(executing.state, ActivityItemInputState.Completed, 'Completed state propagated to replacement');
		assert.strictEqual(activity.version, baselineVersion + 1);
	});

	test('non-provisional input with no matching predecessor: plain append', () => {
		const activity = new RuntimeItemActivity('activity', stream('s1', 'p', 'hi'));
		const baselineVersion = activity.version;

		activity.addActivityItem(input('i1', 'p', ActivityItemInputState.Executing));

		assert.strictEqual(activity.activityItems.length, 2);
		assert.strictEqual(activity.version, baselineVersion + 1);
	});
});
