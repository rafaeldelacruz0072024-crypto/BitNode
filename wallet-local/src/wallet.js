import { getAddress, formatUnits } from 'ethers';
export const INITIAL_SUPPLY = 11_000_000n * 10n ** 18n;
export const NETWORKS = { 56: { name: 'BNB Smart Chain', explorer: 'https://bscscan.com' }, 97: { name: 'BSC Testnet', explorer: 'https://testnet.bscscan.com' } };
export function validateAddress(value) { return getAddress(value.trim()); }
export function tokenMetrics(supply) {
  if (supply < 0n || supply > INITIAL_SUPPLY) throw new Error('El suministro no coincide con el token BitNode.');
  const burned = INITIAL_SUPPLY - supply;
  return { supply, burned, percent: Number(burned * 10000n / INITIAL_SUPPLY) / 100 };
}
export function displayUnits(value, decimals = 18) {
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.');
  if (value > 0n && whole === '0' && !/[1-9]/.test(fraction.slice(0, 6))) return '<0.000001';
  return `${BigInt(whole).toLocaleString('en-US')}${fraction && fraction !== '0' ? '.' + fraction.slice(0, 6) : ''}`;
}
export const ABI = ['function name() view returns (string)','function symbol() view returns (string)','function decimals() view returns (uint8)','function INITIAL_SUPPLY() view returns (uint256)','function totalSupply() view returns (uint256)','function balanceOf(address) view returns (uint256)'];
