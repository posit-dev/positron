/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { RuntimeItemActivity } from '../../../browser/classes/runtimeItemActivity.js';
import { ActivityItemErrorMessage } from '../../../browser/classes/activityItemErrorMessage.js';
import { ActivityItemOutputMessage } from '../../../browser/classes/activityItemOutputMessage.js';
import { ActivityItemInput, ActivityItemInputState } from '../../../browser/classes/activityItemInput.js';
import { ActivityItemStream, ActivityItemStreamType } from '../../../browser/classes/activityItemStream.js';

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

describe('RuntimeItemActivity.trimScrollback', () => {

	it('single weight-1 item that fits: no version bump, no splice', () => {
		const item = errItem('a');
		const activity = new RuntimeItemActivity('activity', item);
		const initialVersion = activity.version;

		const remaining = activity.trimScrollback(10);

		expect(remaining, 'weight-1 item consumed one unit out of 10').toBe(9);
		expect(activity.activityItems.length).toBe(1);
		expect(activity.version, 'no version bump when nothing trimmed').toBe(initialVersion);
	});

	it('single multi-line item that self-trims: bumps version without a splice', () => {
		// 5 output lines, scrollbackSize 2 -> item trims in place and fills the scrollback.
		const item = linesItem('a', 5);
		const activity = new RuntimeItemActivity('activity', item);
		const initialVersion = activity.version;

		const remaining = activity.trimScrollback(2);

		expect(remaining, 'over-sized item consumed the full scrollbackSize').toBe(0);
		expect(activity.activityItems.length, 'no splice - the trimming item is the only one').toBe(1);
		expect(activity.version, 'version bumps because the item self-trimmed').toBe(initialVersion + 1);
		expect(item.outputLines.length, 'item was trimmed in-place to scrollbackSize').toBe(2);
	});

	it('multiple items all fit: no version bump, no splice', () => {
		const items = [errItem('a'), errItem('b'), errItem('c')];
		const activity = new RuntimeItemActivity('activity', items[0]);
		activity.addActivityItem(items[1]);
		activity.addActivityItem(items[2]);
		const baselineVersion = activity.version;

		const remaining = activity.trimScrollback(10);

		expect(remaining, 'three weight-1 items consumed 3 units out of 10').toBe(7);
		expect(activity.activityItems.length).toBe(3);
		expect(activity.version, 'no trim occurred, no version bump').toBe(baselineVersion);
	});

	it('scrollback exhausted mid-walk: splices older items and bumps version', () => {
		// Walking tail-first with scrollbackSize 2 over 3 weight-1 items: c fits (remaining=1),
		// b fits (remaining=0), loop exits before visiting a. firstKeepIndex=1 splices a.
		const items = [errItem('a'), errItem('b'), errItem('c')];
		const activity = new RuntimeItemActivity('activity', items[0]);
		activity.addActivityItem(items[1]);
		activity.addActivityItem(items[2]);
		const baselineVersion = activity.version;

		const remaining = activity.trimScrollback(2);

		expect(remaining).toBe(0);
		expect(activity.activityItems.length).toBe(2);
		expect(activity.activityItems[0].id, 'a was spliced off').toBe('b');
		expect(activity.activityItems[1].id).toBe('c');
		expect(activity.version, 'splice forces a version bump').toBe(baselineVersion + 1);
	});

	it('item self-trims AND scrollback exhausts: one version bump, not two', () => {
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

		expect(activity.activityItems.length, 'a spliced; b and c remain').toBe(2);
		expect(activity.activityItems[0].id).toBe('b');
		expect(activity.activityItems[1].id).toBe('c');
		expect(b.outputLines.length, 'b was trimmed in place').toBe(2);
		expect(activity.version, 'exactly one bump').toBe(baselineVersion + 1);
	});

	it('non-positive scrollback size short-circuits: no work, no version bump', () => {
		const item = linesItem('a', 5);
		const activity = new RuntimeItemActivity('activity', item);
		const baselineVersion = activity.version;

		expect(activity.trimScrollback(0)).toBe(0);
		expect(activity.trimScrollback(-5)).toBe(0);
		expect(item.outputLines.length, 'item untouched on the guard path').toBe(5);
		expect(activity.version).toBe(baselineVersion);
	});
});

describe('RuntimeItemActivity.addActivityItem - version bump semantics', () => {

	it('stream-merge that absorbs (no newline): length unchanged, version still bumps', () => {
		// The second stream has no newline, so addActivityItemStream on the first returns
		// undefined and addActivityItem early-returns without pushing. _version must still
		// advance because content was appended into the existing stream.
		const first = stream('s1', 'p', 'hello');
		const activity = new RuntimeItemActivity('activity', first);
		const baselineVersion = activity.version;

		activity.addActivityItem(stream('s2', 'p', ' world'));

		expect(activity.activityItems.length, 'second stream was absorbed into the first').toBe(1);
		expect(activity.version, 'absorbed merges must still bump version').toBe(baselineVersion + 1);
	});

	it('stream-merge across different parentIds: pushes as new item, bumps version', () => {
		const first = stream('s1', 'pA', 'hello');
		const activity = new RuntimeItemActivity('activity', first);
		const baselineVersion = activity.version;

		activity.addActivityItem(stream('s2', 'pB', ' world'));

		expect(activity.activityItems.length, 'different parentId - no merge').toBe(2);
		expect(activity.version).toBe(baselineVersion + 1);
	});

	it('provisional ActivityItemInput replaced by non-provisional: in-place swap, version bumps', () => {
		const provisional = input('i1', 'p', ActivityItemInputState.Provisional);
		const activity = new RuntimeItemActivity('activity', provisional);
		const baselineVersion = activity.version;

		const executing = input('i2', 'p', ActivityItemInputState.Executing);
		activity.addActivityItem(executing);

		expect(activity.activityItems.length, 'replacement, not append').toBe(1);
		expect(activity.activityItems[0], 'slot now holds the new input').toBe(executing);
		expect(executing.state, 'state not forced - prior was Provisional').toBe(ActivityItemInputState.Executing);
		expect(activity.version).toBe(baselineVersion + 1);
	});

	it('replacing an already-Completed input forces the new input to Completed', () => {
		// Simulates idle arriving before the input message: the ActivityItemInput already sitting
		// in the list is Completed. When the "real" Executing ActivityItemInput arrives later,
		// the replacement logic propagates the Completed state so the UI doesn't regress to
		// Executing.
		const alreadyCompleted = input('i1', 'p', ActivityItemInputState.Completed);
		const activity = new RuntimeItemActivity('activity', alreadyCompleted);
		const baselineVersion = activity.version;

		const executing = input('i2', 'p', ActivityItemInputState.Executing);
		activity.addActivityItem(executing);

		expect(activity.activityItems.length).toBe(1);
		expect(activity.activityItems[0], 'slot holds the replacement').toBe(executing);
		expect(executing.state, 'Completed state propagated to replacement').toBe(ActivityItemInputState.Completed);
		expect(activity.version).toBe(baselineVersion + 1);
	});

	it('replacement inherits the attribution label from the replaced input', () => {
		// The provisional input carries the provenance label (only the execution
		// site knows the attribution); the runtime's rebroadcast input does not.
		// The replacement must not lose the label.
		const provisional = new ActivityItemInput(
			'i1', 'p', new Date(0), ActivityItemInputState.Provisional, '>', '+', 'x', 'Claude Code');
		const activity = new RuntimeItemActivity('activity', provisional);

		const executing = input('i2', 'p', ActivityItemInputState.Executing);
		activity.addActivityItem(executing);

		expect(activity.activityItems[0], 'slot holds the replacement').toBe(executing);
		expect(executing.attributionLabel, 'label propagated to replacement').toBe('Claude Code');
	});

	it('non-provisional input with no matching predecessor: plain append', () => {
		const activity = new RuntimeItemActivity('activity', stream('s1', 'p', 'hi'));
		const baselineVersion = activity.version;

		activity.addActivityItem(input('i1', 'p', ActivityItemInputState.Executing));

		expect(activity.activityItems.length).toBe(2);
		expect(activity.version).toBe(baselineVersion + 1);
	});
});
