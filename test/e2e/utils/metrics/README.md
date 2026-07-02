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
3. Is it a **label** — a named case or on/off condition you want to compare
   side by side? → a **variant** (categorical). Use `variant` (in
   `context_json`) for a named scenario like `simple_expression` vs
   `scrollback_trim`; use a boolean like `filter_applied` / `sort_applied` for
   an on/off condition. (Those booleans are just pre-named variants.)
4. Is it **only a human-readable label** for the row? → **`target_description`**
   (display only — never grouped or aggregated on).

The one call that trips people up is #2 vs #3: **number or label?** A number
(`1_000_000` rows) keeps its magnitude — you can scatter, order, and fit a
scaling curve. A label (`scrollback_trim`) is a discrete case with no
in-between. Collapsing a number into a label is lossy and one-way, so keep
numbers numeric; everything categorical is a variant.

`variant` values should be short, stable, `snake_case`, low-cardinality. Never
put unique/free-form/timestamped strings there, and don't smuggle a grouping
distinction into `target_description` to make it show up in the dashboard — that
belongs in `variant` (label) or a numeric field (number).

## Files

- `metric-factory.ts` - The main factory that eliminates boilerplate
- `metric-base.ts` - Base types and configuration
- `api.ts` - HTTP client for sending metrics
- `metric-sessions.ts` - Session/interpreter startup metrics (console + notebook)
