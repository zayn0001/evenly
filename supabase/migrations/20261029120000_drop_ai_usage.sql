-- The hourly AI limits now live in the website's server memory (web/lib/server.ts), so the
-- per-day database counter goes.
drop function evenly.use_ai(text, integer);
drop table evenly.ai_usage;
