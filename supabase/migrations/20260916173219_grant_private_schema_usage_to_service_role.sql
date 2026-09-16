-- Withdrawal RPCs run as service_role and call helpers in this private schema.
-- Individual helper EXECUTE grants remain in their defining migrations.
grant usage on schema bitnode_private to service_role;
