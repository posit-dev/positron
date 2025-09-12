# RestartSession


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**working_directory** | **string** | The desired working directory for the session after restart, if different from the session\&#39;s working directory at startup | [optional] [default to undefined]
**env** | [**Array&lt;VarAction&gt;**](VarAction.md) | A list of environment variable actions to perform | [optional] [default to undefined]

## Example

```typescript
import { RestartSession } from './api';

const instance: RestartSession = {
    working_directory,
    env,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
