/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ActivityItem, TrimScrollbackResult } from '../../../browser/classes/activityItem.js';
import { ActivityItem as ActivityItemUnion, RuntimeItemActivity } from '../../../browser/classes/runtimeItemActivity.js';

/**
 * Minimal ActivityItem subclass for tests. Driven by a `trimFn` that takes the incoming budget
 * and returns a TrimScrollbackResult, so each mock participates in the walk's budget accounting
 * (instead of clobbering it with a static value). Records callCount for walk-shape assertions.
 *
 * Note: the RuntimeItemActivity API is typed against an `ActivityItem` *union* of concrete
 * subclasses (ActivityItemStream | ActivityItemErrorMessage | ...) — not the abstract base.
 * This test item extends the abstract base and is cast through the union at call sites. The
 * cast is safe because trimScrollback only uses the abstract-class methods; the instanceof
 * branches in addActivityItem (stream merge, input replacement) simply don't fire for a
 * TestActivityItem, which is exactly what we want in these tests.
 */
class TestActivityItem extends ActivityItem {
	public callCount = 0;

	constructor(
		id: string,
		private readonly _trimFn: (budget: number) => TrimScrollbackResult
	) {
		super(id, 'parent', new Date(0));
	}

	public override trimScrollback(scrollbackSize: number): TrimScrollbackResult {
		this.callCount++;
		return this._trimFn(scrollbackSize);
	}

	public override getClipboardRepresentation(_commentPrefix: string): string[] {
		return [];
	}
}

/** A weight-only item: declares weight N, never reports trimmed. Matches ActivityItemInput et al. */
const weightItem = (id: string, weight: number) => new TestActivityItem(id, (budget) => ({
	trimmed: false,
	remainingScrollbackSize: Math.max(budget - weight, 0),
}));

/** A self-trimming item: always reports trimmed:true and consumes the full budget. */
const selfTrimmingItem = (id: string) => new TestActivityItem(id, (_budget) => ({
	trimmed: true,
	remainingScrollbackSize: 0,
}));

/**
 * Bridges the abstract-class TestActivityItem to the union type the RuntimeItemActivity API
 * expects. Keeps the casts isolated to one place.
 */
const asUnion = (item: TestActivityItem): ActivityItemUnion => item as unknown as ActivityItemUnion;

/**
 * Reads RuntimeItemActivity._version through the public getter in a way that's stable against
 * future renames — all tests go through this.
 */
const versionOf = (activity: RuntimeItemActivity): number => activity.version;

suite('RuntimeItemActivity.trimScrollback', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('single item that fits without trimming: no version bump, no splice, returns remaining budget', () => {
		const item = weightItem('a', 1);
		const activity = new RuntimeItemActivity('activity', asUnion(item));
		const initialVersion = versionOf(activity);

		const remaining = activity.trimScrollback(10);

		assert.strictEqual(remaining, 9, 'remaining budget passes through from the item');
		assert.strictEqual(activity.activityItems.length, 1, 'no splice happened');
		assert.strictEqual(versionOf(activity), initialVersion, '_version should not bump when nothing trimmed');
		assert.strictEqual(item.callCount, 1, 'the single item was walked once');
	});

	test('single item reports trimmed: bumps version without a splice', () => {
		const item = selfTrimmingItem('a');
		const activity = new RuntimeItemActivity('activity', asUnion(item));
		const initialVersion = versionOf(activity);

		const remaining = activity.trimScrollback(5);

		assert.strictEqual(remaining, 0);
		assert.strictEqual(activity.activityItems.length, 1, 'no splice — the trimming item is the only one');
		assert.strictEqual(versionOf(activity), initialVersion + 1, 'version bumps because the item reported trimmed');
	});

	test('multiple items all fit with no trimming: no version bump, no splice', () => {
		// Three weight-1 items. Walk consumes three units of budget; none reports trimmed.
		const items = [weightItem('a', 1), weightItem('b', 1), weightItem('c', 1)];
		const activity = new RuntimeItemActivity('activity', asUnion(items[0]));
		// The constructor added items[0] via addActivityItem (which bumps _version once). Record
		// that post-construction baseline so we can assert *no further* bumps.
		activity.addActivityItem(asUnion(items[1]));
		activity.addActivityItem(asUnion(items[2]));
		const baselineVersion = versionOf(activity);

		const remaining = activity.trimScrollback(10);

		assert.strictEqual(remaining, 7, 'each of three weight-1 items consumed one unit (10 → 9 → 8 → 7)');
		assert.strictEqual(activity.activityItems.length, 3, 'no splice');
		assert.strictEqual(versionOf(activity), baselineVersion, '_version untouched — no trim occurred');
		assert.strictEqual(items[0].callCount, 1);
		assert.strictEqual(items[1].callCount, 1);
		assert.strictEqual(items[2].callCount, 1);
	});

	test('budget exhausted mid-walk: splices older items and bumps version', () => {
		// Budget 2, three weight-1 items. Walking tail-first: c fits (budget → 1), b fits
		// (budget → 0), loop exits without visiting a. firstKeepIndex = 1 → splice(0, 1) drops a.
		const items = [weightItem('a', 1), weightItem('b', 1), weightItem('c', 1)];
		const activity = new RuntimeItemActivity('activity', asUnion(items[0]));
		activity.addActivityItem(asUnion(items[1]));
		activity.addActivityItem(asUnion(items[2]));
		const baselineVersion = versionOf(activity);

		const remaining = activity.trimScrollback(2);

		assert.strictEqual(remaining, 0, 'budget exhausted by b');
		assert.strictEqual(activity.activityItems.length, 2, 'a was spliced off; b and c remain');
		assert.strictEqual(activity.activityItems[0].id, 'b');
		assert.strictEqual(activity.activityItems[1].id, 'c');
		assert.strictEqual(versionOf(activity), baselineVersion + 1, 'splice forces a version bump');
		assert.strictEqual(items[0].callCount, 0, 'a was never walked — loop exited first');
		assert.strictEqual(items[1].callCount, 1);
		assert.strictEqual(items[2].callCount, 1);
	});

	test('item self-trims and exhausts budget: splice AND trim-signal both hit; one bump', () => {
		// Walking tail-first with budget 3: c fits weight-1 (budget → 2), b self-trims and reports
		// remaining=0. Loop exits at b (firstKeepIndex = 1) → splice(0, 1) drops a. Both signals
		// (b.trimmed = true AND splice happened) would independently bump version; assert exactly
		// one bump.
		const items = [weightItem('a', 1), selfTrimmingItem('b'), weightItem('c', 1)];
		const activity = new RuntimeItemActivity('activity', asUnion(items[0]));
		activity.addActivityItem(asUnion(items[1]));
		activity.addActivityItem(asUnion(items[2]));
		const baselineVersion = versionOf(activity);

		activity.trimScrollback(3);

		assert.strictEqual(activity.activityItems.length, 2, 'a spliced; b and c remain');
		assert.strictEqual(activity.activityItems[0].id, 'b');
		assert.strictEqual(versionOf(activity), baselineVersion + 1, 'exactly one bump even though both trim-signal and splice fire');
	});

	test('non-positive scrollback size short-circuits: returns 0, no work done', () => {
		const item = selfTrimmingItem('a');
		const activity = new RuntimeItemActivity('activity', asUnion(item));
		const baselineVersion = versionOf(activity);

		assert.strictEqual(activity.trimScrollback(0), 0);
		assert.strictEqual(activity.trimScrollback(-5), 0);
		assert.strictEqual(item.callCount, 0, 'no item was consulted');
		assert.strictEqual(versionOf(activity), baselineVersion, 'no version bump on the guard path');
	});
});
