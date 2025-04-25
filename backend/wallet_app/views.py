from django.http import JsonResponse
from django.contrib.auth import authenticate, login
from django.contrib.auth.models import User
from django.views.decorators.csrf import csrf_exempt
from .models import Transaction, Profile
import qrcode
import os
import json
import logging
from decimal import Decimal

# Setup logging
logging.basicConfig(filename='error.log', level=logging.ERROR, format='%(asctime)s - %(levelname)s - %(message)s')

# Mock exchange rate (1 NGN = 0.00061 USD)
EXCHANGE_RATE = {
    'NGN_TO_USD': Decimal('0.00061')
}

@csrf_exempt
def register(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            username = data['username']
            password = data['password']
            user = User.objects.create_user(username=username, password=password)
            return JsonResponse({"message": "User registered successfully"}, status=201)
        except json.JSONDecodeError as e:
            logging.error(f"JSON decode error in register: {e}")
            return JsonResponse({"error": "Invalid JSON format"}, status=400)
        except KeyError as e:
            logging.error(f"Key error in register: {e}")
            return JsonResponse({"error": f"Missing field: {str(e)}"}, status=400)
        except Exception as e:
            logging.error(f"Unexpected error in register: {e}")
            return JsonResponse({"error": "Internal server error"}, status=500)
    return JsonResponse({"error": "Method not allowed"}, status=405)

@csrf_exempt
def user_login(request):
    if request.method == 'POST':
        try:
            print("Request body:", request.body)
            data = json.loads(request.body)
            username = data['username']
            password = data['password']
            print(f"Attempting login for username: {username}")
            user = authenticate(request, username=username, password=password)
            if user is not None:
                login(request, user)
                return JsonResponse({"user_id": user.id}, status=200)
            return JsonResponse({"error": "Invalid credentials"}, status=401)
        except json.JSONDecodeError as e:
            logging.error(f"JSON decode error in login: {e}")
            return JsonResponse({"error": "Invalid JSON format"}, status=400)
        except KeyError as e:
            logging.error(f"Key error in login: {e}")
            return JsonResponse({"error": f"Missing field: {str(e)}"}, status=400)
        except Exception as e:
            logging.error(f"Unexpected error in login: {e}")
            return JsonResponse({"error": "Internal server error"}, status=500)
    return JsonResponse({"error": "Method not allowed"}, status=405)

def dashboard(request, user_id):
    if request.method == 'GET':
        try:
            user = User.objects.get(id=user_id)
            profile = user.profile
            balance_ngn = profile.balance
            balance_usd = balance_ngn * EXCHANGE_RATE['NGN_TO_USD']
            transactions = Transaction.objects.filter(user=user).values('amount', 'type', 'timestamp', 'status')
            return JsonResponse({
                "balance_ngn": float(balance_ngn),
                "balance_usd": float(balance_usd),
                "transactions": list(transactions)
            }, status=200)
        except User.DoesNotExist:
            return JsonResponse({"error": "User not found"}, status=404)
        except Exception as e:
            logging.error(f"Unexpected error in dashboard: {e}")
            return JsonResponse({"error": "Internal server error"}, status=500)
    return JsonResponse({"error": "Method not allowed"}, status=405)

@csrf_exempt
def generate_qr(request, user_id):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            amount = data['amount']
            payment_link = f"pay://{user_id}/{amount}"
            qr = qrcode.QRCode()
            qr.add_data(payment_link)
            qr.make(fit=True)
            img = qr.make_image(fill_color="black", back_color="white")
            os.makedirs('static', exist_ok=True)
            img.save(f'static/qr_{user_id}.png')
            return JsonResponse({"qr_url": f"/static/qr_{user_id}.png"}, status=200)
        except json.JSONDecodeError as e:
            logging.error(f"JSON decode error in generate_qr: {e}")
            return JsonResponse({"error": "Invalid JSON format"}, status=400)
        except KeyError as e:
            logging.error(f"Key error in generate_qr: {e}")
            return JsonResponse({"error": f"Missing field: {str(e)}"}, status=400)
        except Exception as e:
            logging.error(f"Unexpected error in generate_qr: {e}")
            return JsonResponse({"error": "Internal server error"}, status=500)
    return JsonResponse({"error": "Method not allowed"}, status=405)

@csrf_exempt
def pay(request, user_id):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            amount = Decimal(data['amount'])
            user = User.objects.get(id=user_id)
            profile = user.profile
            is_offline = data.get('is_offline', False)
            status = 'pending' if is_offline else 'completed'
            if not is_offline:
                if profile.balance >= amount:
                    profile.balance -= amount
                    profile.save()
                else:
                    return JsonResponse({"error": "Insufficient balance"}, status=400)
            Transaction.objects.create(user=user, amount=amount, type='debit', status=status)
            return JsonResponse({
                "message": "Payment queued successfully" if is_offline else "Payment successful",
                "new_balance_ngn": float(profile.balance),
                "new_balance_usd": float(profile.balance * EXCHANGE_RATE['NGN_TO_USD'])
            }, status=200)
        except json.JSONDecodeError as e:
            logging.error(f"JSON decode error in pay: {e}")
            return JsonResponse({"error": "Invalid JSON format"}, status=400)
        except KeyError as e:
            logging.error(f"Key error in pay: {e}")
            return JsonResponse({"error": f"Missing field: {str(e)}"}, status=400)
        except User.DoesNotExist:
            return JsonResponse({"error": "User not found"}, status=404)
        except Exception as e:
            logging.error(f"Unexpected error in pay: {e}")
            return JsonResponse({"error": "Internal server error"}, status=500)
    return JsonResponse({"error": "Method not allowed"}, status=405)

@csrf_exempt
def sync_transactions(request, user_id):
    if request.method == 'POST':
        try:
            user = User.objects.get(id=user_id)
            profile = user.profile
            pending_transactions = Transaction.objects.filter(user=user, status='pending')
            for transaction in pending_transactions:
                if transaction.type == 'debit' and profile.balance >= transaction.amount:
                    profile.balance -= transaction.amount
                    transaction.status = 'completed'
                    transaction.save()
                    profile.save()
                else:
                    return JsonResponse({"error": "Insufficient balance for some transactions"}, status=400)
            return JsonResponse({
                "message": "Transactions synced successfully",
                "new_balance_ngn": float(profile.balance),
                "new_balance_usd": float(profile.balance * EXCHANGE_RATE['NGN_TO_USD'])
            }, status=200)
        except User.DoesNotExist:
            return JsonResponse({"error": "User not found"}, status=404)
        except Exception as e:
            logging.error(f"Unexpected error in sync_transactions: {e}")
            return JsonResponse({"error": "Internal server error"}, status=500)
    return JsonResponse({"error": "Method not allowed"}, status=405)

def user_profile(request, user_id):
    if request.method == 'GET':
        try:
            user = User.objects.get(id=user_id)
            return JsonResponse({
                "username": user.username,
                "email": user.email or "Not set",
                "date_joined": user.date_joined.isoformat()
            }, status=200)
        except User.DoesNotExist:
            return JsonResponse({"error": "User not found"}, status=404)
        except Exception as e:
            logging.error(f"Unexpected error in user_profile: {e}")
            return JsonResponse({"error": "Internal server error"}, status=500)
    return JsonResponse({"error": "Method not allowed"}, status=405)