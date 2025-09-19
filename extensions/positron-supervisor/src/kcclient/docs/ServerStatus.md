# ServerStatus


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**sessions** | **number** |  | [default to undefined]
**active** | **number** |  | [default to undefined]
**busy** | **boolean** |  | [default to undefined]
**idle_seconds** | **number** | The number of seconds all sessions have been idle, or 0 if any session is busy | [default to undefined]
**busy_seconds** | **number** | The number of seconds any session has been busy, or 0 if all sessions are idle | [default to undefined]
**version** | **string** | The version of the server | [default to undefined]
**process_id** | **number** | The server\&#39;s operating system process identifier | [default to undefined]

## Example

```typescript
import { ServerStatus } from './api';

const instance: ServerStatus = {
    sessions,
    active,
    busy,
    idle_seconds,
    busy_seconds,
    version,
    process_id,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
