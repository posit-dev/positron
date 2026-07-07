#!/bin/bash

# Configure a single credential type for Workbench.
# Usage: configure-datasources.sh <databricks|snowflake|azure>
# The credential type can also be supplied via the CREDENTIALS env var.

CREDENTIALS="${1:-${CREDENTIALS:-}}"

if [ -z "${CREDENTIALS}" ]; then
    echo "No credential type specified - skipping data source configuration"
    exit 0
fi

echo "Configuring data source connection: ${CREDENTIALS}"

case "${CREDENTIALS}" in
    databricks)
        if [ -z "${DATABRICKS_URL_}" ]; then
            echo "❌ ERROR: DATABRICKS_URL_ not set - cannot configure Databricks"
            exit 1
        fi

        # Extract workspace name from URL
        WORKSPACE_NAME=$(echo "$DATABRICKS_URL_" | sed -E 's|https?://([^.]+).*|\1|')

        sudo tee /etc/rstudio/databricks.conf > /dev/null <<EOF
[${WORKSPACE_NAME}]
name = Databricks Dev Workspace
url = ${DATABRICKS_URL_}
client-id = ${DATABRICKS_CLIENT_ID_}
EOF
        echo "  Created /etc/rstudio/databricks.conf for workspace: ${WORKSPACE_NAME}"

        if ! grep -qE '^[[:space:]]*databricks-enabled=1' /etc/rstudio/rserver.conf 2>/dev/null; then
            echo "databricks-enabled=1" | sudo tee -a /etc/rstudio/rserver.conf > /dev/null
        fi
        echo "  Updated /etc/rstudio/rserver.conf with Databricks feature flag"
        ;;

    snowflake)
        if [ -z "${SNOWFLAKE_ACCOUNT_}" ]; then
            echo "❌ ERROR: SNOWFLAKE_ACCOUNT_ not set - cannot configure Snowflake"
            exit 1
        fi

        sudo tee /etc/rstudio/snowflake.conf > /dev/null <<EOF
[${SNOWFLAKE_ACCOUNT_}]
client-id = ${SNOWFLAKE_CLIENT_ID_}
client-secret = ${SNOWFLAKE_CLIENT_SECRET_}
account = ${SNOWFLAKE_ACCOUNT_}
EOF
        echo "  Created /etc/rstudio/snowflake.conf for account: ${SNOWFLAKE_ACCOUNT_}"

        if ! grep -qE '^[[:space:]]*allow-refresh-snowflake-roles=1' /etc/rstudio/rserver.conf 2>/dev/null; then
            echo "allow-refresh-snowflake-roles=1" | sudo tee -a /etc/rstudio/rserver.conf > /dev/null
        fi
        echo "  Updated /etc/rstudio/rserver.conf with Snowflake feature flag"
        ;;

    azure)
        if [ -z "${AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET_}" ]; then
            echo "❌ ERROR: AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET_ not set - cannot configure Azure"
            exit 1
        fi

        # 2a. Append OpenID auth settings to rserver.conf
        if ! grep -qE '^[[:space:]]*auth-openid=1' /etc/rstudio/rserver.conf 2>/dev/null; then
            sudo tee -a /etc/rstudio/rserver.conf > /dev/null <<EOF
auth-openid=1
auth-openid-issuer=https://login.microsoftonline.com/b0b52785-d0b5-4b72-a6d0-13ac07ebbbd7/v2.0
user-provisioning-enabled=1
user-provisioning-register-on-first-login=1
auth-openid-scopes=offline_access
EOF
        fi
        echo "  Updated /etc/rstudio/rserver.conf with Azure OpenID settings"

        # 2b. Create the OpenID client secret file
        sudo tee /etc/rstudio/openid-client-secret > /dev/null <<EOF
client-id = c87370c8-f3d4-42d6-ba5e-017afda6cf67
client-secret = ${AZURE_SERVICE_PRINCIPAL_CLIENT_SECRET_}
EOF
        sudo chmod 0600 /etc/rstudio/openid-client-secret
        echo "  Created /etc/rstudio/openid-client-secret"

        # 2c. Ensure JIT-provisioned home dirs get created on login
        if ! grep -q "pam_mkhomedir.so" /etc/pam.d/common-session 2>/dev/null; then
            echo "session required pam_mkhomedir.so skel=/etc/skel umask=0077" | sudo tee -a /etc/pam.d/common-session > /dev/null
        fi
        echo "  Updated /etc/pam.d/common-session with pam_mkhomedir"
        ;;

    *)
        echo "❌ ERROR: Unknown credential type '${CREDENTIALS}' (expected: databricks, snowflake, or azure)"
        exit 1
        ;;
esac

echo "Data source configuration complete: ${CREDENTIALS}"
