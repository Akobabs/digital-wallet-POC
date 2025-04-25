# Digital Wallet PoC
A basic proof-of-concept (PoC) prototype of a functional digital wallet  with core functionalities, such as a simple user interface, mock payment processing, and QR code generation.

A basic prototype for a digital wallet for Nigerian SMEs using Django, SQLite3, and React.

## Setup
1. Install Python and Node.js.
2. Backend:
   - `cd backend`
   - `source venv/bin/activate` (or `venv\Scripts\activate` on Windows)
   - `pip install -r requirements.txt`
   - `python manage.py migrate`
   - `python manage.py runserver`
3. Frontend:
   - `cd wallet-frontend`
   - `npm install`
   - `npm start`

## Usage
- Register a user.
- Log in to view the dashboard.
- Generate a QR code for a payment.
- Simulate a payment and check transaction history.