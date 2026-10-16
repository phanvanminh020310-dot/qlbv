-- Separate requests from operational absences: pending/rejected requests NEVER affect a roster or lease.
-- Existing duty_absences remain approved historical records; no backfill deletes assignments or changes leave.
CREATE TABLE IF NOT EXISTS duty_absence_requests (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL DEFAULT 'KHAC',
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'CHO_DUYET' CHECK (status IN ('CHO_DUYET','DA_DUYET','TU_CHOI','HUY')),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_by integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  response_note text NOT NULL DEFAULT '',
  approved_absence_id integer REFERENCES duty_absences(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS duty_absence_requests_user_idx ON duty_absence_requests(user_id,start_date,end_date);
CREATE INDEX IF NOT EXISTS duty_absence_requests_status_idx ON duty_absence_requests(status,created_at);
