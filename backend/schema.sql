CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('Admin', 'Sectorista', 'Directora', 'PuntoFocal', 'Autoridad');
CREATE TYPE priority_level AS ENUM ('Urgente', 'Moderado', 'Bajo');
CREATE TYPE risk_level AS ENUM ('Alto', 'Moderado', 'Bajo');
CREATE TYPE alert_level AS ENUM ('Crítico', 'Inminente', 'Intermedio');

CREATE TABLE app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dni VARCHAR(12) UNIQUE NOT NULL,
  full_name TEXT NOT NULL, password_hash TEXT NOT NULL, role user_role NOT NULL,
  area TEXT, email TEXT, job_title TEXT, active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(64) UNIQUE NOT NULL,
  name TEXT NOT NULL, sector TEXT NOT NULL, department TEXT NOT NULL,
  priority priority_level NOT NULL, risk risk_level NOT NULL, progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'Activo', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), alert_code VARCHAR(64) UNIQUE NOT NULL,
  title TEXT NOT NULL, location TEXT NOT NULL, level alert_level NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), case_id UUID REFERENCES cases(id) ON DELETE SET NULL
);
CREATE INDEX cases_priority_idx ON cases(priority); CREATE INDEX alerts_level_idx ON alerts(level);
