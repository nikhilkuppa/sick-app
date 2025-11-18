# 🔧 Fix: Supabase 500 Error

## Problem Identified

The `/api/v1/recommendation` endpoint is returning **500 Internal Server Error** because:

**Row Level Security (RLS)** is enabled on the `recommendations` table in Supabase and is blocking ALL access, including from the service role key.

Error message:
```
{'message': 'JSON could not be generated', 'code': 403, 'hint': 'Refer to full message for details', 'details': "b'Access denied'"}
```

## Quick Fix (Choose ONE option)

### Option A: Disable RLS (Fastest - Recommended for Development)

1. Go to Supabase SQL Editor: https://rsrbugbcmwphbkkngoya.supabase.co/project/_/sql
2. Run these SQL commands (fixes ALL app tables):

```sql
ALTER TABLE IF EXISTS recommendations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_medications DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS medication_schedules DISABLE ROW LEVEL SECURITY;
```

3. Verify it worked:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('recommendations', 'user_profiles', 'user_medications', 'medication_schedules')
ORDER BY tablename;
```

Should show `rowsecurity = false` for all tables

### Option B: Run the Complete SQL Script

1. Go to Supabase SQL Editor: https://rsrbugbcmwphbkkngoya.supabase.co/project/_/sql
2. Open and run the file: `supabase_fix_rls.sql`

## Test After Fix

After running the SQL, test the fix:

```bash
python test_supabase.py
```

Should show:
```
✓ SELECT works! Found X records
✓ Insert successful!
```

Then test the website at http://localhost:3000 - the symptom search should now work!

## Root Cause Analysis

- **What happened**: Supabase has Row Level Security (RLS) enabled by default on new tables
- **Why it failed**: Even the service role key couldn't bypass RLS policies
- **Why now**: The table was likely created with RLS enabled, but no policies were defined to allow access
- **Fix**: Disable RLS for this table (we're using service role key for backend operations)

## Files Modified

1. `test_supabase.py` - Diagnostic script to test Supabase connection
2. `supabase_fix_rls.sql` - SQL script to fix RLS settings
3. This instruction file

## Next Steps

After fixing RLS:
1. Test symptom search on localhost:3000
2. Verify recommendations are being saved to database
3. Continue with remaining features implementation
