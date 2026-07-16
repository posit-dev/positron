#!/bin/bash
set -e

# The stock Postgres entrypoint only auto-runs SQL against the single
# POSTGRES_DB. To keep each dataset in its own database we create them here and
# load the dumps explicitly. The dumps live in /sql (NOT in the entrypoint dir)
# so they are not also auto-run against POSTGRES_DB.
#
# Database names are intentionally hardcoded (not driven by env vars) so the
# layout is identical everywhere:
#   - periodic  : periodic table sample data
#   - dvdrental : DVD rental sample data

echo "Creating databases 'periodic' and 'dvdrental'..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-'EOSQL'
	CREATE DATABASE periodic;
	CREATE DATABASE dvdrental;
EOSQL

echo "Loading periodic table data into 'periodic'..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname periodic -f /sql/periodic_table.sql

echo "Loading DVD rental data into 'dvdrental'..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname dvdrental -f /sql/dvdrental.sql

echo "Database initialization complete."
