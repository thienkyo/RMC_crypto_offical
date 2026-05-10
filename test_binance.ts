import { fetchKlines } from './src/lib/exchange/binance';
async function test() {
  const candles = await fetchKlines('BTCUSDT', '15m', 3);
  console.log(candles.map(c => ({
    openTime: new Date(c.openTime).toISOString(),
    closeTime: new Date(c.closeTime).toISOString()
  })));
}
test();
