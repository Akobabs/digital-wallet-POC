import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { BrowserQRCodeReader } from '@zxing/browser';
import './App.css';

// Custom debounce hook for input fields
function useDebounce(callback, delay) {
  const timeoutRef = useRef(null);

  return useCallback((...args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
}

const API_BASE_URL = 'http://localhost:5000/api';

function App() {
  // State declarations
  const [currentView, setCurrentView] = useState('landing');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [offlineTxs, setOfflineTxs] = useState(JSON.parse(localStorage.getItem('offlineTxs') || '[]'));
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showScanner, setShowScanner] = useState(false);
  const videoRef = useRef(null);
  const codeReaderRef = useRef(new BrowserQRCodeReader());
  const scanControlRef = useRef(null);

  // Form states
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ name: '', email: '', password: '' });
  const [qrForm, setQrForm] = useState({ amount: '', description: '' });
  const [transferForm, setTransferForm] = useState({ receiver_email: '', amount: '', description: '' });

  // Debounced state updates for number inputs
  const debouncedSetQrForm = useDebounce((newForm) => setQrForm(newForm), 100);
  const debouncedSetTransferForm = useDebounce((newForm) => setTransferForm(newForm), 100);

  // API and logic functions
  const fetchUserData = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    try {
      const walletResponse = await axios.get(`${API_BASE_URL}/wallet`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setWallet(walletResponse.data);

      const transactionsResponse = await axios.get(`${API_BASE_URL}/transactions?page=1&per_page=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTransactions(transactionsResponse.data.transactions);

      setCurrentView('dashboard');
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to fetch user data');
      if (error.response?.status === 401) {
        logout();
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  const syncOfflineTransactions = useCallback(async () => {
    if (!token || offlineTxs.length === 0) return;

    setLoading(true);
    setError('');

    try {
      const response = await axios.post(
        `${API_BASE_URL}/sync_offline_transactions`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      setSuccess(`Synced ${response.data.synced.length} transactions successfully!`);
      if (response.data.failed.length > 0) {
        setError(`Failed to sync ${response.data.failed.length} transactions`);
      }
      setOfflineTxs([]);
      localStorage.setItem('offlineTxs', '[]');
      fetchUserData();
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to sync offline transactions');
    } finally {
      setLoading(false);
    }
  }, [token, offlineTxs.length, fetchUserData]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_BASE_URL}/login`, loginForm);
      const { token: newToken, user: userData } = response.data;

      setToken(newToken);
      setUser(userData);
      localStorage.setItem('token', newToken);
      setSuccess('Login successful!');
      setLoginForm({ email: '', password: '' });
    } catch (error) {
      setError(error.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_BASE_URL}/register`, registerForm);
      const { token: newToken, user: userData } = response.data;

      setToken(newToken);
      setUser(userData);
      localStorage.setItem('token', newToken);
      setSuccess('Registration successful!');
      setRegisterForm({ name: '', email: '', password: '' });
    } catch (error) {
      setError(error.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const generateQR = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_BASE_URL}/generate_qr`, qrForm, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setQrCode(response.data.qr_code);
      setSuccess('QR Code generated successfully!');
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to generate QR code');
    } finally {
      setLoading(false);
    }
  };

  const handleTransfer = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!isOnline) {
      const offlineTx = {
        ...transferForm,
        qr_data: JSON.stringify({ user_id: user.id, amount: transferForm.amount, description: transferForm.description }),
        timestamp: new Date().toISOString(),
      };
      const updatedOfflineTxs = [...offlineTxs, offlineTx];
      setOfflineTxs(updatedOfflineTxs);
      localStorage.setItem('offlineTxs', JSON.stringify(updatedOfflineTxs));
      setSuccess('Transaction queued for offline sync!');
      setTransferForm({ receiver_email: '', amount: '', description: '' });
      setLoading(false);
      return;
    }

    try {
      await axios.post(`${API_BASE_URL}/transact`, transferForm, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setSuccess('Transfer completed successfully!');
      setTransferForm({ receiver_email: '', amount: '', description: '' });
      fetchUserData();
    } catch (error) {
      setError(error.response?.data?.error || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQrScan = async (data) => {
    if (data) {
      setShowScanner(false);
      setLoading(true);
      setError('');

      try {
        await axios.post(
          `${API_BASE_URL}/process_qr`,
          { qr_data: data },
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        setSuccess('QR payment completed successfully!');
        fetchUserData();
      } catch (error) {
        setError(error.response?.data?.error || 'QR payment failed');
      } finally {
        setLoading(false);
      }
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setWallet(null);
    setTransactions([]);
    localStorage.removeItem('token');
    setCurrentView('landing');
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  // Effect hooks
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isOnline && token && offlineTxs.length > 0) {
      syncOfflineTransactions();
    }
  }, [isOnline, token, offlineTxs.length, syncOfflineTransactions]);

  useEffect(() => {
    if (token) {
      fetchUserData();
    }
  }, [token, fetchUserData]);

  useEffect(() => {
    const codeReader = codeReaderRef.current;
    let isActive = true;

    if (showScanner && videoRef.current) {
      codeReader
        .decodeFromVideoDevice(null, videoRef.current, (result, error) => {
          if (!isActive) return;

          if (result) {
            handleQrScan(result.text);
          }
          if (error && error.name !== 'NotFoundException') {
            console.error('QR scan error:', error);
            setError('Failed to scan QR code. Please ensure your webcam is enabled.');
          }
        })
        .then((controls) => {
          if (isActive) {
            scanControlRef.current = controls;
          }
        })
        .catch((err) => {
          console.error('Failed to start QR scanner:', err);
          setError('Failed to start QR scanner. Please check webcam permissions.');
        });
    }

    return () => {
      isActive = false;
      if (scanControlRef.current) {
        try {
          scanControlRef.current.stop();
          scanControlRef.current = null;
        } catch (err) {
          console.error('Error stopping QR scanner:', err);
        }
      }
    };
  }, [showScanner]);

  // Components
  const LandingPage = () => (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-700">
      <nav className="bg-white shadow-lg" aria-label="Main navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-800">SME Wallet</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setCurrentView('login')}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition duration-200 btn-hover-scale focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Login to your account"
              >
                Login
              </button>
              <button
                onClick={() => setCurrentView('register')}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md transition duration-200 btn-hover-scale focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                aria-label="Register a new account"
              >
                Register
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center fade-in">
          <h2 className="text-5xl font-extrabold text-white mb-8">Digital Wallet for Nigerian SMEs</h2>
          <p className="text-xl text-blue-100 mb-12 max-w-3xl mx-auto">
            Secure, fast, and reliable digital payments with QR code technology, fraud detection, and offline sync
            capabilities designed specifically for Small and Medium Enterprises.
          </p>
          <div className="flex justify-center space-x-6">
            <button
              onClick={() => setCurrentView('register')}
              className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 rounded-lg text-lg font-semibold transition duration-200 transform hover:scale-105 focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
              aria-label="Get started with SME Wallet"
            >
              Get Started
            </button>
            <button
              onClick={() => setCurrentView('login')}
              className="bg-white hover:bg-gray-100 text-blue-600 px-8 py-4 rounded-lg text-lg font-semibold transition duration-200 transform hover:scale-105 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Sign in to SME Wallet"
            >
              Sign In
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="text-3xl font-bold text-gray-800 mb-4">Why Choose SME Wallet?</h3>
            <p className="text-lg text-gray-600">Built specifically for Nigerian businesses</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6 rounded-lg bg-blue-50 feature-card">
              <div className="bg-blue-600 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl" aria-hidden="true">
                  🔒
                </span>
              </div>
              <h4 className="text-xl font-semibold mb-2">Secure Transactions</h4>
              <p className="text-gray-600">
                Advanced fraud detection with <strong>92% precision</strong> and secure JWT authentication
              </p>
            </div>

            <div className="text-center p-6 rounded-lg bg-green-50 feature-card">
              <div className="bg-green-600 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl" aria-hidden="true">
                  ⚡
                </span>
              </div>
              <h4 className="text-xl font-semibold mb-2">Lightning Fast</h4>
              <p className="text-gray-600">
                Process transactions in <strong>1.2 seconds</strong> with <strong>80% of users</strong> completing
                payments in 30 seconds
              </p>
            </div>

            <div className="text-center p-6 rounded-lg bg-purple-50 feature-card">
              <div className="bg-purple-600 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl" aria-hidden="true">
                  📱
                </span>
              </div>
              <h4 className="text-xl font-semibold mb-2">QR Code Payments</h4>
              <p className="text-gray-600">
                Generate QR codes in <strong>under 5 seconds</strong> with offline sync capabilities
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-800 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 text-center">
            <div className="stats-card">
              <div className="text-3xl font-bold text-green-400">92%</div>
              <div className="text-gray-300">Fraud Detection Precision</div>
            </div>
            <div className="stats-card">
              <div className="text-3xl font-bold text-blue-400">80%</div>
              <div className="text-gray-300">Usability Satisfaction</div>
            </div>
            <div className="stats-card">
              <div className="text-3xl font-bold text-purple-400">70%</div>
              <div className="text-gray-300">Adoption Willingness</div>
            </div>
            <div className="stats-card">
              <div className="text-3xl font-bold text-yellow-400">1.2s</div>
              <div className="text-gray-300">Transaction Processing</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const LoginPage = () => (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Sign in to your account</h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Or{' '}
          <button
            onClick={() => setCurrentView('register')}
            className="font-medium text-blue-600 hover:text-blue-500 focus:outline-none focus:underline"
            aria-label="Navigate to registration page"
          >
            create a new account
          </button>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error && (
            <div className="mb-4 alert alert-error slide-in" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 alert alert-success slide-in" role="alert" aria-live="assertive">
              {success}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6" aria-labelledby="login-form">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                onInput={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                onFocus={(e) => e.target.select()}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                placeholder="Enter your email"
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                onInput={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                onFocus={(e) => e.target.select()}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                placeholder="Enter your password"
                aria-required="true"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed btn-hover-scale focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Submit login form"
              >
                {loading ? <span className="spinner mr-2"></span> : null}
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <button
              onClick={() => setCurrentView('landing')}
              className="w-full text-center text-sm text-gray-600 hover:text-gray-900 focus:outline-none focus:underline"
              aria-label="Return to home page"
            >
              ← Back to home
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const RegisterPage = () => (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Create your account</h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Or{' '}
          <button
            onClick={() => setCurrentView('login')}
            className="font-medium text-blue-600 hover:text-blue-500 focus:outline-none focus:underline"
            aria-label="Navigate to login page"
          >
            sign in to existing account
          </button>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error && (
            <div className="mb-4 alert alert-error slide-in" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 alert alert-success slide-in" role="alert" aria-live="assertive">
              {success}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-6" aria-labelledby="register-form">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Full Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                value={registerForm.name}
                onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                onInput={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                onFocus={(e) => e.target.select()}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 placeholder-gray-500"
                placeholder="Enter your full name"
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={registerForm.email}
                onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                onInput={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                onFocus={(e) => e.target.select()}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 placeholder-gray-500"
                placeholder="Enter your email"
                aria-required="true"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={registerForm.password}
                onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                onInput={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                onFocus={(e) => e.target.select()}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 placeholder-gray-500"
                placeholder="Enter your password (min 6 characters)"
                aria-required="true"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed btn-hover-scale focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                aria-label="Submit registration form"
              >
                {loading ? <span className="spinner mr-2"></span> : null}
                {loading ? 'Creating account...' : 'Create account'}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <button
              onClick={() => setCurrentView('landing')}
              className="w-full text-center text-sm text-gray-600 hover:text-gray-900 focus:outline-none focus:underline"
              aria-label="Return to home page"
            >
              ← Back to home
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const Dashboard = () => (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow" aria-label="Dashboard navigation">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">SME Wallet Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700" aria-label={`Logged in as ${user?.name || 'User'}`}>
                Welcome, {user?.name || 'User'}
              </span>
              <button
                onClick={logout}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium btn-hover-scale focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                aria-label="Log out of your account"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 alert alert-error slide-in" role="alert" aria-live="assertive">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 alert alert-success slide-in" role="alert" aria-live="assertive">
            {success}
          </div>
        )}

        <div className="bg-white overflow-hidden shadow rounded-lg mb-6 balance-display">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold" aria-hidden="true">
                    ₦
                  </span>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-600 truncate">Current Balance</dt>
                  <dd className="balance-amount text-gray-900">
                    {wallet ? formatCurrency(wallet.balance) : 'Loading...'}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="bg-white overflow-hidden shadow rounded-lg card-shadow">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Generate QR Code</h3>
              <form onSubmit={generateQR} className="space-y-4" aria-labelledby="generate-qr-form">
                <div>
                  <label htmlFor="qr-amount" className="block text-sm font-medium text-gray-700">
                    Amount (₦)
                  </label>
                  <input
                    id="qr-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={qrForm.amount}
                    onChange={(e) => debouncedSetQrForm({ ...qrForm, amount: e.target.value })}
                    onInput={(e) => debouncedSetQrForm({ ...qrForm, amount: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                    placeholder="Enter amount"
                    aria-required="true"
                  />
                </div>
                <div>
                  <label htmlFor="qr-description" className="block text-sm font-medium text-gray-700">
                    Description (Optional)
                  </label>
                  <input
                    id="qr-description"
                    type="text"
                    value={qrForm.description}
                    onChange={(e) => setQrForm({ ...qrForm, description: e.target.value })}
                    onInput={(e) => setQrForm({ ...qrForm, description: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                    placeholder="Payment description"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed btn-hover-scale focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  aria-label="Generate QR code for payment"
                >
                  {loading ? <span className="spinner mr-2"></span> : null}
                  {loading ? 'Generating...' : 'Generate QR Code'}
                </button>
              </form>

              {qrCode && (
                <div className="mt-4 qr-container text-center">
                  <img src={qrCode} alt="QR Code for payment" className="mx-auto max-w-xs" />
                  <p className="mt-2 text-sm text-gray-600">Scan this QR code to receive payment</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg card-shadow">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Send Money</h3>
              <form onSubmit={handleTransfer} className="space-y-4" aria-labelledby="send-money-form">
                <div>
                  <label htmlFor="recipient-email" className="block text-sm font-medium text-gray-700">
                    Recipient Email
                  </label>
                  <input
                    id="recipient-email"
                    type="email"
                    required
                    value={transferForm.receiver_email}
                    onChange={(e) => setTransferForm({ ...transferForm, receiver_email: e.target.value })}
                    onInput={(e) => setTransferForm({ ...transferForm, receiver_email: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 placeholder-gray-500"
                    placeholder="recipient@example.com"
                    aria-required="true"
                  />
                </div>
                <div>
                  <label htmlFor="transfer-amount" className="block text-sm font-medium text-gray-700">
                    Amount (₦)
                  </label>
                  <input
                    id="transfer-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={transferForm.amount}
                    onChange={(e) => debouncedSetTransferForm({ ...transferForm, amount: e.target.value })}
                    onInput={(e) => debouncedSetTransferForm({ ...transferForm, amount: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 placeholder-gray-500"
                    placeholder="Enter amount"
                    aria-required="true"
                  />
                </div>
                <div>
                  <label htmlFor="transfer-description" className="block text-sm font-medium text-gray-700">
                    Description (Optional)
                  </label>
                  <input
                    id="transfer-description"
                    type="text"
                    value={transferForm.description}
                    onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })}
                    onInput={(e) => setTransferForm({ ...transferForm, description: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md form-input shadow-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 placeholder-gray-500"
                    placeholder="Payment description"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed btn-hover-scale focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                  aria-label="Send money to recipient"
                >
                  {loading ? <span className="spinner mr-2"></span> : null}
                  {loading ? 'Sending...' : 'Send Money'}
                </button>
              </form>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg card-shadow">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Scan QR Code</h3>
              <button
                onClick={() => setShowScanner(true)}
                className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md btn-hover-scale focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                aria-label="Open QR code scanner"
              >
                Start QR Scanner
              </button>
              {showScanner && (
                <div className="mt-4 qr-container">
                  <video ref={videoRef} className="w-full rounded-md border-2 border-gray-200" />
                  <button
                    onClick={() => setShowScanner(false)}
                    className="mt-2 w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md btn-hover-scale focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                    aria-label="Close QR code scanner"
                  >
                    Stop Scanning
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Recent Transactions</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">Your latest transaction history</p>
            {offlineTxs.length > 0 && (
              <div className="mt-2 alert alert-warning slide-in" role="alert" aria-live="polite">
                {offlineTxs.length} offline transaction(s) pending sync
                <button
                  onClick={syncOfflineTransactions}
                  className="ml-2 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  aria-label="Sync offline transactions"
                >
                  Sync Now
                </button>
              </div>
            )}
          </div>
          <ul className="divide-y divide-gray-200">
            {transactions.length === 0 ? (
              <li className="px-4 py-4 text-center text-gray-500">No transactions yet</li>
            ) : (
              transactions.map((transaction) => (
                <li key={transaction.id} className="px-4 py-4 transaction-item">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div
                        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                          transaction.type === 'sent' ? 'bg-red-100' : 'bg-green-100'
                        }`}
                      >
                        <span
                          className={`text-sm font-medium ${
                            transaction.type === 'sent' ? 'text-red-800' : 'text-green-800'
                          }`}
                          aria-hidden="true"
                        >
                          {transaction.type === 'sent' ? '↗' : '↙'}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {transaction.type === 'sent'
                            ? `To: ${transaction.receiver.name}`
                            : `From: ${transaction.sender.name}`}
                        </div>
                        <div className="text-sm text-gray-500">{transaction.description || 'No description'}</div>
                        <div className="text-xs text-gray-400">{formatDate(transaction.timestamp)}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-sm font-medium ${
                          transaction.type === 'sent' ? 'text-red-600' : 'text-green-600'
                        }`}
                      >
                        {transaction.type === 'sent' ? '-' : '+'}
                        {formatCurrency(transaction.amount)}
                      </div>
                      <div
                        className={`text-xs px-2 py-1 rounded-full ${
                          transaction.status === 'completed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {transaction.status}
                      </div>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );

  const renderCurrentView = () => {
    if (token && currentView !== 'landing') {
      return <Dashboard />;
    }

    switch (currentView) {
      case 'login':
        return <LoginPage />;
      case 'register':
        return <RegisterPage />;
      case 'dashboard':
        return <Dashboard />;
      default:
        return <LandingPage />;
    }
  };

  return (
    <div className="App">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <main id="main-content">{renderCurrentView()}</main>
    </div>
  );
}

export default App;