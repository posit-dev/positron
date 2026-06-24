# ExecuteRequest

A request to execute code in a session

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**code** | **string** | The code to execute | [default to undefined]
**silent** | **boolean** | If true, signals the kernel to execute quietly: no broadcast on iopub, no execute_result, and the execution_count is not incremented. Defaults to false. | [optional] [default to false]
**store_history** | **boolean** | If true (default), the code is stored in the kernel\&#39;s history. Set to false for throwaway executions. | [optional] [default to true]
**stop_on_error** | **boolean** | If true (default), abort the execution queue on error. If false, queued execute requests will still be processed even if this one fails. | [optional] [default to true]
**timeout_seconds** | **number** | Maximum number of seconds to wait for execution to complete. If not specified, the request will block indefinitely until execution finishes. | [optional] [default to undefined]

## Example

```typescript
import { ExecuteRequest } from './api';

const instance: ExecuteRequest = {
    code,
    silent,
    store_history,
    stop_on_error,
    timeout_seconds,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
