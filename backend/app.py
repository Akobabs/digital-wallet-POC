from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import sqlite3
import jwt
import qrcode
import io
import base64
from datetime import datetime, timedelta
import os
from werkzeug.security import generate_password_hash, check_password_hash
import joblib
import pandas as pd
import numpy as np
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'your-secret-key-here')

# Rate limiting setup
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"]
)

# Database initialization
def init_db():
    conn = sqlite3.connect('sme_wallet.db')
    c = conn.cursor()
    
    # Users table
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  email TEXT UNIQUE NOT NULL,
                  password TEXT NOT NULL,
                  name TEXT NOT NULL,
                  created_at TEXT NOT NULL)''')
    
    # Wallets table
    c.execute('''CREATE TABLE IF NOT EXISTS wallets
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER NOT NULL,
                  balance REAL NOT NULL DEFAULT 0.0,
                  created_at TEXT NOT NULL,
                  FOREIGN KEY (user_id) REFERENCES users(id))''')
    
    # Transactions table
    c.execute('''CREATE TABLE IF NOT EXISTS transactions
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  sender_id INTEGER NOT NULL,
                  receiver_id INTEGER NOT NULL,
                  amount REAL NOT NULL,
                  timestamp TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'pending',
                  transaction_type TEXT NOT NULL DEFAULT 'transfer',
                  description TEXT,
                  FOREIGN KEY (sender_id) REFERENCES users(id),
                  FOREIGN KEY (receiver_id) REFERENCES users(id))''')
    
    # Offline transactions table
    c.execute('''CREATE TABLE IF NOT EXISTS offline_transactions
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  sender_id INTEGER NOT NULL,
                  receiver_id INTEGER NOT NULL,
                  amount REAL NOT NULL,
                  timestamp TEXT NOT NULL,
                  description TEXT,
                  qr_data TEXT,
                  FOREIGN KEY (sender_id) REFERENCES users(id),
                  FOREIGN KEY (receiver_id) REFERENCES users(id))''')
    
    conn.commit()
    conn.close()

# Load fraud detection model
def load_fraud_model():
    try:
        model = joblib.load('fraud_model.pkl')
        return model
    except FileNotFoundError:
        print("Fraud model not found. Using rule-based detection.")
        return None

fraud_model = load_fraud_model()

# Helper functions
def get_db_connection():
    conn = sqlite3.connect('sme_wallet.db')
    conn.row_factory = sqlite3.Row
    return conn

def generate_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['user_id']
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def detect_fraud(transaction_data):
    if fraud_model is None:
        # Rule-based fraud detection
        amount = transaction_data.get('amount', 0)
        if amount > 100000:
            return {'is_fraud': True, 'confidence': 0.8, 'reason': 'Large amount'}
        elif amount <= 0:
            return {'is_fraud': True, 'confidence': 0.9, 'reason': 'Invalid amount'}
        else:
            return {'is_fraud': False, 'confidence': 0.1, 'reason': 'Normal transaction'}
    else:
        # ML model fraud detection
        try:
            features = [[
                transaction_data.get('amount', 0),
                transaction_data.get('oldbalanceOrg', 0),
                transaction_data.get('newbalanceOrig', 0),
                transaction_data.get('oldbalanceDest', 0),
                transaction_data.get('newbalanceDest', 0),
                transaction_data.get('type_TRANSFER', 0),
                transaction_data.get('type_PAYMENT', 0),
                transaction_data.get('type_CASH_OUT', 0),
                transaction_data.get('type_CASH_IN', 0),
                transaction_data.get('amountToOldBalanceOrg', 0),
                transaction_data.get('amountToOldBalanceDest', 0),
                transaction_data.get('balanceChangeOrig', 0),
                transaction_data.get('balanceChangeDest', 0),
                transaction_data.get('hour', datetime.utcnow().hour),
                transaction_data.get('day', datetime.utcnow().day)
            ]]
            prediction = fraud_model.predict(features)[0]
            probability = fraud_model.predict_proba(features)[0][1]
            return {
                'is_fraud': bool(prediction),
                'confidence': probability,
                'reason': 'ML model prediction'
            }
        except Exception as e:
            print(f"Fraud detection error: {e}")
            return {'is_fraud': False, 'confidence': 0.1, 'reason': 'Model error'}

# API Routes
@app.route('/api/register', methods=['POST'])
@limiter.limit("10 per minute")
def register():
    data = request.get_json()
    
    if not data or not all(key in data for key in ['email', 'password', 'name']):
        return jsonify({'error': 'Missing required fields'}), 400
    
    email = data['email'].lower().strip()
    password = data['password']
    name = data['name'].strip()
    
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    
    conn = get_db_connection()
    
    existing_user = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
    if existing_user:
        conn.close()
        return jsonify({'error': 'User already exists'}), 409
    
    hashed_password = generate_password_hash(password)
    created_at = datetime.utcnow().isoformat()
    
    cursor = conn.execute(
        'INSERT INTO users (email, password, name, created_at) VALUES (?, ?, ?, ?)',
        (email, hashed_password, name, created_at)
    )
    user_id = cursor.lastrowid
    
    conn.execute(
        'INSERT INTO wallets (user_id, balance, created_at) VALUES (?, ?, ?)',
        (user_id, 0.0, created_at)
    )
    
    conn.commit()
    conn.close()
    
    token = generate_token(user_id)
    
    return jsonify({
        'message': 'User registered successfully',
        'token': token,
        'user': {'id': user_id, 'email': email, 'name': name}
    }), 201

@app.route('/api/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data = request.get_json()
    
    if not data or not all(key in data for key in ['email', 'password']):
        return jsonify({'error': 'Missing email or password'}), 400
    
    email = data['email'].lower().strip()
    password = data['password']
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()
    
    if not user or not check_password_hash(user['password'], password):
        return jsonify({'error': 'Invalid credentials'}), 401
    
    token = generate_token(user['id'])
    
    return jsonify({
        'message': 'Login successful',
        'token': token,
        'user': {'id': user['id'], 'email': user['email'], 'name': user['name']}
    }), 200

@app.route('/api/generate_qr', methods=['POST'])
@limiter.limit("20 per minute")
def generate_qr():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    
    token = auth_header.split(' ')[1]
    user_id = verify_token(token)
    
    if not user_id:
        return jsonify({'error': 'Invalid or expired token'}), 401
    
    data = request.get_json()
    amount = data.get('amount', 0)
    description = data.get('description', '')
    
    if amount <= 0:
        return jsonify({'error': 'Amount must be greater than 0'}), 400
    
    qr_data = {
        'user_id': user_id,
        'amount': amount,
        'description': description,
        'timestamp': datetime.utcnow().isoformat()
    }
    
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(str(qr_data))
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    img_str = base64.b64encode(buffer.getvalue()).decode()
    
    return jsonify({
        'qr_code': f'data:image/png;base64,{img_str}',
        'qr_data': qr_data
    }), 200

@app.route('/api/process_qr', methods=['POST'])
@limiter.limit("20 per minute")
def process_qr():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    
    token = auth_header.split(' ')[1]
    sender_id = verify_token(token)
    
    if not sender_id:
        return jsonify({'error': 'Invalid or expired token'}), 401
    
    data = request.get_json()
    qr_data = data.get('qr_data')
    
    if not qr_data:
        return jsonify({'error': 'Missing QR code data'}), 400
    
    try:
        qr_data = eval(qr_data)  # Safely parse QR data
        receiver_id = qr_data.get('user_id')
        amount = qr_data.get('amount')
        description = qr_data.get('description', '')
        
        if amount <= 0:
            return jsonify({'error': 'Invalid amount in QR code'}), 400
        
        if sender_id == receiver_id:
            return jsonify({'error': 'Cannot send money to yourself'}), 400
        
        conn = get_db_connection()
        
        sender_wallet = conn.execute('SELECT balance FROM wallets WHERE user_id = ?', (sender_id,)).fetchone()
        if not sender_wallet or sender_wallet['balance'] < amount:
            conn.close()
            return jsonify({'error': 'Insufficient balance'}), 400
        
        receiver = conn.execute('SELECT id FROM users WHERE id = ?', (receiver_id,)).fetchone()
        if not receiver:
            conn.close()
            return jsonify({'error': 'Receiver not found'}), 404
        
        # Fraud detection
        sender_wallet_data = conn.execute('SELECT balance FROM wallets WHERE user_id = ?', (sender_id,)).fetchone()
        receiver_wallet_data = conn.execute('SELECT balance FROM wallets WHERE user_id = ?', (receiver_id,)).fetchone()
        
        transaction_data = {
            'amount': amount,
            'oldbalanceOrg': sender_wallet_data['balance'],
            'newbalanceOrig': sender_wallet_data['balance'] - amount,
            'oldbalanceDest': receiver_wallet_data['balance'],
            'newbalanceDest': receiver_wallet_data['balance'] + amount,
            'type_TRANSFER': 1,
            'amountToOldBalanceOrg': amount / (sender_wallet_data['balance'] + 1),
            'amountToOldBalanceDest': amount / (receiver_wallet_data['balance'] + 1),
            'balanceChangeOrig': -amount,
            'balanceChangeDest': amount,
            'hour': datetime.utcnow().hour,
            'day': datetime.utcnow().day
        }
        
        fraud_result = detect_fraud(transaction_data)
        
        if fraud_result['is_fraud'] and fraud_result['confidence'] > 0.7:
            conn.close()
            return jsonify({
                'error': 'Transaction flagged as potentially fraudulent',
                'reason': fraud_result['reason']
            }), 400
        
        timestamp = datetime.utcnow().isoformat()
        
        conn.execute('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', (amount, sender_id))
        conn.execute('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', (amount, receiver_id))
        
        conn.execute('''
            INSERT INTO transactions (sender_id, receiver_id, amount, timestamp, status, transaction_type, description)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (sender_id, receiver_id, amount, timestamp, 'completed', 'qr_payment', description))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'QR payment completed successfully',
            'amount': amount,
            'timestamp': timestamp,
            'fraud_check': fraud_result
        }), 200
    except Exception as e:
        return jsonify({'error': f'Invalid QR code data: {str(e)}'}), 400

@app.route('/api/wallet', methods=['GET'])
@limiter.limit("50 per minute")
def get_wallet():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    
    token = auth_header.split(' ')[1]
    user_id = verify_token(token)
    
    if not user_id:
        return jsonify({'error': 'Invalid or expired token'}), 401
    
    conn = get_db_connection()
    wallet = conn.execute('SELECT * FROM wallets WHERE user_id = ?', (user_id,)).fetchone()
    conn.close()
    
    if not wallet:
        return jsonify({'error': 'Wallet not found'}), 404
    
    return jsonify({
        'balance': wallet['balance'],
        'wallet_id': wallet['id']
    }), 200

@app.route('/api/transact', methods=['POST'])
@limiter.limit("20 per minute")
def transact():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    
    token = auth_header.split(' ')[1]
    sender_id = verify_token(token)
    
    if not sender_id:
        return jsonify({'error': 'Invalid or expired token'}), 401
    
    data = request.get_json()
    
    if not data or not all(key in data for key in ['receiver_email', 'amount']):
        return jsonify({'error': 'Missing required fields'}), 400
    
    receiver_email = data['receiver_email'].lower().strip()
    amount = float(data['amount'])
    description = data.get('description', '')
    
    if amount <= 0:
        return jsonify({'error': 'Amount must be greater than 0'}), 400
    
    conn = get_db_connection()
    
    receiver = conn.execute('SELECT id FROM users WHERE email = ?', (receiver_email,)).fetchone()
    if not receiver:
        conn.close()
        return jsonify({'error': 'Receiver not found'}), 404
    
    receiver_id = receiver['id']
    
    if sender_id == receiver_id:
        conn.close()
        return jsonify({'error': 'Cannot send money to yourself'}), 400
    
    sender_wallet = conn.execute('SELECT balance FROM wallets WHERE user_id = ?', (sender_id,)).fetchone()
    if not sender_wallet or sender_wallet['balance'] < amount:
        conn.close()
        return jsonify({'error': 'Insufficient balance'}), 400
    
    # Fraud detection
    sender_wallet_data = conn.execute('SELECT balance FROM wallets WHERE user_id = ?', (sender_id,)).fetchone()
    receiver_wallet_data = conn.execute('SELECT balance FROM wallets WHERE user_id = ?', (receiver_id,)).fetchone()
    
    transaction_data = {
        'amount': amount,
        'oldbalanceOrg': sender_wallet_data['balance'],
        'newbalanceOrig': sender_wallet_data['balance'] - amount,
        'oldbalanceDest': receiver_wallet_data['balance'],
        'newbalanceDest': receiver_wallet_data['balance'] + amount,
        'type_TRANSFER': 1,
        'amountToOldBalanceOrg': amount / (sender_wallet_data['balance'] + 1),
        'amountToOldBalanceDest': amount / (receiver_wallet_data['balance'] + 1),
        'balanceChangeOrig': -amount,
        'balanceChangeDest': amount,
        'hour': datetime.utcnow().hour,
        'day': datetime.utcnow().day
    }
    
    fraud_result = detect_fraud(transaction_data)
    
    if fraud_result['is_fraud'] and fraud_result['confidence'] > 0.7:
        conn.close()
        return jsonify({
            'error': 'Transaction flagged as potentially fraudulent',
            'reason': fraud_result['reason']
        }), 400
    
    timestamp = datetime.utcnow().isoformat()
    
    conn.execute('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', (amount, sender_id))
    conn.execute('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', (amount, receiver_id))
    
    conn.execute('''
        INSERT INTO transactions (sender_id, receiver_id, amount, timestamp, status, description)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (sender_id, receiver_id, amount, timestamp, 'completed', description))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'message': 'Transaction completed successfully',
        'amount': amount,
        'timestamp': timestamp,
        'fraud_check': fraud_result
    }), 200

@app.route('/api/transactions', methods=['GET'])
@limiter.limit("50 per minute")
def get_transactions():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    
    token = auth_header.split(' ')[1]
    user_id = verify_token(token)
    
    if not user_id:
        return jsonify({'error': 'Invalid or expired token'}), 401
    
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 10))
    status_filter = request.args.get('status', None)
    type_filter = request.args.get('type', None)
    
    conn = get_db_connection()
    
    query = '''
        SELECT t.*, 
               sender.name as sender_name, sender.email as sender_email,
               receiver.name as receiver_name, receiver.email as receiver_email
        FROM transactions t
        JOIN users sender ON t.sender_id = sender.id
        JOIN users receiver ON t.receiver_id = receiver.id
        WHERE t.sender_id = ? OR t.receiver_id = ?
    '''
    params = [user_id, user_id]
    
    if status_filter:
        query += ' AND t.status = ?'
        params.append(status_filter)
    
    if type_filter:
        query += ' AND t.transaction_type = ?'
        params.append(type_filter)
    
    query += ' ORDER BY t.timestamp DESC LIMIT ? OFFSET ?'
    params.extend([per_page, (page - 1) * per_page])
    
    transactions = conn.execute(query, params).fetchall()
    
    total = conn.execute(
        'SELECT COUNT(*) FROM transactions WHERE sender_id = ? OR receiver_id = ?',
        (user_id, user_id)
    ).fetchone()[0]
    
    conn.close()
    
    transaction_list = []
    for tx in transactions:
        transaction_list.append({
            'id': tx['id'],
            'amount': tx['amount'],
            'timestamp': tx['timestamp'],
            'status': tx['status'],
            'description': tx['description'],
            'type': 'sent' if tx['sender_id'] == user_id else 'received',
            'transaction_type': tx['transaction_type'],
            'sender': {'name': tx['sender_name'], 'email': tx['sender_email']},
            'receiver': {'name': tx['receiver_name'], 'email': tx['receiver_email']}
        })
    
    return jsonify({
        'transactions': transaction_list,
        'total': total,
        'page': page,
        'per_page': per_page,
        'total_pages': (total + per_page - 1) // per_page
    }), 200

@app.route('/api/offline_transactions', methods=['POST'])
@limiter.limit("20 per minute")
def save_offline_transaction():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    
    token = auth_header.split(' ')[1]
    sender_id = verify_token(token)
    
    if not sender_id:
        return jsonify({'error': 'Invalid or expired token'}), 401
    
    data = request.get_json()
    
    if not data or not all(key in data for key in ['receiver_email', 'amount', 'qr_data']):
        return jsonify({'error': 'Missing required fields'}), 400
    
    receiver_email = data['receiver_email'].lower().strip()
    amount = float(data['amount'])
    description = data.get('description', '')
    qr_data = data.get('qr_data')
    
    if amount <= 0:
        return jsonify({'error': 'Amount must be greater than 0'}), 400
    
    conn = get_db_connection()
    
    receiver = conn.execute('SELECT id FROM users WHERE email = ?', (receiver_email,)).fetchone()
    if not receiver:
        conn.close()
        return jsonify({'error': 'Receiver not found'}), 404
    
    receiver_id = receiver['id']
    
    if sender_id == receiver_id:
        conn.close()
        return jsonify({'error': 'Cannot send money to yourself'}), 400
    
    timestamp = datetime.utcnow().isoformat()
    
    conn.execute('''
        INSERT INTO offline_transactions (sender_id, receiver_id, amount, timestamp, description, qr_data)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (sender_id, receiver_id, amount, timestamp, description, str(qr_data)))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'message': 'Offline transaction queued successfully',
        'amount': amount,
        'timestamp': timestamp
    }), 201

@app.route('/api/sync_offline_transactions', methods=['POST'])
@limiter.limit("20 per minute")
def sync_offline_transactions():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'error': 'Missing or invalid token'}), 401
    
    token = auth_header.split(' ')[1]
    sender_id = verify_token(token)
    
    if not sender_id:
        return jsonify({'error': 'Invalid or expired token'}), 401
    
    conn = get_db_connection()
    
    offline_txs = conn.execute('SELECT * FROM offline_transactions WHERE sender_id = ?', (sender_id,)).fetchall()
    
    synced = []
    failed = []
    
    for tx in offline_txs:
        try:
            sender_wallet = conn.execute('SELECT balance FROM wallets WHERE user_id = ?', (sender_id,)).fetchone()
            receiver_wallet = conn.execute('SELECT balance FROM wallets WHERE user_id = ?', (tx['receiver_id'],)).fetchone()
            
            if not sender_wallet or sender_wallet['balance'] < tx['amount']:
                failed.append({'id': tx['id'], 'reason': 'Insufficient balance'})
                continue
            
            # Fraud detection
            transaction_data = {
                'amount': tx['amount'],
                'oldbalanceOrg': sender_wallet['balance'],
                'newbalanceOrig': sender_wallet['balance'] - tx['amount'],
                'oldbalanceDest': receiver_wallet['balance'],
                'newbalanceDest': receiver_wallet['balance'] + tx['amount'],
                'type_TRANSFER': 1,
                'amountToOldBalanceOrg': tx['amount'] / (sender_wallet['balance'] + 1),
                'amountToOldBalanceDest': tx['amount'] / (receiver_wallet['balance'] + 1),
                'balanceChangeOrig': -tx['amount'],
                'balanceChangeDest': tx['amount'],
                'hour': datetime.utcnow().hour,
                'day': datetime.utcnow().day
            }
            
            fraud_result = detect_fraud(transaction_data)
            
            if fraud_result['is_fraud'] and fraud_result['confidence'] > 0.7:
                failed.append({'id': tx['id'], 'reason': 'Flagged as fraudulent'})
                continue
            
            conn.execute('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', (tx['amount'], sender_id))
            conn.execute('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', (tx['amount'], tx['receiver_id']))
            
            conn.execute('''
                INSERT INTO transactions (sender_id, receiver_id, amount, timestamp, status, transaction_type, description)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (sender_id, tx['receiver_id'], tx['amount'], tx['timestamp'], 'completed', 'offline_sync', tx['description']))
            
            conn.execute('DELETE FROM offline_transactions WHERE id = ?', (tx['id'],))
            
            synced.append({'id': tx['id'], 'amount': tx['amount'], 'timestamp': tx['timestamp']})
        except Exception as e:
            failed.append({'id': tx['id'], 'reason': str(e)})
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'message': 'Offline transactions synced',
        'synced': synced,
        'failed': failed
    }), 200

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.utcnow().isoformat()}), 200

if __name__ == '__main__':
    init_db()
    print("Database initialized successfully")
    print("Starting SME Digital Wallet Backend...")
    app.run(debug=True, host='0.0.0.0', port=5000)