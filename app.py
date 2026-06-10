from flask import Flask, request, jsonify, send_from_directory, session, redirect, url_for
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
from flask_socketio import SocketIO, emit, join_room
from werkzeug.exceptions import HTTPException
from datetime import datetime, timedelta, timezone
import json
import os
from functools import wraps
import uuid

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev_key_only_for_local_testing')
CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", manage_session=True)

basedir = os.path.abspath(os.path.dirname(__file__))
# Database Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'bchain.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)
migrate = Migrate(app, db)

# Helper function to get Ugandan Local Time (UTC+3)
def get_ugandan_time():
    return datetime.now(timezone.utc) + timedelta(hours=3)

# Helper function to normalize Ugandan contact numbers
def normalize_contact(contact):
    if not contact:
        return ""
    c = str(contact).strip().replace(" ", "").replace("+", "")
    if c.startswith("0") and len(c) == 10:
        c = "256" + c[1:]
    return c

# --- Global Error Handling ---
@app.errorhandler(Exception)
def handle_exception(e):
    """Ensures production users never see raw HTML tracebacks."""
    # If the error is a standard HTTP error (like 404), let Flask handle it normally
    if isinstance(e, HTTPException):
        return e
    app.logger.error(f"CRITICAL ERROR: {str(e)}", exc_info=True)
    return jsonify({"status": "error", "message": "An unexpected server error occurred."}), 500

# --- Database Models ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    full_name = db.Column(db.String(200))
    password_hash = db.Column(db.String(500), nullable=False)
    role = db.Column(db.String(20), default='Reporter')
    collector_type = db.Column(db.String(20)) # 'solid' or 'liquid'
    status = db.Column(db.String(20), default='pending') # pending, active, inactive
    company_name = db.Column(db.String(100))
    location = db.Column(db.String(500))
    contact = db.Column(db.String(20))
    admin_debt = db.Column(db.Float, default=0.0)
    is_available = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'fullName': self.full_name,
            'role': self.role,
            'collectorType': self.collector_type,
            'status': self.status,
            'companyName': self.company_name,
            'location': self.location,
            'contact': self.contact,
            'admin_debt': self.admin_debt or 0.0,
            'is_available': self.is_available
        }

class WasteRequest(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    reporter_username = db.Column(db.String(80), nullable=False)
    reporter_name = db.Column(db.String(100)) # Added to store Full Name at time of request
    collector_username = db.Column(db.String(80))
    location = db.Column(db.String(500))
    parish = db.Column(db.String(100))
    zone = db.Column(db.String(100))
    street = db.Column(db.String(100))
    plot_number = db.Column(db.String(50))
    waste_type = db.Column(db.String(50))
    description = db.Column(db.Text)
    quantity = db.Column(db.Float, default=1.0)
    unit = db.Column(db.String(20)) # 'KGs', 'Litres', or 'Bags'
    unit_price = db.Column(db.Float)
    fee = db.Column(db.Float)
    admin_cut = db.Column(db.Float)
    status = db.Column(db.String(50))
    timestamp = db.Column(db.DateTime, default=get_ugandan_time)
    allocated_company_name = db.Column(db.String(100))
    allocated_company_number = db.Column(db.String(50))
    declined_by = db.Column(db.String(500)) # Comma-separated usernames
    reporter_rating = db.Column(db.Integer)
    system_rating_reporter = db.Column(db.Integer)
    system_rating_collector = db.Column(db.Integer)
    payment_method = db.Column(db.String(50)) # 'cash' or 'mobileMoney'
    payment_ref = db.Column(db.String(100))
    receipt_number = db.Column(db.String(100)) # For cash payments

    def to_dict(self):
        return {
            'id': self.id,
            'reporter_username': self.reporter_username,
            'reporter_name': self.reporter_name or self.reporter_username,
            'collector_username': self.collector_username,
            'location': self.location,
            'parish': self.parish, 'zone': self.zone, 'street': self.street, 'plot_number': self.plot_number,
            'waste_type': self.waste_type, 'description': self.description,
            'quantity': self.quantity, 'unit_price': self.unit_price,
            'unit': self.unit,
            'fee': self.fee or 0.0, 'admin_cut': self.admin_cut or 0.0, 'status': self.status,
            'timestamp': self.timestamp.isoformat(),
            'allocated_company': {'name': self.allocated_company_name, 'number': self.allocated_company_number} if self.allocated_company_name else None,
            'declined_by': self.declined_by.split(',') if self.declined_by else [],
            'reporter_rating': self.reporter_rating, 'system_rating_reporter': self.system_rating_reporter, 'system_rating_collector': self.system_rating_collector,
            'payment_method': self.payment_method, 'payment_ref': self.payment_ref, 'receipt_number': self.receipt_number
        }

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender = db.Column(db.String(80), nullable=False)
    recipient = db.Column(db.String(80), nullable=False)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=get_ugandan_time)
    read = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'sender': self.sender,
            'recipient': self.recipient,
            'content': self.content,
            'timestamp': self.timestamp.isoformat(),
            'read': self.read
        }

# --- System Settings (Rates, Status) ---
class SystemSetting(db.Model):
    key = db.Column(db.String(50), primary_key=True)
    value = db.Column(db.String(500))

class AdminWithdrawal(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    admin_username = db.Column(db.String(80), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    method = db.Column(db.String(50), nullable=False) # 'mobileMoney', 'bankTransfer'
    details = db.Column(db.Text, nullable=False) # JSON string for MM number or bank details
    timestamp = db.Column(db.DateTime, default=get_ugandan_time)

    def to_dict(self):
        return {
            'id': self.id,
            'admin_username': self.admin_username,
            'amount': self.amount,
            'method': self.method,
            'details': json.loads(self.details) if self.details else {},
            'timestamp': self.timestamp.isoformat()
        }

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(basedir, path) # Use basedir to ensure correct root

# --- WebSocket Events ---
@socketio.on('connect')
def handle_connect():
    if 'user' in session:
        join_room(session['user'])
        print(f"User {session['user']} connected to real-time notifications.")

# --- Authentication and Authorization Decorators ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return jsonify({"status": "error", "message": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated_function

def role_required(roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user' not in session:
                return jsonify({"status": "error", "message": "Unauthorized"}), 401
            current_user = User.query.filter_by(username=session['user']).first()
            if not current_user or current_user.role not in roles:
                return jsonify({"status": "error", "message": "Forbidden"}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

# --- User Management Endpoints ---
@app.route('/api/current_user', methods=['GET'])
@login_required
def get_current_user():
    user = User.query.filter_by(username=session['user']).first()
    if user:
        return jsonify(user.to_dict())
    return jsonify({"status": "error", "message": "User not found"}), 404

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return jsonify({"status": "success", "message": "Logged out successfully"}), 200

@app.route('/api/profile', methods=['GET'])
@login_required
def get_profile():
    user = User.query.filter_by(username=session['user']).first()
    if user:
        print(f"Backend: User profile data for {user.username}: {user.to_dict()}")
    if user:
        return jsonify(user.to_dict())
    return jsonify({"status": "error", "message": "User not found"}), 404

@app.route('/api/profile', methods=['POST'])
@login_required
def update_profile():
    data = request.json
    user = User.query.filter_by(username=session['user']).first()
    if not user:
        return jsonify({"status": "error", "message": "User not found"}), 404

    user.full_name = data.get('fullName', user.full_name)
    user.contact = normalize_contact(data.get('contact', user.contact))
    user.location = data.get('location', user.location)
    if user.role == 'Collector': # Only collectors can update company name
        user.company_name = data.get('companyName', user.company_name)
    
    db.session.commit()
    return jsonify({"status": "success", "message": "Profile updated successfully!"})

@app.route('/api/users', methods=['GET'])
@role_required(['Admin'])
def get_users():
    users = User.query.all()
    return jsonify([user.to_dict() for user in users])

@app.route('/api/users/<username>/approve', methods=['POST'])
@role_required(['Admin'])
def approve_user(username):
    user = User.query.filter_by(username=username).first()
    if user:
        user.status = 'active'
        db.session.commit()
        # Send automated approval message
        new_msg = Message(
            sender='System',
            recipient=username,
            content=f"Congratulations {username}! Your account has been approved by the Administrator. You can now access all features."
        )
        db.session.add(new_msg)
        db.session.commit()
        socketio.emit('new_message', new_msg.to_dict(), room=username)
        return jsonify({"status": "success", "message": f"User {username} approved."})
    return jsonify({"status": "error", "message": "User not found"}), 404

@app.route('/api/users/<username>/reject', methods=['POST'])
@role_required(['Admin'])
def reject_user(username):
    user = User.query.filter_by(username=username).first()
    if user:
        db.session.delete(user)
        db.session.commit()
        return jsonify({"status": "success", "message": f"User {username} rejected and deleted."})
    return jsonify({"status": "error", "message": "User not found"}), 404

@app.route('/api/users/<username>/toggle_status', methods=['POST'])
@role_required(['Admin'])
def toggle_user_status(username):
    user = User.query.filter_by(username=username).first()
    if user and user.username != 'admin': # Prevent deactivating admin
        user.status = 'inactive' if user.status == 'active' else 'active'
        db.session.commit()
        return jsonify({"status": "success", "message": f"User {username} status toggled to {user.status}."})
    return jsonify({"status": "error", "message": "User not found or cannot toggle admin status"}), 404

@app.route('/api/users/<username>/delete', methods=['DELETE'])
@role_required(['Admin'])
def delete_user(username):
    user = User.query.filter_by(username=username).first()
    if user and user.username != 'admin': # Prevent deleting admin
        db.session.delete(user)
        db.session.commit()
        return jsonify({"status": "success", "message": f"User {username} deleted."})
    return jsonify({"status": "error", "message": "User not found or cannot delete admin"}), 404

@app.route('/api/users/availability', methods=['POST'])
@role_required(['Collector'])
def toggle_availability():
    user = User.query.filter_by(username=session['user']).first()
    data = request.json
    user.is_available = data.get('available', True)
    db.session.commit()
    return jsonify({"status": "success", "available": user.is_available})

@app.route('/api/admin/clear_all', methods=['POST'])
@role_required(['Admin'])
def clear_all_records():
    if session['user'] != 'admin':
        return jsonify({"status": "error", "message": "Only the super-admin can clear all records."}), 403
    try:
        # Clear all entries from the WasteRequest table
        WasteRequest.query.delete()
        db.session.commit()
        return jsonify({"status": "success", "message": "All system transaction records have been cleared."})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/settings/<key>', methods=['GET'])
def get_setting(key):
    setting = SystemSetting.query.filter_by(key=key).first()
    if setting:
        return jsonify({"key": setting.key, "value": setting.value})
    return jsonify({"status": "error", "message": "Setting not found"}), 404

@app.route('/api/waste_requests', methods=['GET'])
@login_required
def get_waste_requests():
    current_user = User.query.filter_by(username=session['user']).first()
    if current_user.role == 'Admin':
        requests = WasteRequest.query.all()
    elif current_user.role == 'Collector':
        requests = WasteRequest.query.filter_by(collector_username=current_user.username).all()
    else:
        requests = WasteRequest.query.filter_by(reporter_username=current_user.username).all()
    return jsonify([r.to_dict() for r in requests])

@app.route('/api/waste_requests', methods=['POST'])
@login_required
def create_waste_request():
    data = request.json
    new_id = str(uuid.uuid4())[:8].upper()
    user = User.query.filter_by(username=session['user']).first()
    
    try:
        new_request = WasteRequest(
            id=new_id,
            reporter_username=session['user'],
            reporter_name=user.full_name if user else session['user'],
            collector_username=data.get('collector_username'),
            location=data.get('location'),
            parish=data.get('parish'),
            zone=data.get('zone'),
            street=data.get('street'),
            plot_number=data.get('plotNumber'),
            waste_type=data.get('wasteType'),
            description=data.get('description'),
            quantity=data.get('quantity'),
            unit=data.get('unit'),
            unit_price=data.get('unit_price'),
            fee=data.get('fee', 0.0), # Fee is still sent from frontend
            status=data.get('status', 'Pending'),
            payment_method=data.get('paymentMethod'),
            payment_ref=data.get('paymentRef'),
            allocated_company_name=data.get('allocated_company_name'),
            allocated_company_number=data.get('allocated_company_number')
        )
        new_request.admin_cut = new_request.fee * 0.02 # Calculate admin_cut on the backend
        db.session.add(new_request)
        db.session.commit()
        return jsonify({"status": "success", "id": new_id})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"Database error: {str(e)}"}), 500

@app.route('/api/waste_requests/available', methods=['GET'])
@role_required(['Collector'])
def get_available_requests():
    current_user = User.query.filter_by(username=session['user']).first()
    
    # Tasks that match the collector's specialty AND are either:
    # 1. Specifically pre-assigned to them by the reporter
    # 2. Unassigned (after a decline) but matching their waste type
    requests = WasteRequest.query.filter(
        WasteRequest.status.in_(['Paid (mobileMoney)', 'Pending (Cash)']),
        WasteRequest.waste_type == current_user.collector_type,
        (WasteRequest.collector_username == current_user.username) | (WasteRequest.collector_username.is_(None))
    ).all()
    
    # Filter out requests this specific collector has already declined
    available = [r.to_dict() for r in requests if session['user'] not in (r.declined_by or [])]
    return jsonify(available)

@app.route('/api/waste_requests/<request_id>/accept', methods=['POST'])
@role_required(['Collector'])
def accept_request(request_id):
    req = WasteRequest.query.get(request_id)
    # Allow acceptance if unassigned OR if specifically pre-assigned to the current user
    if req and (not req.collector_username or req.collector_username == session['user']):
        req.collector_username = session['user']
        req.status = 'Accepted'
        # Notify Reporter
        new_msg = Message(
            sender='System',
            recipient=req.reporter_username,
            content=f"Notification: Your waste request at {req.location} has been ACCEPTED by {session['user']}."
        )
        db.session.add(new_msg)
        db.session.commit()
        
        # Real-time UI refresh for Reporter
        socketio.emit('task_status_update', {'id': request_id, 'status': 'Accepted'}, room=req.reporter_username)
        
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Task already taken or not found"}), 404

@app.route('/api/waste_requests/<request_id>/decline', methods=['POST'])
@role_required(['Collector'])
def decline_request(request_id):
    req = WasteRequest.query.get(request_id)
    if req:
        current_declines = req.declined_by.split(',') if req.declined_by else []
        if session['user'] not in current_declines:
            current_declines.append(session['user'])
            req.declined_by = ','.join(current_declines)
            # Clear specific allocation so it becomes available to other companies of the same type
            req.collector_username = None
            req.allocated_company_name = None
            req.allocated_company_number = None
            db.session.commit()
            return jsonify({"status": "success", "message": "Request declined."})
    return jsonify({"status": "error", "message": "Request not found"}), 404

@app.route('/api/waste_requests/<request_id>/complete', methods=['POST'])
@role_required(['Collector'])
def complete_request(request_id):
    req = WasteRequest.query.get(request_id)
    # Ensure the task is currently 'Accepted' before allowing completion
    if req and req.collector_username == session['user'] and req.status == 'Accepted':
        req.status = 'Completed'
        
        # Handle Debt Tracking for Cash Payments
        if req.payment_method == 'cash':
            collector = User.query.filter_by(username=session['user']).first()
            collector.admin_debt = (collector.admin_debt or 0.0) + (req.admin_cut or 0.0)
            
        req.receipt_number = request.json.get('receiptNumber')
        # Notify Reporter
        new_msg = Message(
            sender='System',
            recipient=req.reporter_username,
            content=f"Notification: Your waste request at {req.location} has been marked as COMPLETED. Please rate the service!"
        )
        db.session.add(new_msg)
        db.session.commit()

        # Real-time UI refresh for Reporter
        socketio.emit('task_status_update', {'id': request_id, 'status': 'Completed'}, room=req.reporter_username)

        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Unauthorized or not found"}), 403

@app.route('/api/collectors/active', methods=['GET'])
def get_active_collectors():
    # Only return collectors who are ACTIVE and ON DUTY (available)
    collectors = User.query.filter_by(role='Collector', status='active', is_available=True).all()
    return jsonify([c.to_dict() for c in collectors])

@app.route('/api/settings/<key>', methods=['POST'])
@role_required(['Admin'])
def update_setting(key):
    setting = SystemSetting.query.filter_by(key=key).first()
    if not setting:
        setting = SystemSetting(key=key)
        db.session.add(setting)
    
    setting.value = request.json.get('value')
    db.session.commit()
    return jsonify({"status": "success", "message": "Setting updated"})

@app.route('/api/waste_requests/<request_id>/rate', methods=['POST'])
@login_required
def rate_request(request_id):
    req = WasteRequest.query.get(request_id)
    if not req:
        return jsonify({"status": "error", "message": "Request not found"}), 404
    
    data = request.json
    user = User.query.filter_by(username=session['user']).first()
    
    if user.role == 'Reporter':
        req.reporter_rating = data.get('collectorRating')
        req.system_rating_reporter = data.get('systemRating')
    elif user.role == 'Collector':
        req.system_rating_collector = data.get('systemRating')
        
    db.session.commit()
    return jsonify({"status": "success", "message": "Rating submitted"})

@app.route('/api/admin/analytics', methods=['GET'])
@role_required(['Admin'])
def get_analytics():
    requests = WasteRequest.query.all()
    
    # Status counts
    stats = {
        "pending": len([r for r in requests if 'Pending' in r.status]),
        "confirmed": len([r for r in requests if r.status == 'Accepted']),
        "completed": len([r for r in requests if r.status == 'Completed']),
        "hotspots": {}
    }
    
    # Calculate Hotspots (Parish-based accumulation)
    for r in requests:
        if r.parish:
            stats["hotspots"][r.parish] = stats["hotspots"].get(r.parish, 0) + 1
            
    return jsonify(stats)

@app.route('/api/admin/financial_summary', methods=['GET'])
@role_required(['Admin'])
def get_financial_summary():
    # Total earned from completed requests
    completed_requests = WasteRequest.query.filter_by(status='Completed').all()
    total_earned = sum(r.admin_cut or 0.0 for r in completed_requests)

    # Total withdrawn
    withdrawals = AdminWithdrawal.query.all()
    total_withdrawn = sum(w.amount for w in withdrawals)

    return jsonify({
        "total_admin_cut_earned": total_earned,
        "total_admin_cut_withdrawn": total_withdrawn,
        "available_for_withdrawal": total_earned - total_withdrawn
    })

@app.route('/api/admin/withdrawals', methods=['GET'])
@role_required(['Admin'])
def get_withdrawals():
    withdrawals = AdminWithdrawal.query.order_by(AdminWithdrawal.timestamp.desc()).all()
    return jsonify([w.to_dict() for w in withdrawals])

@app.route('/api/admin/withdraw_fees', methods=['POST'])
@role_required(['Admin'])
def withdraw_fees():
    data = request.json
    amount = float(data.get('amount', 0))
    method = data.get('method')
    details = data.get('details')

    # Server-side validation of available funds
    completed_requests = WasteRequest.query.filter_by(status='Completed').all()
    total_earned = sum(r.admin_cut or 0.0 for r in completed_requests)
    withdrawals = AdminWithdrawal.query.all()
    total_withdrawn = sum(w.amount for w in withdrawals)
    available = total_earned - total_withdrawn

    if amount <= 0 or amount > available:
        return jsonify({"status": "error", "message": "Invalid amount or insufficient funds"}), 400

    new_withdrawal = AdminWithdrawal(
        admin_username=session['user'],
        amount=amount,
        method=method,
        details=json.dumps(details)
    )
    db.session.add(new_withdrawal)
    db.session.commit()
    return jsonify({"status": "success", "message": "Withdrawal processed."})

@app.route('/api/admin/recalculate_admin_cuts', methods=['POST'])
@role_required(['Admin'])
def recalculate_cuts():
    requests = WasteRequest.query.all()
    for r in requests:
        if r.fee:
            r.admin_cut = r.fee * 0.02
    db.session.commit()
    return jsonify({"status": "success", "message": "Admin cuts recalculated for all records."})

@app.route('/api/messages', methods=['GET'])
@login_required
def get_messages():
    partner = request.args.get('partner')
    me = session['user']
    if partner:
        messages = Message.query.filter(
            ((Message.sender == me) & (Message.recipient == partner)) |
            ((Message.sender == partner) & (Message.recipient == me))
        ).order_by(Message.timestamp.asc()).all()
        
        # Serialize to dicts BEFORE the commit to avoid ObjectDeletedError during concurrent deletes
        messages_data = [m.to_dict() for m in messages]

        # Mark received messages as read
        unread = Message.query.filter_by(sender=partner, recipient=me, read=False).all()
        for m in unread:
            m.read = True
        db.session.commit()
        return jsonify(messages_data)
    else:
        messages = Message.query.filter((Message.sender == me) | (Message.recipient == me)).all()
        return jsonify([m.to_dict() for m in messages])

@app.route('/api/messages', methods=['POST'])
@login_required
def send_message():
    data = request.json
    new_msg = Message(
        sender=session['user'],
        recipient=data.get('recipient'),
        content=data.get('content')
    )
    db.session.add(new_msg)
    db.session.commit()

    # Notify the recipient in real-time via WebSocket
    socketio.emit('new_message', new_msg.to_dict(), room=data.get('recipient'))

    return jsonify({"status": "success", "message": new_msg.to_dict()})

@app.route('/api/messages/<int:msg_id>', methods=['DELETE'])
@login_required
def delete_message(msg_id):
    msg = Message.query.get(msg_id)
    if msg and (msg.sender == session['user'] or msg.recipient == session['user']):
        db.session.delete(msg)
        db.session.commit()
        return jsonify({"status": "success"})
    return jsonify({"status": "error", "message": "Unauthorized"}), 403

@app.route('/register', methods=['POST'])
def register():
    try:
        status_setting = SystemSetting.query.filter_by(key='system_status').first()
        if status_setting and status_setting.value == 'off':
            return jsonify({"status": "error", "message": "System is currently undergoing maintenance. Registration is temporarily disabled."}), 503

        data = request.json
        if not data:
            return jsonify({"status": "error", "message": "No data provided"}), 400
            
        username = data.get('username')
        password = data.get('password')
        role = data.get('role', 'Reporter')
        company_name = data.get('companyName')

        if not username or not password or not data.get('contact') or not data.get('location'):
            return jsonify({"status": "error", "message": "Registration denied. All fields are required."}), 400

        if len(username) > 80:
            return jsonify({"status": "error", "message": "Username cannot exceed 80 characters."}), 400

        if role == 'Collector' and not company_name:
            return jsonify({"status": "error", "message": "Registration denied. Company Name is required for collector accounts."}), 400
        
        if User.query.filter_by(username=username).first():
            return jsonify({"status": "error", "message": "User already exists"}), 400

        new_user = User(
            username=username,
            full_name=data.get('fullName', username),
            password_hash=generate_password_hash(password),
            role=role,
            collector_type=data.get('collectorType'),
            company_name=company_name,
            location=data.get('location'),
            contact=normalize_contact(data.get('contact'))
        )

        db.session.add(new_user)
        db.session.commit()
        print(f"New Registration: {username}")
        return jsonify({"status": "success", "message": f"User {username} registered successfully! Awaiting admin approval."}), 201
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Registration Error: {str(e)}", exc_info=True)
        return jsonify({"status": "error", "message": f"Server Error: {str(e)}"}), 500

@app.route('/api/reset_password', methods=['POST'])
def reset_password():
    data = request.json
    username = data.get('username')
    contact = normalize_contact(data.get('contact'))
    new_password = data.get('password')
    
    user = User.query.filter_by(username=username).first()
    if user:
        if user.username == 'admin':
            return jsonify({"status": "error", "message": "Admin password cannot be reset via this form for security reasons."}), 403
        
        if normalize_contact(user.contact) != contact:
            return jsonify({"status": "error", "message": "Verification failed: Contact number does not match our records."}), 403

        user.password_hash = generate_password_hash(new_password)
        db.session.commit()
        return jsonify({"status": "success", "message": "Password has been reset successfully. You can now log in with your new password."})
    
    return jsonify({"status": "error", "message": "Username not found"}), 404

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data.get('username')).first()
    
    if user and check_password_hash(user.password_hash, data.get('password')):
        # Check maintenance status for non-admin users
        status_setting = SystemSetting.query.filter_by(key='system_status').first()
        if status_setting and status_setting.value == 'off' and user.role != 'Admin':
            return jsonify({"status": "error", "message": "The system is currently undergoing maintenance. Only administrators can log in at this time."}), 503

        if user.status == 'pending':
            return jsonify({"status": "error", "message": "Account awaiting admin approval"}), 403
        if user.status == 'inactive':
            return jsonify({"status": "error", "message": "Account deactivated"}), 403
            
        session['user'] = user.username
        return jsonify({
            "status": "success", 
            "role": user.role,
            "username": user.username
        })
    return jsonify({"status": "error", "message": "Invalid credentials"}), 401

# Initialize Database and default values immediately on startup
# The db.create_all() and initial data seeding should be handled by init_db.py
# and Flask-Migrate for schema management.
# This block is removed to prevent conflicts with Flask-Migrate in production.
# For development, run `python init_db.py` once, then `flask db init`, `flask db migrate`, `flask db upgrade`.

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', debug=True, port=5000)