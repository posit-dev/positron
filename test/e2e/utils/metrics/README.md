# Metrics System

This directory contains a simplified metrics system for tracking performance of various feature areas in E2E tests.

## Quick Start: Adding a New Feature Metric

`metric-factory.ts` simplifies the process of adding metrics for new feature areas.

### 1. Create your feature metric file (e.g., `metric-<new-feature>.ts`)

```typescript
import { BaseMetric } from "./metric-base.js";
import { createFeatureMetricFactory } from "./metric-factory.js";

// Define your actions
export type MyFeatureAction = "action1" | "action2" | "action3";

// Define your metric type
export type MyFeatureMetric = BaseMetric & {
	feature_area: "my_feature";
	action: MyFeatureAction;
};

// Create the factory (1 line!)
const { recordMetric: recordMyFeatureMetric } =
	createFeatureMetricFactory<MyFeatureAction>("my_feature");

// Export and you're done!
export { recordMyFeatureMetric };
```

### 2. Export your feature from `index.ts`

```typescript
// Recordable features
export * from "./metric-data-explorer.js";
export * from "./metric-notebooks.js";
export * from "./metric-sessions.js";
export * from "./metric-my-feature.js"; // Add this line
```

### 3. Add your feature to the RecordMetric type in `metric-base.ts`

```typescript
export type RecordMetric = {
	dataExplorer: {
		/* ... */
	};
	notebooks: {
		/* ... */
	};
	myFeature: {
		action1: <T>(
			operation: () => Promise<T>,
			targetType: MetricTargetType,
			options?: MyFeatureOptions
		) => Promise<MetricResult<T>>;
		action2: <T>(
			operation: () => Promise<T>,
			targetType: MetricTargetType,
			options?: MyFeatureOptions
		) => Promise<MetricResult<T>>;
	};
};
```

### 4. Update the MetricsFixture in `fixtures/test-setup/metrics.fixtures.ts`

```typescript
import {
	recordMyFeatureAction1,
	recordMyFeatureAction2,
} from "../../utils/metrics/metric-my-feature.js";

export function MetricsFixture(
	app: Application,
	logger: MultiLogger
): RecordMetric {
	return {
		// ... existing features
		myFeature: {
			action1: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				options?: MyFeatureOptions
			) => {
				return recordMyFeatureAction1(
					operation,
					targetType,
					!!app.code.electronApp,
					logger,
					options
				);
			},
			action2: async <T>(
				operation: () => Promise<T>,
				targetType: MetricTargetType,
				options?: MyFeatureOptions
			) => {
				return recordMyFeatureAction2(
					operation,
					targetType,
					!!app.code.electronApp,
					logger,
					options
				);
			},
		},
	};
}
```

### 5. Use it in your tests (via the fixture)

```typescript
// In your test function signature:
test("My feature performance test", async ({ metric }) => {
	const result = await metric.myFeature.action1(
		async () => {
			// Your async operation to measure
			return await performMyFeatureOperation();
		},
		"file.csv",
		{ description: "Processing CSV file" }
	);

	// `result` contains both the operation result and duration_ms
	console.log(`Operation took ${result.duration_ms}ms`);
});
```

## Advanced Features

### Custom Context Builders

You can create shortcuts with custom context builders for complex scenarios (see `metric-data-explorer.ts` for examples).

### Error Handling

The factory automatically captures success/error status and re-throws errors to maintain original test behavior.

### Background Logging

Metrics are logged in the background without affecting test performance.

## Choosing the right dimension

Your test varies something — "where does it go?" Walk this in order:

1. Is it **what you're acting on** (a data structure, file format, session
   kind)? → **`target_type`** (the `MetricTargetType` union; add a member for a
   genuinely new target).
2. Is it a **number** — a size/count you'd expect duration to scale with? →
   a **numeric context field** (`data_rows`, `data_cols`, `input_rows`, …).
   Keep it a number so the dashboard can plot duration against it.
3. Is it a **named case** you deliberately benchmark and want as its own
   box-plot group — one that shares the same `action`+`target_type` but has no
   other field to distinguish it? → a **variant**. Use `variant` (in
   `context_json`) for `simple_expression` vs `scrollback_trim`. The dashboard
   groups the Duration Distribution box plot by it.
4. Is it a **property/flag of the run** you might slice by occasionally, but not
   the identity of the scenario? → an **attribute** — its own field in
   `context_json` (`filter_applied`, `sort_applied`, `preview_enabled`, …).
   Attributes are *not* a variant: the dashboard doesn't group by them by
   default, and each is recoverable from its own field, so it never belongs in
   `variant`.
5. Is it **only a human-readable label** for the row? → **`target_description`**
   (display only — never grouped or aggregated on).

The calls that trip people up:

- **#2 vs #3 — number or label?** A number (`1_000_000` rows) keeps its
  magnitude — you can scatter, order, and fit a scaling curve. A label
  (`scrollback_trim`) is a discrete case with no in-between. Collapsing a number
  into a label is lossy and one-way, so keep numbers numeric.
- **#3 vs #4 — variant or attribute?** A variant is the *identity* of a named
  scenario that has nowhere else to live; an attribute is a flag/property that
  already has (or could have) its own field. `filter_applied` is an attribute,
  not a variant — nobody benchmarks "filter applied" vs "not applied" as
  deliberately-compared box-plot groups, and the value is already in its own
  field. If you truly wanted to compare, say, filter cost by dataset size,
  that's a *number* (`data_rows`), bucketed at analysis time — still not a
  variant.

`variant` values should be short, stable, `snake_case`, low-cardinality, and
declared as a typed union in the reporter (e.g. `ConsoleExecuteVariant`) so a
typo won't compile. Never put unique/free-form/timestamped strings there, and
don't smuggle a grouping distinction into `target_description` to make it show
up in the dashboard — that belongs in `variant` (named case) or a numeric field
(number).

**Naming convention:** make a numeric field's quantity obvious in its name —
counts as countable nouns (`*_rows`, `*_cols`, `*_lines`), other magnitudes with
an explicit unit (`*_ms`, `*_bytes`). Never a bare `size`/`length`. Categorical
(variant) fields get plain names.

## Files

- `metric-factory.ts` - The main factory that eliminates boilerplate
- `metric-base.ts` - Base types and configuration
- `api.ts` - HTTP client for sending metrics
- `metric-sessions.ts` - Session/interpreter startup metrics (console + notebook)
