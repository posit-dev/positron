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

When a test varies something, use this to decide where it goes:

| What varies | Where it goes | Example |
|---|---|---|
| What you act on (structure, file format, session kind) | `target_type` (the `MetricTargetType` union) | `console.python`, `file.csv` |
| A size or count that duration scales with | a numeric `context_json` field | `data_rows`, `input_rows` |
| A named case you benchmark that shares the same action + target_type with nothing else to tell it apart | `variant` | `simple_expression` vs `scrollback_trim` |
| A flag or property you occasionally slice by | its own `context_json` field | `filter_applied`, `preview_enabled` |
| A human-readable row label | `target_description` (display only) | `"Python: scrollback trim"` |

The dashboard groups the Duration Distribution box plot by `variant` (alongside action and target_type). Two distinctions trip people up:

- **Number vs. variant:** keep a magnitude numeric (`data_rows`) so duration can be plotted against it. Reach for `variant` only when the cases are discrete and named. Don't bucket a number into a label.
- **Variant vs. attribute:** a variant is a scenario with no other home. An attribute like `filter_applied` already has its own field, so it is never a variant, and the dashboard does not group by attributes.

`variant` values are short, stable, snake_case, low-cardinality, and declared as a typed union in the reporter (e.g. `ConsoleExecuteVariant`) so a typo won't compile. Don't put free-form or timestamped strings there, and don't hide a grouping distinction in `target_description` to force it onto the dashboard.

For numeric field names, make the quantity obvious: countable nouns (`*_rows`, `*_cols`, `*_lines`) or an explicit unit (`*_ms`, `*_bytes`). Never a bare `size` or `length`.

## Files

- `metric-factory.ts` - The main factory that eliminates boilerplate
- `metric-base.ts` - Base types and configuration
- `api.ts` - HTTP client for sending metrics
- `metric-sessions.ts` - Session/interpreter startup metrics (console + notebook)
