-- =====================================================
-- FIX: Supabase Row Level Security (RLS) Configuration
-- =====================================================
-- This script disables RLS for ALL app tables to allow
-- the service role key to perform database operations.
--
-- The 500 Internal Server Error was caused by RLS blocking
-- all access, even with the service role key.
--
-- Run this in Supabase SQL Editor:
-- https://rsrbugbcmwphbkkngoya.supabase.co/project/_/sql
-- =====================================================

-- Disable RLS for all app tables
ALTER TABLE IF EXISTS recommendations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_medications DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS medication_schedules DISABLE ROW LEVEL SECURITY;

-- Optional: If you want to keep RLS enabled but allow service_role access,
-- use these policies instead (comment out the DISABLE command above):

/*
-- Enable RLS
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role full access
CREATE POLICY "Service role has full access"
ON recommendations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Create policy to allow anonymous users to insert (for anonymous recommendations)
CREATE POLICY "Allow anonymous inserts"
ON recommendations
FOR INSERT
TO anon
WITH CHECK (true);

-- Create policy to allow users to view their own recommendations
CREATE POLICY "Users can view own recommendations"
ON recommendations
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
*/

-- Verify RLS is disabled for all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('recommendations', 'user_profiles', 'user_medications', 'medication_schedules')
ORDER BY tablename;

-- Should return: rowsecurity = false for all tables
