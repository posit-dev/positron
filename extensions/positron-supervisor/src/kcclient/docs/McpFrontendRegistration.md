# McpFrontendRegistration


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**frontend_id** | **string** | A previously issued frontend ID. Omit to have the server generate one. | [optional] [default to undefined]
**display_name** | **string** | A human-readable name for the frontend, shown in logs and status | [default to undefined]
**preferred_port** | **number** | The TCP port the MCP listener should bind. Used only when the listener isn\&#39;t running yet, and ignored when the port is unavailable. | [optional] [default to undefined]
**capabilities** | [**McpFrontendCapabilities**](McpFrontendCapabilities.md) |  | [optional] [default to undefined]

## Example

```typescript
import { McpFrontendRegistration } from './api';

const instance: McpFrontendRegistration = {
    frontend_id,
    display_name,
    preferred_port,
    capabilities,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
