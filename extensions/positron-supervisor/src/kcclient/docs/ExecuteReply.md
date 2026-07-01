# ExecuteReply

The result of executing code in a session

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | **string** | Whether the execution succeeded or errored | [default to undefined]
**execution_count** | **number** | The kernel\&#39;s execution counter | [default to undefined]
**output** | [**Array&lt;ExecuteOutput&gt;**](ExecuteOutput.md) | All output messages produced during execution, in order | [default to undefined]
**data** | **{ [key: string]: string; }** | The execution result as a MIME-keyed dictionary (from execute_result), if the execution produced a result | [optional] [default to undefined]
**error_name** | **string** | The error name, if the execution failed | [optional] [default to undefined]
**error_message** | **string** | The error message, if the execution failed | [optional] [default to undefined]
**error_traceback** | **Array&lt;string&gt;** | The error traceback, if the execution failed | [optional] [default to undefined]

## Example

```typescript
import { ExecuteReply } from './api';

const instance: ExecuteReply = {
    status,
    execution_count,
    output,
    data,
    error_name,
    error_message,
    error_traceback,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
