# StartupError


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**exit_code** | **number** | The exit code of the process, if it exited | [optional] [default to undefined]
**output** | **string** | The output of the process (combined stdout and stderr) emitted during startup, if any | [optional] [default to undefined]
**error** | [**ModelError**](ModelError.md) |  | [default to undefined]

## Example

```typescript
import { StartupError } from './api';

const instance: StartupError = {
    exit_code,
    output,
    error,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
