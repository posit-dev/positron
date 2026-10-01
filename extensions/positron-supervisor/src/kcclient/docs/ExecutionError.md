# ExecutionError

The error an execution raised

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **string** | The error\&#39;s name, such as its exception class | [default to undefined]
**message** | **string** | The error message | [default to undefined]
**traceback** | **Array&lt;string&gt;** | The traceback, one frame or line per item | [default to undefined]

## Example

```typescript
import { ExecutionError } from './api';

const instance: ExecutionError = {
    name,
    message,
    traceback,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
