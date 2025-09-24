import React, { useState, useEffect, useRef } from 'react';
import { Download, Play, AlertCircle, CheckCircle, Loader, Clock, Target, Activity } from 'lucide-react';

// API URL - Python Flask backend
//const API_BASE_URL = 'http://localhost:5001';
const API_BASE_URL = 'http://10.53.48.141:5001';

const ProgressBar = ({ percentage, className = "" }) => (
  <div className={`w-full bg-gray-200 rounded-full h-3 ${className}`}>
    <div 
      className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
      style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
    />
  </div>
);

const StatusBadge = ({ status }) => {
  const statusConfig = {
    loading: { color: 'bg-blue-100 text-blue-800', icon: Loader, spin: true },
    completed: { color: 'bg-green-100 text-green-800', icon: CheckCircle },
    error: { color: 'bg-red-100 text-red-800', icon: AlertCircle },
    skipped: { color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  };
  
  const config = statusConfig[status] || statusConfig.loading;
  const IconComponent = config.icon;
  
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
      <IconComponent className={`w-3 h-3 mr-1 ${config.spin ? 'animate-spin' : ''}`} />
      {status}
    </span>
  );
};

const EquipmentTraderScraper = () => {
  const [url, setUrl] = useState('https://www.equipmenttrader.com/Articulated-Boom-Lift/equipment-for-sale?category=Articulated%20Boom%20Lift%7C2011372');
  const [maxPages, setMaxPages] = useState(5);
  const [isLoading, setIsLoading] = useState(false);
  const [scrapedData, setScrapedData] = useState([]);
  const [status, setStatus] = useState('');
  const [showCode, setShowCode] = useState(false);
  
  // Progress tracking states
  const [progress, setProgress] = useState(0);
  const [currentPhase, setCurrentPhase] = useState('');
  const [currentItem, setCurrentItem] = useState(null);
  const [totalItems, setTotalItems] = useState(0);
  const [completedItems, setCompletedItems] = useState(0);
  const [successfulItems, setSuccessfulItems] = useState(0);
  const [recentItems, setRecentItems] = useState([]);
  
  // Pagination tracking states
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pagesScraped, setPagesScraped] = useState(0);
  
  const eventSourceRef = useRef(null);
  const sessionIdRef = useRef(null);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const generateSessionId = () => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const connectToProgressStream = (sessionId) => {
    const eventSource = new EventSource(`${API_BASE_URL}/api/scrape-progress/${sessionId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleProgressUpdate(data);
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      setStatus('❌ Lost connection to progress stream');
      eventSource.close();
    };

    return eventSource;
  };

  const handleProgressUpdate = (data) => {
    console.log('Progress update:', data);

    switch (data.type) {
      case 'connected':
        setStatus('🔗 Connected to progress stream');
        break;

      case 'phase':
        setCurrentPhase(data.data.message);
        setStatus(`📋 ${data.data.message}`);
        break;

      case 'pagination':
        setCurrentPage(data.data.current_page || 1);
        if (data.data.max_pages) {
          setTotalPages(data.data.max_pages);
        }
        // Show URL being loaded for transparency
        if (data.data.url) {
          setStatus(`🌐 ${data.data.message} (${data.data.url})`);
        } else if (data.data.message.includes('No results found')) {
          setStatus(`🏁 ${data.data.message}`);
        } else {
          setStatus(`📄 ${data.data.message}`);
        }
        break;

      case 'page_scraped':
        setPagesScraped(data.data.current_page);
        setStatus(`📄 ${data.data.message} (Total: ${data.data.total_listings_so_far})`);
        break;

      case 'urls_found':
        setTotalItems(data.data.total_urls);
        setPagesScraped(data.data.pages_scraped || 1);
        setStatus(`🎯 Found ${data.data.total_urls} listings across ${data.data.pages_scraped} pages`);
        break;

      case 'scraping_item':
        const itemData = data.data;
        setCurrentItem({
          index: itemData.current_index,
          total: itemData.total_count,
          url: itemData.url,
          status: itemData.status,
          item: itemData.item,
          error: itemData.error,
          reason: itemData.reason
        });

        // Add to recent items list
        if (itemData.status === 'completed' && itemData.item) {
          setRecentItems(prev => [
            { ...itemData.item, status: itemData.status, timestamp: Date.now() },
            ...prev.slice(0, 4) // Keep only last 5 items
          ]);
          setScrapedData(prev => [...prev, {
            brand: itemData.item.brand,
            model: itemData.item.model,
            price: itemData.item.price,
            url: itemData.url,
            // Add mock data for other fields
            condition: 'Used',
            location: 'Location TBD'
          }]);
        }
        break;

      case 'overall_progress':
        setProgress(data.data.percentage);
        setCompletedItems(data.data.completed);
        setSuccessfulItems(data.data.successful);
        setStatus(`⚡ Progress: ${data.data.completed}/${data.data.total} (${data.data.successful} successful)`);
        break;

      case 'completed':
        setIsLoading(false);
        setProgress(100);
        setStatus(`✅ Scraping completed! Successfully scraped ${data.data.total_scraped} out of ${data.data.total_processed} listings.`);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        break;

      case 'error':
        setIsLoading(false);
        setStatus(`❌ Error: ${data.data.message || data.data.error}`);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        break;

      case 'heartbeat':
        // Just keep the connection alive
        break;

      default:
        console.log('Unknown progress event:', data);
    }
  };

  const convertToCSV = (data) => {
    if (!data || data.length === 0) return '';
    
    const headers = ['Brand', 'Model', 'Condition', 'Location', 'Price', 'URL'];
    const csvContent = [
      headers.join(','),
      ...data.map(row => [
        row.brand || '',
        row.model || '',
        row.condition || '',
        row.location || '',
        row.price || '',
        row.url || ''
      ].map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    return csvContent;
  };

  const downloadCSV = (data, filename = 'equipment-trader-listings.csv') => {
    const csvContent = convertToCSV(data);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const resetState = () => {
    setProgress(0);
    setCurrentPhase('');
    setCurrentItem(null);
    setTotalItems(0);
    setCompletedItems(0);
    setSuccessfulItems(0);
    setRecentItems([]);
    setScrapedData([]);
    setCurrentPage(1);
    setTotalPages(0);
    setPagesScraped(0);
  };

  const handleScrape = async () => {
    if (!url.trim()) {
      setStatus('Please enter a valid URL');
      return;
    }

    resetState();
    setIsLoading(true);
    setStatus('🚀 Starting scrape...');

    try {
      // Generate session ID
      const sessionId = generateSessionId();
      sessionIdRef.current = sessionId;

      // First, test if backend is accessible
      setStatus('🔗 Connecting to backend...');
      console.log('Attempting to connect to:', `${API_BASE_URL}/api/health`);
      
      const healthCheck = await fetch(`${API_BASE_URL}/api/health`, {
        method: 'GET',
      });

      if (!healthCheck.ok) {
        throw new Error(`Backend health check failed: ${healthCheck.status}`);
      }

      const healthResult = await healthCheck.json();
      console.log('Backend health check successful:', healthResult);
      
      // Connect to progress stream first
      connectToProgressStream(sessionId);
      
      // Start the scraping process
      setStatus('🎬 Backend connected! Starting scrape...');
      console.log('Starting scrape with session:', sessionId);
      
      const response = await fetch(`${API_BASE_URL}/api/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, session_id: sessionId, max_pages: maxPages }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Scrape started:', result);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to start scraping');
      }

      setStatus('📡 Scraping started! Listening for progress updates...');
      
    } catch (error) {
      console.error('Full error details:', error);
      setIsLoading(false);
      
      // If backend is not running, use mock data for demo
      if (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        setStatus(`❌ Backend not available (${API_BASE_URL}) - using demo data`);
        
        // Simulate progress for demo
        const mockData = [
          {
            brand: "JLG",
            model: "450AJ",
            condition: "Used",
            location: "Nashville, TN",
            price: "$36,950",
            url: "https://www.equipmenttrader.com/listing/2019-JLG-450AJ-5033688861"
          },
          {
            brand: "JLG", 
            model: "E450AJ",
            condition: "Used",
            location: "State College, PA",
            price: "$22,900",
            url: "https://www.equipmenttrader.com/listing/2012-JLG-E450AJ-5033801611"
          }
        ];
        
        // Simulate progressive loading
        setTotalItems(2);
        setTimeout(() => {
          setProgress(50);
          setCompletedItems(1);
          setSuccessfulItems(1);
          setScrapedData([mockData[0]]);
          setRecentItems([{ ...mockData[0], status: 'completed', timestamp: Date.now() }]);
        }, 1000);
        
        setTimeout(() => {
          setProgress(100);
          setCompletedItems(2);
          setSuccessfulItems(2);
          setScrapedData(mockData);
          setRecentItems([
            { ...mockData[1], status: 'completed', timestamp: Date.now() },
            { ...mockData[0], status: 'completed', timestamp: Date.now() - 1000 }
          ]);
          setStatus('✅ Demo data loaded successfully!');
        }, 2000);
      } else {
        setStatus(`❌ Error: ${error.message}`);
      }
    }
  };

  const handleDownload = () => {
    if (scrapedData.length > 0) {
      downloadCSV(scrapedData);
    }
  };

  const setupInstructions = `
Backend Setup Instructions:

1. Create a new folder for your backend:
   mkdir equipment-scraper-backend
   cd equipment-scraper-backend

2. Install Python dependencies:
   pip install flask flask-cors playwright beautifulsoup4

3. Install Playwright browsers:
   playwright install chromium

4. Save the enhanced backend code as app.py

5. Start the backend:
   python app.py

6. Backend will run on http://localhost:5001 with:
   - SSE support for real-time progress
   - Automatic pagination handling
   - Configurable max pages (default: 10)

Features:
✅ Automatic URL-based pagination (e.g., &page=2, &page=3)
✅ Real-time progress updates  
✅ Individual item status tracking
✅ Error handling and retry logic
✅ CSV export functionality
✅ Popup/modal dismissal
✅ No button clicking required - direct URL navigation
✅ Faster and more reliable than click-based pagination
  `;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-6">
            Equipment Trader Scraper
          </h1>
          
          {/* URL Input Section */}
          <div className="mb-6">
            <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
              Equipment Trader Search URL
            </label>
            <div className="flex gap-3 mb-3">
              <input
                type="url"
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.equipmenttrader.com/..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={isLoading}
              />
              <div className="flex items-center gap-2">
                <label htmlFor="maxPages" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  Max Pages:
                </label>
                <input
                  type="number"
                  id="maxPages"
                  value={maxPages}
                  onChange={(e) => setMaxPages(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  max="50"
                  className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isLoading}
                />
              </div>
              <button
                onClick={handleScrape}
                disabled={isLoading || !url.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isLoading ? 'Scraping...' : 'Start Scrape'}
              </button>
            </div>
            <p className="text-sm text-gray-500">
              The scraper will automatically go through all pages up to the maximum specified, collecting all listings.
              <br />
              <span className="text-xs text-blue-600">
                ✨ Enhanced: Uses URL-based pagination (e.g., &page=2) for reliable navigation - no clicking required!
              </span>
            </p>
          </div>

          {/* Progress Section */}
          {isLoading && (
            <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Scraping Progress</h3>
                <div className="text-sm text-gray-600">
                  {completedItems}/{totalItems} items processed
                </div>
              </div>
              
              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>Overall Progress</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <ProgressBar percentage={progress} />
                
                {/* Pagination Progress */}
                {totalPages > 1 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-sm text-gray-600 mb-1">
                      <span>Page Progress</span>
                      <span>{currentPage} / {totalPages || maxPages}</span>
                    </div>
                    <ProgressBar 
                      percentage={totalPages > 0 ? (currentPage / totalPages) * 100 : (currentPage / maxPages) * 100} 
                      className="h-2"
                    />
                  </div>
                )}
              </div>

              {/* Current Phase */}
              {currentPhase && (
                <div className="mb-4 p-3 bg-white rounded-md border border-blue-200">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-blue-600" />
                    <span className="font-medium text-gray-700">Current Phase:</span>
                    <span className="text-blue-700">{currentPhase}</span>
                  </div>
                </div>
              )}

              {/* Current Item */}
              {currentItem && (
                <div className="mb-4 p-3 bg-white rounded-md border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-green-600" />
                      <span className="font-medium text-gray-700">
                        Current Item: {currentItem.index}/{currentItem.total}
                      </span>
                    </div>
                    <StatusBadge status={currentItem.status} />
                  </div>
                  
                  {currentItem.item && (
                    <div className="text-sm text-gray-600">
                      <strong>{currentItem.item.brand} {currentItem.item.model}</strong> - {currentItem.item.price}
                    </div>
                  )}
                  
                  {currentItem.error && (
                    <div className="text-sm text-red-600 mt-1">
                      Error: {currentItem.error}
                    </div>
                  )}
                  
                  {currentItem.reason && (
                    <div className="text-sm text-yellow-600 mt-1">
                      Reason: {currentItem.reason}
                    </div>
                  )}
                </div>
              )}

              {/* Statistics */}
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="text-center p-3 bg-white rounded-md border border-blue-200">
                  <div className="text-2xl font-bold text-purple-600">{pagesScraped}</div>
                  <div className="text-sm text-gray-600">Pages Scraped</div>
                </div>
                <div className="text-center p-3 bg-white rounded-md border border-blue-200">
                  <div className="text-2xl font-bold text-blue-600">{totalItems}</div>
                  <div className="text-sm text-gray-600">Total Found</div>
                </div>
                <div className="text-center p-3 bg-white rounded-md border border-blue-200">
                  <div className="text-2xl font-bold text-green-600">{successfulItems}</div>
                  <div className="text-sm text-gray-600">Successful</div>
                </div>
                <div className="text-center p-3 bg-white rounded-md border border-blue-200">
                  <div className="text-2xl font-bold text-red-600">{completedItems - successfulItems}</div>
                  <div className="text-sm text-gray-600">Failed</div>
                </div>
              </div>
            </div>
          )}

          {/* Recent Items */}
          {recentItems.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Recently Scraped Items</h3>
              <div className="space-y-2">
                {recentItems.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-md">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <span className="font-medium">{item.brand} {item.model}</span>
                      <span className="text-green-700 font-semibold">{item.price}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status Section */}
          {status && (
            <div className={`mb-6 p-4 rounded-md flex items-center gap-2 ${
              status.includes('Error') || status.includes('❌') ? 'bg-red-50 text-red-700' : 
              status.includes('Successfully') || status.includes('✅') || status.includes('demo data') ? 'bg-green-50 text-green-700' : 
              'bg-blue-50 text-blue-700'
            }`}>
              {status.includes('Error') || status.includes('❌') ? <AlertCircle className="w-5 h-5" /> :
               status.includes('Successfully') || status.includes('✅') || status.includes('demo data') ? <CheckCircle className="w-5 h-5" /> :
               <Loader className="w-5 h-5 animate-spin" />}
              {status}
            </div>
          )}

          {/* Results Section */}
          {scrapedData.length > 0 && (
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-800">
                  Scraped Data ({scrapedData.length} listings)
                </h2>
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download CSV
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white border border-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Brand</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Model</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Condition</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Location</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">Price</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {scrapedData.map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">{item.brand}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">{item.model}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">{item.condition}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">{item.location}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 font-medium text-green-600">{item.price}</td>
                        <td className="px-4 py-2 text-sm text-blue-600">
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            View Listing
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Setup Instructions */}
          <div className="mt-8 border-t pt-6">
            <button
              onClick={() => setShowCode(!showCode)}
              className="text-blue-600 hover:text-blue-800 font-medium mb-4"
            >
              {showCode ? 'Hide' : 'Show'} Backend Setup Instructions
            </button>
            
            {showCode && (
              <div className="bg-gray-900 text-gray-100 p-4 rounded-md overflow-x-auto">
                <pre className="text-sm whitespace-pre-wrap">{setupInstructions}</pre>
              </div>
            )}
          </div>

          {/* Backend Connection Status */}
          <div className="mt-6 bg-blue-50 p-4 rounded-md">
            <h3 className="font-semibold text-blue-800 mb-2">Backend Connection Status:</h3>
            <div className="text-sm text-blue-700 space-y-2">
              <div>• Frontend: ✅ Running with real-time progress updates</div>
              <div>• Backend URL: {API_BASE_URL}</div>
              <div>• SSE Support: ✅ Server-Sent Events enabled</div>
              <div>• Connection Status: {
                status.includes('Backend not available') || status.includes('❌') 
                  ? '❌ Not connected (check console for details)' 
                  : status.includes('Backend connected') || status.includes('Successfully scraped') || status.includes('Connected to progress stream')
                  ? '✅ Connected and working'
                  : '⏳ Not tested yet'
              }</div>
              <div>• Open browser console (F12) for detailed connection logs</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EquipmentTraderScraper;