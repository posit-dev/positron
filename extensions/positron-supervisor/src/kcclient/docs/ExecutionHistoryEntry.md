# ExecutionHistoryEntry

Code a session ran and what it produced. Input and output are clipped to a few kilobytes each, keeping their beginning and end.

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**input** | **string** | The code that was run | [default to undefined]
**output** | **string** | The text the code produced: standard output and error, displays, and the result, in the order they arrived | [default to undefined]
**error** | [**ExecutionError**](ExecutionError.md) |  | [optional] [default to undefined]
**timestamp** | **number** | A Unix timestamp in milliseconds indicating when the code was sent to the kernel | [default to undefined]
**source** | **string** | What submitted the code, when known, such as \&#39;agent\&#39;, \&#39;interactive\&#39;, or \&#39;script\&#39; | [optional] [default to undefined]
**agent** | **string** | The name of the agent that submitted the code, when it was an agent | [optional] [default to undefined]
**truncated** | **boolean** | Whether any part of the entry was clipped | [default to undefined]

## Example

```typescript
import { ExecutionHistoryEntry } from './api';

const instance: ExecutionHistoryEntry = {
    input,
    output,
    error,
    timestamp,
    source,
    agent,
    truncated,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
