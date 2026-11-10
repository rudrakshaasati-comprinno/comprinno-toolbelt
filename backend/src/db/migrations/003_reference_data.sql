-- 003_reference_data.sql — DB-driven engagement types + questionnaire templates.
--
-- Engagement type options and the discovery questionnaire questions now live in
-- the DB (served via the API) instead of being hardcoded in the frontend.
-- Questionnaire templates are keyed by engagement type so the right question
-- set attaches to each engagement. Also flags notes that carry a meeting MoM
-- captured as text (vs. an uploaded MoM document).

BEGIN;

CREATE TABLE IF NOT EXISTS engagement_types (
  id          TEXT PRIMARY KEY,          -- e.g. azure-to-aws-migration
  label       TEXT NOT NULL,             -- human label for the dropdown
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questionnaire_templates (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  engagement_type   TEXT NOT NULL REFERENCES engagement_types(id) ON DELETE CASCADE,
  question          TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qtemplates_type ON questionnaire_templates(engagement_type);

-- Distinguish a meeting-MoM note captured as text from a general note.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'note'
  CHECK (kind IN ('note', 'meeting_mom'));

-- Seed engagement types.
INSERT INTO engagement_types (id, label, sort_order) VALUES
  ('azure-to-aws-migration',      'Cloud migration — Azure to AWS',        1),
  ('onprem-to-aws-migration',     'Cloud migration — on-premises to AWS',  2),
  ('app-modernization',           'Application modernization',             3),
  ('cloud-readiness-assessment',  'Cloud readiness assessment',            4),
  ('custom',                      'Other / custom',                        5)
ON CONFLICT (id) DO NOTHING;

-- Seed questionnaire templates per type.
INSERT INTO questionnaire_templates (engagement_type, question, sort_order) VALUES
  ('azure-to-aws-migration', 'Which Azure services are currently in use (VMs, App Service, SQL DB, etc.)?', 1),
  ('azure-to-aws-migration', 'What is the primary driver for this migration (cost, performance, contract end, compliance)?', 2),
  ('azure-to-aws-migration', 'Are there any regulatory or data residency constraints?', 3),
  ('azure-to-aws-migration', 'What is the target timeline / any hard deadlines?', 4),
  ('azure-to-aws-migration', 'What are the current data volumes and expected growth?', 5),
  ('onprem-to-aws-migration', 'What is the current on-premises footprint (servers, VMs, storage)?', 1),
  ('onprem-to-aws-migration', 'What hypervisor / virtualization platform is in use (VMware, Hyper-V, bare metal)?', 2),
  ('onprem-to-aws-migration', 'What is the primary driver (data-center exit, cost, scalability)?', 3),
  ('onprem-to-aws-migration', 'Are there regulatory or data residency constraints?', 4),
  ('app-modernization', 'Which applications are in scope for modernization?', 1),
  ('app-modernization', 'What are the current pain points (scaling, maintenance, cost)?', 2),
  ('app-modernization', 'What is the desired target architecture (containers, serverless, managed services)?', 3),
  ('cloud-readiness-assessment', 'What is the scope of the assessment (whole estate, specific workloads)?', 1),
  ('cloud-readiness-assessment', 'What are the business objectives for moving to cloud?', 2),
  ('cloud-readiness-assessment', 'What compliance frameworks apply?', 3),
  ('custom', 'Describe the environment in scope.', 1),
  ('custom', 'What is the primary objective?', 2)
ON CONFLICT DO NOTHING;

COMMIT;
