import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from './compile.mjs';
import solc from 'solc';

const artifact = compile();
const destination = fileURLToPath(new URL('../../wallet-local/public/btn-testnet-artifact.json', import.meta.url));
fs.writeFileSync(destination, JSON.stringify({
  ...artifact,
  compiler: solc.version(),
  chainId: 97,
  symbol: 'BTN',
  treasury: '0x5Ae91FC77d53C7c7Baa4568d178Fb0B824b0A20f',
  initialSupply: '11000000000000000000000000',
  settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 } },
}, null, 2));
console.log('Testnet artifact prepared. No transaction sent.');
