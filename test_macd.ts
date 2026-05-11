function emaArray(values: number[], period: number): number[] {
  const k   = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period - 1; i++) out.push(NaN);
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

const candles = Array.from({ length: 250 }, (_, i) => ({ close: 100 + i, openTime: i * 1000 }));
const fast = 12, slow = 26, signal = 9, trendEma = 200;

const minRequired = Math.max(slow + signal, trendEma);
console.log("minRequired", minRequired);

const closes   = candles.map((c) => c.close);
const fastEma  = emaArray(closes, fast);
const slowEma  = emaArray(closes, slow);
const trendEmaArr = emaArray(closes, trendEma);

const macdLine = fastEma.map((f, i) => f - slowEma[i]!);
const macdValid  = macdLine.slice(slow - 1);
const signalArr  = emaArray(macdValid, signal);

const fullMacd = [...Array(slow - 1).fill(NaN), ...macdValid];
const fullSignal = [...Array(slow - 1).fill(NaN), ...signalArr];
const fullHist = fullMacd.map((m, i) => m - fullSignal[i]!);

console.log("candles", candles.length);
console.log("closes", closes.length);
console.log("fastEma", fastEma.length);
console.log("slowEma", slowEma.length);
console.log("macdLine", macdLine.length);
console.log("macdValid", macdValid.length);
console.log("signalArr", signalArr.length);
console.log("fullMacd", fullMacd.length);
console.log("fullSignal", fullSignal.length);
console.log("fullHist", fullHist.length);

const startIdx = minRequired;
console.log("startIdx", startIdx);

const times = candles.map((c) => c.openTime);

const macdLineData = fullMacd.slice(startIdx).map((v, i) => {
    if (times[i + startIdx] === undefined) {
        console.log("UNDEFINED AT", i, "i + startIdx", i + startIdx);
    }
    return { time: times[i + startIdx]!, value: v };
});

console.log("macdLineData", macdLineData.length);
