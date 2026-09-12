const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { fetchAndSaveOSMData } = require('./scripts/fetchOSMData');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(DATA_DIR));

app.get('/api/status', (req, res) => {
  const statusPath = path.join(DATA_DIR, 'last-updated.json');
  if (fs.existsSync(statusPath)) {
    res.json(JSON.parse(fs.readFileSync(statusPath, 'utf-8')));
  } else {
    res.json({ updatedAt: null });
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    const result = await fetchAndSaveOSMData();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Manual refresh failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Weekly refresh, every Sunday at 03:00 server time. This only fires while
// this process (`npm start`) is left running - see README for details.
cron.schedule('0 3 * * 0', () => {
  console.log(`[${new Date().toISOString()}] Running scheduled weekly road/city data refresh...`);
  fetchAndSaveOSMData().catch(err => console.error('Scheduled refresh failed:', err));
});

async function start() {
  const roadsPath = path.join(DATA_DIR, 'roads.geojson');
  const citiesPath = path.join(DATA_DIR, 'cities.geojson');

  if (!fs.existsSync(roadsPath) || !fs.existsSync(citiesPath)) {
    console.log('No cached map data found - fetching from OpenStreetMap for the first time. This can take a minute...');
    try {
      const result = await fetchAndSaveOSMData();
      console.log(`Initial fetch complete: ${result.roadCount} road segments, ${result.cityCount} cities/towns.`);
    } catch (err) {
      console.error('Initial data fetch failed:', err.message);
      console.error('Check your internet connection, then use the "Refresh map data" button in the app to retry.');
    }
  }

  app.listen(PORT, () => {
    console.log(`\nBulgaria travel map running at http://localhost:${PORT}\n`);
  });
}

start();
