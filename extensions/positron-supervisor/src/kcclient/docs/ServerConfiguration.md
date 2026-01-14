# ServerConfiguration


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**idle_shutdown_hours** | **number** | The number of hours the server will wait before shutting down idle sessions (-1 if idle shutdown is disabled) | [optional] [default to undefined]
**log_level** | **string** | The current log level | [optional] [default to undefined]

## Example

```typescript
import { ServerConfiguration } from './api';

const instance: ServerConfiguration = {
    idle_shutdown_hours,
    log_level,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
