# ExecutionQueue

The execution queue for a session

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**active** | **object** | The execution request currently being evaluated, if any | [optional] [default to undefined]
**length** | **number** | The number of items in the pending queue | [default to undefined]
**pending** | **Array&lt;object&gt;** | The queue of pending execution requests | [default to undefined]

## Example

```typescript
import { ExecutionQueue } from './api';

const instance: ExecutionQueue = {
    active,
    length,
    pending,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
