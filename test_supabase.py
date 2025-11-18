#!/usr/bin/env python3
"""Test Supabase connection and recommendations table schema."""

import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

from supabase import create_client

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

print(f"Testing Supabase connection...")
print(f"URL: {SUPABASE_URL}")
print(f"Key present: {bool(SUPABASE_SERVICE_ROLE_KEY)}")
print()

try:
    # Create client with service role key (simplified - no options)
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    print("✓ Supabase client created successfully")

    # Test 1: Try to SELECT from table
    print("\n=== Test 1: SELECT existing records ===")
    try:
        select_response = supabase.table('recommendations').select('*').limit(5).execute()
        print(f"✓ SELECT works! Found {len(select_response.data)} records")
        if select_response.data:
            print(f"  Sample: {select_response.data[0]}")
    except Exception as select_error:
        print(f"✗ SELECT fails: {select_error}")

    # Test 2: Try INSERT
    print("\n=== Test 2: INSERT new record ===")
    test_data = {
        'job_id': 'test-12345',
        'status': 'queued'
    }

    try:
        insert_response = supabase.table('recommendations').insert(test_data).execute()
        print(f"✓ Insert successful!")
        print(f"  Response: {insert_response.data}")

        # Clean up
        supabase.table('recommendations').delete().eq('job_id', 'test-12345').execute()
        print("✓ Cleaned up test record")

    except Exception as insert_error:
        print(f"✗ Insert failed: {insert_error}")

        error_str = str(insert_error)
        if '403' in error_str or 'denied' in error_str.lower():
            print("\n⚠️  ROW LEVEL SECURITY (RLS) IS BLOCKING ACCESS!")
            print("\nTo fix this issue:")
            print("1. Go to Supabase dashboard: https://rsrbugbcmwphbkkngoya.supabase.co")
            print("2. Navigate to: Authentication > Policies")
            print("3. Find the 'recommendations' table")
            print("4. Either:")
            print("   - OPTION A: Disable RLS for this table (easier)")
            print("   - OPTION B: Add a policy to allow service_role full access")
            print("\nSQL to disable RLS:")
            print("   ALTER TABLE recommendations DISABLE ROW LEVEL SECURITY;")

except Exception as e:
    print(f"✗ Fatal error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
