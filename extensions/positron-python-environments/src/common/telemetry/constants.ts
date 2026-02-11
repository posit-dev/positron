export enum EventNames {
    EXTENSION_ACTIVATION_DURATION = 'EXTENSION.ACTIVATION_DURATION',
    EXTENSION_MANAGER_REGISTRATION_DURATION = 'EXTENSION.MANAGER_REGISTRATION_DURATION',

    ENVIRONMENT_MANAGER_REGISTERED = 'ENVIRONMENT_MANAGER.REGISTERED',
    PACKAGE_MANAGER_REGISTERED = 'PACKAGE_MANAGER.REGISTERED',
    ENVIRONMENT_MANAGER_SELECTED = 'ENVIRONMENT_MANAGER.SELECTED',
    PACKAGE_MANAGER_SELECTED = 'PACKAGE_MANAGER.SELECTED',

    VENV_USING_UV = 'VENV.USING_UV',
    VENV_CREATION = 'VENV.CREATION',

    PACKAGE_MANAGEMENT = 'PACKAGE_MANAGEMENT',
    ADD_PROJECT = 'ADD_PROJECT',
    /**
     * Telemetry event for when a Python environment is created via command.
     * Properties:
     * - manager: string (the id of the environment manager used, or 'none')
     * - triggeredLocation: string (where the create command is called from)
     */
    CREATE_ENVIRONMENT = 'CREATE_ENVIRONMENT',
}

// Map all events to their properties
export interface IEventNamePropertyMapping {
    /* __GDPR__
       "extension.activation_duration": {
           "duration" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
       }
    */
    [EventNames.EXTENSION_ACTIVATION_DURATION]: never | undefined;
    /* __GDPR__
       "extension.manager_registration_duration": {
           "duration" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
       }
    */
    [EventNames.EXTENSION_MANAGER_REGISTRATION_DURATION]: never | undefined;

    /* __GDPR__
        "environment_manager.registered": {
            "managerId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
        }
    */
    [EventNames.ENVIRONMENT_MANAGER_REGISTERED]: {
        managerId: string;
    };

    /* __GDPR__
        "package_manager.registered": {
            "managerId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
        }
    */
    [EventNames.PACKAGE_MANAGER_REGISTERED]: {
        managerId: string;
    };

    /* __GDPR__
        "environment_manager.selected": {
            "managerId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
        }
    */
    [EventNames.ENVIRONMENT_MANAGER_SELECTED]: {
        managerId: string;
    };

    /* __GDPR__
        "package_manager.selected": {
            "managerId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
        }
    */
    [EventNames.PACKAGE_MANAGER_SELECTED]: {
        managerId: string;
    };

    /* __GDPR__
        "venv.using_uv": {"owner": "eleanorjboyd" }
    */
    [EventNames.VENV_USING_UV]: never | undefined /* __GDPR__
        "venv.creation": {
            "creationType": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
        }
    */;
    [EventNames.VENV_CREATION]: {
        creationType: 'quick' | 'custom';
    };

    /* __GDPR__
        "package_management": {
            "managerId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" },
            "result": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
        }
    */
    [EventNames.PACKAGE_MANAGEMENT]: {
        managerId: string;
        result: 'success' | 'error' | 'cancelled';
    };

    /* __GDPR__
        "add_project": {
            "template": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" },
            "quickCreate": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" },
            "totalProjectCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" },
            "triggeredLocation": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
        }
    */
    [EventNames.ADD_PROJECT]: {
        template: string;
        quickCreate: boolean;
        totalProjectCount: number;
        triggeredLocation: 'templateCreate' | 'add' | 'addGivenResource';
    };

    /* __GDPR__
        "create_environment": {
            "manager": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" },
            "triggeredLocation": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "owner": "eleanorjboyd" }
        }
    */
    [EventNames.CREATE_ENVIRONMENT]: {
        manager: string;
        triggeredLocation: string;
    };
}
