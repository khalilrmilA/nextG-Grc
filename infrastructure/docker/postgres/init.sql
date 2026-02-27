-- GRC Platform PostgreSQL initialization
-- Creates necessary extensions

-- pgvector for semantic search over controls
CREATE EXTENSION IF NOT EXISTS vector;

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- For audit log timestamps
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Keycloak schema (used by Keycloak SSO)
CREATE SCHEMA IF NOT EXISTS keycloak;
