import os
import json
from app import app, db, User, SystemSetting, AdminWithdrawal
from werkzeug.security import generate_password_hash

def reset_database():
    with app.app_context():
        print("Resetting database...")
        
        # Delete existing DB file if it exists
        db_path = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'bchain.db')
        if os.path.exists(db_path):
            os.remove(db_path)
            print("Deleted old database file.")

        # Create all tables based on the new models
        db.create_all()
        print("Created new tables with updated schema.")

        # Seed Initial Admin User
        admin = User(
            username='admin',
            full_name='System Administrator',
            password_hash=generate_password_hash('admin123'),
            role='Admin',
            status='active',
            location='HQ',
            contact='256000000000'
        )
        db.session.add(admin)

        # Seed default system status
        db.session.add(SystemSetting(key='system_status', value='on'))

        # Seed default rates
        default_rates = {
            "Mutungo": 15000, "Luzira": 18000, "Bugolobi": 20000,
            "Naguru": 22000, "Nakawa": 12000, "Ntinda": 20000,
            "Kiwatule": 25000, "Banda": 15000
        }
        db.session.add(SystemSetting(key='rates', value=json.dumps(default_rates)))
        
        # Seed placeholder for Admin Mobile Money
        db.session.add(SystemSetting(key='admin_mobile_money', value='Not Set'))
        
        # Seed some dummy AdminWithdrawal data for testing
        dummy_withdrawal1 = AdminWithdrawal(
            admin_username='admin',
            amount=50000.0,
            method='mobileMoney',
            details=json.dumps({"mobile_number": "256771234567"}),
            timestamp=get_ugandan_time() - timedelta(days=10)
        )
        dummy_withdrawal2 = AdminWithdrawal(
            admin_username='admin',
            amount=120000.0,
            method='bankTransfer',
            details=json.dumps({"bank_name": "Equity Bank", "account_number": "100123456789", "account_name": "Admin Fees"}),
            timestamp=get_ugandan_time() - timedelta(days=5)
        )
        dummy_withdrawal3 = AdminWithdrawal(
            admin_username='admin',
            amount=30000.0,
            method='mobileMoney',
            details=json.dumps({"mobile_number": "256701987654"}),
            timestamp=get_ugandan_time() - timedelta(days=2)
        )
        db.session.add_all([dummy_withdrawal1, dummy_withdrawal2, dummy_withdrawal3])
        db.session.commit()
        print("Database initialized successfully. Admin user 'admin' created with password 'admin123'.")

if __name__ == "__main__":
    reset_database()