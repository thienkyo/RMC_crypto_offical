import { fetchKlines } from './src/lib/exchange/binance';
async function test() {
  const candles = await fetchKlines('BTCUSDT', '15m', 3);
  const now = Date.now();
  console.log('Now:', new Date(now).toISOString());
  console.log(candles.map(c => ({
    open: new Date(c.openTime).toISOString(),
    close: new Date(c.closeTime).toISOString(),
    isClosed: c.closeTime < now
  })));
}
test();
