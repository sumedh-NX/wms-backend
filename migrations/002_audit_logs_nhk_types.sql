-- Expand audit_logs type constraint to include NHK scan types
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_type_check
  CHECK (type IN ('BIN_LABEL','PICKLIST','NX_QR','PART'));