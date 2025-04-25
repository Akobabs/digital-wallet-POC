import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ToastContainer, toast } from 'react-toastify';
import ClipLoader from 'react-spinners/ClipLoader';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';

function App() {
  const [userId, setUserId] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [balance, setBalance] = useState({ ngn: 0, usd: 0 });
  const [transactions, setTransactions] = useState([]);
  const [filteredTransactions, setFilteredTransactions] = useState([]);
  const [amount, setAmount] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [filterDate, setFilterDate] = useState('');

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online! Syncing transactions...');
      if (userId) syncTransactions();
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.warn('You are offline. Payments will be queued.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [userId]);

  // Retry mechanism for API calls
  const apiCallWithRetry = async (fn, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === retries - 1) throw err;
        toast.warn(`Retrying... (${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  };

  const validateInput = (action) => {
    if (action === 'auth') {
      if (!username.trim()) {
        toast.error('Username is required');
        return false;
      }
      if (!password.trim()) {
        toast.error('Password is required');
        return false;
      }
    }
    if (action === 'amount') {
      const numAmount = parseFloat(amount);
      if (!amount || isNaN(numAmount) || numAmount <= 0) {
        toast.error('Please enter a valid positive amount');
        return false;
      }
    }
    return true;
  };

  const handleRegister = async () => {
    if (!validateInput('auth')) return;
    setLoading(true);
    try {
      await apiCallWithRetry(() =>
        axios.post('http://localhost:8000/register/', { username, password })
      );
      toast.success('Registration successful! Please log in.');
      setUsername('');
      setPassword('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!validateInput('auth')) return;
    setLoading(true);
    try {
      const res = await apiCallWithRetry(() =>
        axios.post('http://localhost:8000/login/', { username, password })
      );
      setUserId(res.data.user_id);
      await fetchDashboard(res.data.user_id);
      toast.success('Login successful!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setUserId(null);
    setBalance({ ngn: 0, usd: 0 });
    setTransactions([]);
    setFilteredTransactions([]);
    setQrUrl('');
    setUsername('');
    setPassword('');
    setAmount('');
    setShowProfile(false);
    setProfile(null);
    toast.success('Logged out successfully');
  };

  const fetchDashboard = async (id) => {
    setLoading(true);
    try {
      const res = await apiCallWithRetry(() =>
        axios.get(`http://localhost:8000/dashboard/${id}/`)
      );
      setBalance({ ngn: res.data.balance_ngn, usd: res.data.balance_usd });
      setTransactions(res.data.transactions || []);
      setFilteredTransactions(res.data.transactions || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to fetch dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const res = await apiCallWithRetry(() =>
        axios.get(`http://localhost:8000/profile/${userId}/`)
      );
      setProfile(res.data);
      setShowProfile(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to fetch profile data');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQR = async () => {
    if (!validateInput('amount')) return;
    setLoading(true);
    try {
      const res = await apiCallWithRetry(() =>
        axios.post(`http://localhost:8000/generate-qr/${userId}/`, { amount })
      );
      setQrUrl(`http://localhost:8000${res.data.qr_url}`);
      toast.success('QR code generated!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate QR code');
    } finally {
      setLoading(false);
    }
  };

  const handlePay = async () => {
    if (!validateInput('amount')) return;
    setLoading(true);
    try {
      const res = await apiCallWithRetry(() =>
        axios.post(`http://localhost:8000/pay/${userId}/`, {
          amount,
          is_offline: !isOnline
        })
      );
      await fetchDashboard(userId);
      toast.success(res.data.message);
      setAmount('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateScan = () => {
    // Simulate scanning the QR code by extracting user_id and amount
    const [_, scannedUserId, scannedAmount] = qrUrl.match(/pay:\/\/(\d+)\/(\d+)/) || [];
    if (scannedUserId && scannedAmount) {
      setAmount(scannedAmount);
      toast.info(`Simulated QR scan: Paying ${scannedAmount} to user ${scannedUserId}`);
      handlePay();
    } else {
      toast.error('Invalid QR code');
    }
  };

  const syncTransactions = async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      const res = await apiCallWithRetry(() =>
        axios.post(`http://localhost:8000/sync-transactions/${userId}/`)
      );
      await fetchDashboard(userId);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to sync transactions');
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = () => {
    let filtered = transactions;
    if (filterType !== 'all') {
      filtered = filtered.filter(tx => tx.type === filterType);
    }
    if (filterDate) {
      const selectedDate = new Date(filterDate);
      filtered = filtered.filter(tx => {
        const txDate = new Date(tx.timestamp);
        return txDate.toDateString() === selectedDate.toDateString();
      });
    }
    setFilteredTransactions(filtered);
  };

  if (!userId) {
    return (
      <div className="container">
        <ToastContainer position="top-right" autoClose={3000} />
        <h2>Digital Wallet PoC</h2>
        <div className="auth-section">
          <h3>Register</h3>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input-field"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
          />
          <button onClick={handleRegister} disabled={loading} className="btn btn-primary">
            {loading ? <ClipLoader size={20} color="#fff" /> : 'Register'}
          </button>
        </div>
        <div className="auth-section">
          <h3>Login</h3>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input-field"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
          />
          <button onClick={handleLogin} disabled={loading} className="btn btn-primary">
            {loading ? <ClipLoader size={20} color="#fff" /> : 'Login'}
          </button>
        </div>
      </div>
    );
  }

  if (showProfile) {
    return (
      <div className="container">
        <ToastContainer position="top-right" autoClose={3000} />
        <div className="header">
          <h2>Profile</h2>
          <button onClick={() => setShowProfile(false)} className="btn btn-secondary">Back to Dashboard</button>
          <button onClick={handleLogout} className="btn btn-logout">Logout</button>
        </div>
        {profile ? (
          <div className="profile-card">
            <h3>User Profile</h3>
            <p><strong>Username:</strong> {profile.username}</p>
            <p><strong>Email:</strong> {profile.email}</p>
            <p><strong>Date Joined:</strong> {new Date(profile.date_joined).toLocaleString()}</p>
          </div>
        ) : (
          <p>Loading profile...</p>
        )}
      </div>
    );
  }

  return (
    <div className="container">
      <ToastContainer position="top-right" autoClose={3000} />
      <div className="header">
        <h2>Dashboard</h2>
        <button onClick={fetchProfile} className="btn btn-secondary">View Profile</button>
        <button onClick={handleLogout} className="btn btn-logout">Logout</button>
      </div>
      <div className="status-bar">
        <span className={isOnline ? 'online' : 'offline'}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="balance-card">
        <h3>Balance</h3>
        <p className="balance-amount">₦{balance.ngn.toFixed(2)} (≈ ${balance.usd.toFixed(2)})</p>
      </div>
      <div className="action-section">
        <h3>Generate QR Code</h3>
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input-field"
        />
        <button onClick={handleGenerateQR} disabled={loading} className="btn btn-secondary">
          {loading ? <ClipLoader size={20} color="#fff" /> : 'Generate QR'}
        </button>
        {qrUrl && (
          <div className="qr-section">
            <img src={qrUrl} alt="QR Code" className="qr-code" />
            <button onClick={handleSimulateScan} className="btn btn-primary">Simulate QR Scan</button>
          </div>
        )}
      </div>
      <div className="action-section">
        <h3>Make Payment</h3>
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input-field"
        />
        <button onClick={handlePay} disabled={loading} className="btn btn-primary">
          {loading ? <ClipLoader size={20} color="#fff" /> : 'Pay'}
        </button>
      </div>
      <div className="transaction-section">
        <h3>Transaction History</h3>
        <div className="filter-section">
          <label>
            Type:
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="input-field">
              <option value="all">All</option>
              <option value="credit">Credit</option>
              <option value="debit">Debit</option>
            </select>
          </label>
          <label>
            Date:
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="input-field"
            />
          </label>
          <button onClick={handleFilter} className="btn btn-secondary">Filter</button>
        </div>
        {filteredTransactions.length === 0 ? (
          <p>No transactions match the filter.</p>
        ) : (
          <table className="transaction-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx, index) => (
                <tr key={index}>
                  <td>{tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</td>
                  <td>₦{parseFloat(tx.amount).toFixed(2)}</td>
                  <td>{new Date(tx.timestamp).toLocaleString()}</td>
                  <td>{tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default App;