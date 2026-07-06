# ExecuteOutput

A single output message produced during code execution

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**type** | **string** | The output message type | [default to undefined]
**stream_name** | **string** | The stream name (stdout or stderr), for stream output | [optional] [default to undefined]
**text** | **string** | The text content, for stream output | [optional] [default to undefined]
**data** | **{ [key: string]: string; }** | MIME-keyed data, for display_data output | [optional] [default to undefined]
**metadata** | **object** | Metadata dictionary, for display_data output | [optional] [default to undefined]
**error_name** | **string** | The error name, for error output | [optional] [default to undefined]
**error_message** | **string** | The error message, for error output | [optional] [default to undefined]
**error_traceback** | **Array&lt;string&gt;** | The error traceback lines, for error output | [optional] [default to undefined]

## Example

```typescript
import { ExecuteOutput } from './api';

const instance: ExecuteOutput = {
    type,
    stream_name,
    text,
    data,
    metadata,
    error_name,
    error_message,
    error_traceback,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
