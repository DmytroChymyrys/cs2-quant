-- Guard historical snapshots against accidental application UPDATE/DELETE/TRUNCATE.
CREATE FUNCTION reject_observation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'market_observations is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER observations_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON market_observations
FOR EACH STATEMENT EXECUTE FUNCTION reject_observation_mutation();
