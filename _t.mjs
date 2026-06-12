import { extractSymbols } from './src/lib/sentiment/entity.ts';
const cases = [
  "Take a ton of profit and click the link in the dot-com bubble",
  "Chainlink (LINK) surges as $DOT and SOL rally",
  "Bitcoin and Ethereum lead; Solana dips",
  "Apple unveils new chip; NVDA hits record",
  "Meta Platforms (META) earnings beat",
];
for (const c of cases) console.log(JSON.stringify(extractSymbols(c)), "<=", c);
