"""PostgreSQL pool and schema for SeismoLink live monitoring."""
from __future__ import annotations
import os
import asyncpg

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS nodes (
  module_id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_description TEXT DEFAULT '',
  auth_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'physical' CHECK (source IN ('physical','simulated')),
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','event')),
  last_seen TIMESTAMPTZ,
  last_reading JSONB NOT NULL DEFAULT '{}'::jsonb,
  firmware TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS seismic_events (
  id UUID PRIMARY KEY,
  module_id BIGINT NOT NULL REFERENCES nodes(module_id),
  node_event_id TEXT NOT NULL,
  group_id TEXT,
  gateway_boot_id TEXT,
  source TEXT NOT NULL DEFAULT 'physical',
  status TEXT NOT NULL DEFAULT 'capturing',
  detected_at TIMESTAMPTZ,
  capture_started_at TIMESTAMPTZ,
  capture_ended_at TIMESTAMPTZ,
  expected_samples INTEGER,
  received_samples INTEGER NOT NULL DEFAULT 0,
  missing_samples INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  trigger_rms_mg DOUBLE PRECISION,
  waveform_path TEXT,
  analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(module_id, gateway_boot_id, node_event_id)
);
CREATE INDEX IF NOT EXISTS idx_events_detected ON seismic_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_group ON seismic_events(group_id);
CREATE TABLE IF NOT EXISTS infrastructure_cache (
  osm_id TEXT PRIMARY KEY,
  name TEXT,
  category TEXT NOT NULL,
  amenity_type TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS system_logs (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

class Database:
    def __init__(self):
        self.pool: asyncpg.Pool | None = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(
            host=os.getenv('DB_HOST', 'db'),
            port=int(os.getenv('DB_PORT', '5432')),
            user=os.getenv('DB_USER', 'seismo'),
            password=os.getenv('DB_PASSWORD', 'change-me'),
            database=os.getenv('DB_NAME', 'seismo'),
            min_size=1, max_size=8,
        )
        async with self.pool.acquire() as conn:
            await conn.execute(SCHEMA)

    async def close(self):
        if self.pool:
            await self.pool.close()
            self.pool = None

    def acquire(self):
        if not self.pool:
            raise RuntimeError('Database is not connected')
        return self.pool.acquire()

db = Database()
