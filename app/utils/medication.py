# app/utils/medication.py
from datetime import datetime
from app.db.supabase_client import get_supabase_client

class Medication:
    def __init__(self, user_id, medication_id):
        self.user_id = user_id
        self.medication_id = medication_id
        self.supabase = get_supabase_client()

    def get_schedule(self):
        return self.supabase.table('medication_schedules')\
            .select('*')\
            .eq('medication_id', self.medication_id)\
            .single().execute()

    def validate_medication_status(self, status, date, time):
        # Status validation logic
        pass

# app/utils/caregiver.py
class CaregiverRelationship:
    def __init__(self, patient_id, caregiver_id):
        self.patient_id = patient_id
        self.caregiver_id = caregiver_id
        self.supabase = get_supabase_client()

    def check_permissions(self, permission_type):
        # Permission checking logic
        pass

# app/models/adherence.py
class AdherenceCalculator:
    def __init__(self, user_id, medication_id):
        self.user_id = user_id
        self.medication_id = medication_id
        self.supabase = get_supabase_client()

    def calculate_adherence(self, start_date, end_date):
        # Adherence calculation logic
        pass