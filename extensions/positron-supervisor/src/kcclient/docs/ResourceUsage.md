# ResourceUsage


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**cpu_percent** | **number** | The percentage of CPU used by the kernel process and its child processes | [default to undefined]
**memory_bytes** | **number** | The amount of memory used by the kernel process and all of its child processes in bytes | [default to undefined]
**thread_count** | **number** | The total number of threads used by the kernel process and its child processes (Linux only) | [default to undefined]
**sampling_period_ms** | **number** | The sampling period in milliseconds over which the resource usage was measured | [default to undefined]
**timestamp** | **number** | A Unix timestamp in milliseconds indicating when the resource usage was sampled | [default to undefined]

## Example

```typescript
import { ResourceUsage } from './api';

const instance: ResourceUsage = {
    cpu_percent,
    memory_bytes,
    thread_count,
    sampling_period_ms,
    timestamp,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
