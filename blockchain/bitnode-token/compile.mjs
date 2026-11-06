import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export function compile() {
  const input = {
    language: 'Solidity',
    sources: { 'BitNodeToken.sol': { content: fs.readFileSync(path.join(root, 'contracts/BitNodeToken.sol'), 'utf8') } },
    settings: {
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: name => {
    if (!name.startsWith('@openzeppelin/contracts/')) return { error: 'Unsupported import' };
    return { contents: fs.readFileSync(path.join(root, 'node_modules', name), 'utf8') };
  } }));
  const errors = (output.errors ?? []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  return output.contracts['BitNodeToken.sol'].BitNodeToken;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/BitNodeToken.json'), JSON.stringify(compile(), null, 2));
  console.log('Contract compiled. No network transaction submitted.');
}
