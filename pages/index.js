import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Download, Loader, LogIn, LogOut } from 'lucide-react';
import Head from 'next/head';
import Script from 'next/script';

export default function BankStatementParser() {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState(null);
  const [step, setStep] = useState('upload');
  const [debugInfo, setDebugInfo] = useState('');
  const [isGoogleAuthed, setIsGoogleAuthed] = useState(false);
  const [googleUser, setGoogleUser] = useState(null);
  const [exportingToSheets, setExportingToSheets] = useState(false);

  const GOOGLE_CLIENT_ID = '642698873773-gn904s174jldpo6lahfpli5md49etr9c.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

  useEffect(() => {
    const token = localStorage.getItem('google_access_token');
    if (token) {
      setIsGoogleAuthed(true);
      const userInfo = JSON.parse(localStorage.getItem('google_user_info') || '{}');
      setGoogleUser(userInfo);
    }
  }, []);

  const signInWithGoogle = () => {
    if (!window.google) {
      alert('Google Sign-In is still loading. Please wait a moment and try again.');
      return;
    }

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (tokenResponse) => {
        if (tokenResponse.access_token) {
          localStorage.setItem('google_access_token', tokenResponse.access_token);
          setIsGoogleAuthed(true);
          
          fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
          })
            .then(r => r.json())
            .then(userInfo => {
              setGoogleUser(userInfo);
              localStorage.setItem('google_user_info', JSON.stringify(userInfo));
            });
        }
      },
    });
    
    client.requestAccessToken();
  };

  const signOut = () => {
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_user_info');
    setIsGoogleAuthed(false);
    setGoogleUser(null);
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setError(null);
    setProcessing(true);
    setStep('processing');
    setDebugInfo('');

    try {
      setDebugInfo('Reading file...');
      
      if (uploadedFile.name.toLowerCase().endsWith('.csv')) {
        const text = await readAsText(uploadedFile);
        setDebugInfo('CSV detected, parsing...');
        const extractedTransactions = await parseCSV(text);
        setTransactions(extractedTransactions);
        setStep('preview');
      } 
      else if (uploadedFile.name.toLowerCase().endsWith('.pdf')) {
        setDebugInfo('PDF detected, converting to base64...');
        const base64Data = await readAsBase64(uploadedFile);
        setDebugInfo('Sending to AI for extraction...');
        const extractedTransactions = await extractFromPDF(base64Data);
        setTransactions(extractedTransactions);
        setStep('preview');
      } else {
        throw new Error('Please upload a PDF or CSV file');
      }
    } catch (err) {
      console.error('Processing error:', err);
      setError(err.message);
      setDebugInfo(`Error: ${err.message}`);
      setStep('upload');
    } finally {
      setProcessing(false);
    }
  };

  const readAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const readAsBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const parseCSV = async (csvText) => {
    setDebugInfo('Parsing CSV with AI...');
    
    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        type: 'csv',
        content: csvText.substring(0, 15000)
      })
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.error);
    return data.transactions;
  };

  const extractFromPDF = async (base64Data) => {
    setDebugInfo('Extracting transactions from PDF with AI...');
    
    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        type: 'pdf',
        content: base64Data
      })
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.error);
    return data.transactions;
  };

  const exportToGoogleSheets = async () => {
    if (!isGoogleAuthed) {
      alert('Please sign in with Google first!');
      return;
    }

    setExportingToSheets(true);
    const accessToken = localStorage.getItem('google_access_token');

    try {
      const createResponse = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            title: `Bank Transactions - ${new Date().toISOString().split('T')[0]}`
          },
          sheets: [{
            properties: {
              title: 'Transactions',
              gridProperties: {
                rowCount: transactions.length + 1,
                columnCount: 5
              }
            }
          }]
        })
      });

      if (!createResponse.ok) {
        throw new Error('Failed to create spreadsheet. You may need to sign in again.');
      }

      const spreadsheet = await createResponse.json();
      const spreadsheetId = spreadsheet.spreadsheetId;

      const headers = ['Date', 'Description', 'Amount', 'Balance', 'Type'];
      const rows = transactions.map(t => [
        t.date,
        t.description,
        t.amount,
        t.balance,
        t.type
      ]);

      const values = [headers, ...rows];

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:E${values.length}?valueInputOption=RAW`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values })
      });

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [{
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.2, green: 0.5, blue: 0.8 },
                  textFormat: {
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                    bold: true
                  }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          }]
        })
      });

      window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, '_blank');
      alert(`✓ Success!\n\n${transactions.length} transactions exported to Google Sheets.`);
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export to Google Sheets: ' + err.message);
      
      if (err.message.includes('sign in')) {
        signOut();
      }
    } finally {
      setExportingToSheets(false);
    }
  };

  const exportToCSV = () => {
    const headers = ['Date', 'Description', 'Amount', 'Balance', 'Type'];
    const rows = transactions.map(t => [
      t.date,
      `"${t.description.replace(/"/g, '""')}"`,
      t.amount,
      t.balance || '',
      t.type
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetUpload = () => {
    setFile(null);
    setTransactions([]);
    setError(null);
    setStep('upload');
    setDebugInfo('');
  };

  return (
    <>
      <Head>
        <title>Bank Statement Parser</title>
      </Head>

      <Script 
        src="https://accounts.google.com/gsi/client" 
        strategy="afterInteractive"
      />

      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">
              Bank Statement Parser
            </h1>
            <p className="text-gray-600">
              Upload your bank statement and export directly to Google Sheets
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            {!isGoogleAuthed ? (
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">Connect Google Sheets</h3>
                  <p className="text-sm text-gray-600">Sign in to export transactions directly</p>
                </div>
                <button
                  onClick={signInWithGoogle}
                  className="bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors flex items-center shadow-sm"
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <LogIn style={{ width: '20px', height: '20px', marginRight: '8px' }} />
                  Sign in with Google
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <CheckCircle style={{ width: '24px', height: '24px', color: '#10b981', marginRight: '12px' }} />
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">Connected to Google</h3>
                    <p className="text-sm text-gray-600">{googleUser?.email || 'Signed in'}</p>
                  </div>
                </div>
                <button
                  onClick={signOut}
                  className="text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <LogOut style={{ width: '16px', height: '16px', marginRight: '8px' }} />
                  Sign Out
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-lg p-8">
            {step === 'upload' && (
              <div className="text-center">
                <div className="border-4 border-dashed border-gray-300 rounded-lg p-12 hover:border-blue-400 transition-colors">
                  <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    accept=".pdf,.csv"
                    onChange={handleFileUpload}
                    disabled={processing}
                  />
                  <label htmlFor="file-upload" style={{ cursor: 'pointer' }}>
                    <Upload style={{ width: '64px', height: '64px', color: '#9ca3af', margin: '0 auto 16px' }} />
                    <p className="text-xl font-semibold text-gray-700 mb-2">
                      Drop your bank statement here
                    </p>
                    <p className="text-gray-500 mb-4">or click to browse</p>
                    <p className="text-sm text-gray-400">Supports PDF and CSV files</p>
                  </label>
                </div>
                
                {error && (
                  <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start">
                      <AlertCircle style={{ width: '20px', height: '20px', color: '#ef4444', marginRight: '12px', flexShrink: 0, marginTop: '2px' }} />
                      <div className="text-left">
                        <p className="text-red-700 font-semibold mb-1">{error}</p>
                        {debugInfo && <p className="text-red-600 text-sm">{debugInfo}</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 'processing' && (
              <div className="text-center py-12">
                <Loader style={{ width: '64px', height: '64px', color: '#3b82f6', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
                <h2 className="text-2xl font-semibold text-gray-800 mb-2">
                  Processing your statement...
                </h2>
                <p className="text-gray-600 mb-2">Using AI to extract transactions</p>
                {debugInfo && <p className="text-sm text-gray-500">{debugInfo}</p>}
              </div>
            )}

            {step === 'preview' && transactions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center">
                    <CheckCircle style={{ width: '32px', height: '32px', color: '#10b981', marginRight: '12px' }} />
                    <div>
                      <h2 className="text-2xl font-semibold text-gray-800">
                        Found {transactions.length} transactions
                      </h2>
                      <p className="text-gray-600">Review and export</p>
                    </div>
                  </div>
                  <button
                    onClick={resetUpload}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                  >
                    Upload Another
                  </button>
                </div>

                <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '24px', maxHeight: '384px', overflowY: 'auto' }}>
                  <table style={{ width: '100%' }}>
                    <thead style={{ backgroundColor: '#f9fafb', position: 'sticky', top: 0 }}>
                      <tr>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '14px', fontWeight: 600, color: '#374151' }}>Date</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '14px', fontWeight: 600, color: '#374151' }}>Description</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: '#374151' }}>Amount</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: '#374151' }}>Balance</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '14px', fontWeight: 600, color: '#374151' }}>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((transaction, idx) => (
                        <tr key={idx} style={{ borderTop: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '12px 16px', fontSize: '14px', color: '#374151', whiteSpace: 'nowrap' }}>
                            {transaction.date}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '14px', color: '#374151' }}>
                            {transaction.description}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap', color: transaction.amount < 0 ? '#dc2626' : '#16a34a' }}>
                            ${Math.abs(transaction.amount).toFixed(2)}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '14px', textAlign: 'right', color: '#374151', whiteSpace: 'nowrap' }}>
                            {transaction.balance !== null ? `$${transaction.balance.toFixed(2)}` : '-'}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '14px', color: '#374151' }}>
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '9999px',
                              fontSize: '12px',
                              fontWeight: 500,
                              backgroundColor: transaction.type === 'debit' ? '#fee2e2' : '#dcfce7',
                              color: transaction.type === 'debit' ? '#991b1b' : '#166534'
                            }}>
                              {transaction.type}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: '16px' }}>
                  <button
                    onClick={exportToCSV}
                    className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Download style={{ width: '20px', height: '20px', marginRight: '8px' }} />
                    Download CSV
                  </button>
                  <button
                    onClick={exportToGoogleSheets}
                    disabled={!isGoogleAuthed || exportingToSheets}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: 1,
                      padding: '12px 24px',
                      borderRadius: '8px',
                      fontWeight: 600,
                      transition: 'all 0.2s',
                      backgroundColor: isGoogleAuthed && !exportingToSheets ? '#16a34a' : '#d1d5db',
                      color: isGoogleAuthed && !exportingToSheets ? 'white' : '#6b7280',
                      cursor: isGoogleAuthed && !exportingToSheets ? 'pointer' : 'not-allowed'
                    }}
                  >
                    {exportingToSheets ? (
                      <>
                        <Loader style={{ width: '20px', height: '20px', marginRight: '8px', animation: 'spin 1s linear infinite' }} />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <FileText style={{ width: '20px', height: '20px', marginRight: '8px' }} />
                        {isGoogleAuthed ? 'Export to Google Sheets' : 'Sign in to Export'}
                      </>
                    )}
                  </button>
                </div>

                {!isGoogleAuthed && (
                  <p className="text-sm text-amber-600 text-center mt-4 bg-amber-50 border border-amber-200 rounded p-3">
                    ⚠️ Sign in with Google above to export directly to Google Sheets
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}