# Metrics System

This directory contains a simplified metrics system for tracking performance of various feature areas in E2E tests.

## Quick Start: Adding a New Feature Metric

Leveraging `metric-factory.ts` makes adding metrics for a new feature area is simple:

### 1. Create your feature metric file (e.g., `metric-my-feature.ts`)

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

### 2. Use it in your tests

```typescript
import { recordMyFeatureMetric } from "./utils/metrics/metric-my-feature.js";

// In your test:
const result = await recordMyFeatureMetric(
	() => myAsyncOperation(), // The operation to measure
	{
		action: "action1",
		target_type: "file.csv",
		target_description: "Processing CSV file",
		context_json: { rows: 1000, columns: 5 },
	},
	isElectronApp,
	logger
);

// `result` contains both the operation result and duration_ms
console.log(`Operation took ${result.duration_ms}ms`);
console.log("Operation result:", result.result);
```

## Advanced Features

### Custom Context Builders

You can create shortcuts with custom context builders for complex scenarios (see `metric-data-explorer.ts` for examples).

### Error Handling

The factory automatically captures success/error status and re-throws errors to maintain original test behavior.

### Background Logging

Metrics are logged in the background without affecting test performance.

## Existing Feature Areas

- **Data Explorer** (`metric-data-explorer.ts`): Metrics for data loading, filtering, sorting, and code generation

  ```typescript
  await metric.dataExplorer.loadData(async () => {
  	// Your data loading operation
  }, "py.pandas.DataFrame");
  ```

- **Notebooks** (`metric-notebooks.ts`): Metrics for notebook cell execution, opening, and saving

  ```typescript
  await metric.notebooks.runCell(
  	async () => {
  		// Your cell execution operation
  	},
  	"cell.python",
  	"python",
  	"Running data analysis cell"
  );
  ```

## Files

- `metric-factory.ts` - The main factory that eliminates boilerplate
- `metric-base.ts` - Base types and configuration
- `api.ts` - HTTP client for sending metrics
