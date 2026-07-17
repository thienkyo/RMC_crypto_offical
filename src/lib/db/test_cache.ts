import { fetchLatestCandlesCached } from './candles';
async function run() {
  console.log('Fetching BNBUSDT 1d...');
  try {
    const res = await fetchLatestCandlesCached('BNBUSDT', '1d', 1000);
    console.log('Success, fetched:', res.length);
  } catch (err) {
    console.error('Error fetching:', err);
  }
  process.exit(0);
}
run();
