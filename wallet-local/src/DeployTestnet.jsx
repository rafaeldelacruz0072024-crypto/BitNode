import React, { useState } from 'react';
import { BrowserProvider, ContractFactory, Contract, formatEther } from 'ethers';

const TREASURY = '0x5Ae91FC77d53C7c7Baa4568d178Fb0B824b0A20f';
const KEY = 'bitnode-btn-testnet-deployment-v1';
export function DeployTestnet() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [plan, setPlan] = useState(null);
  const [record, setRecord] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } });
  const [confirmed, setConfirmed] = useState(false);
  function save(value) { localStorage.setItem(KEY, JSON.stringify(value)); setRecord(value); }
  async function context() {
    if (!window.ethereum) throw new Error('Abre esta página en Chrome con MetaMask.');
    const provider = new BrowserProvider(window.ethereum);
    if ((await provider.getNetwork()).chainId !== 97n) throw new Error('Selecciona BSC Testnet (97) en MetaMask. La red principal está bloqueada en este flujo.');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    const signer = await provider.getSigner();
    if ((await signer.getAddress()).toLowerCase() !== TREASURY.toLowerCase()) throw new Error('Conecta la wallet de tesorería confirmada para desplegar este contrato.');
    const response = await fetch('/btn-testnet-artifact.json');
    if (!response.ok) throw new Error('No se pudo cargar el contrato compilado.');
    const artifact = await response.json();
    if (artifact.chainId !== 97 || artifact.symbol !== 'BTN' || artifact.treasury !== TREASURY) throw new Error('Configuración de despliegue inesperada.');
    return { provider, signer, artifact };
  }
  async function prepare() {
    setBusy(true); setMessage(''); setPlan(null); setConfirmed(false);
    try {
      const { provider, signer, artifact } = await context();
      const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer);
      const tx = await factory.getDeployTransaction('BTN', TREASURY);
      const gas = await signer.estimateGas(tx);
      const fees = await provider.getFeeData();
      const fee = gas * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n);
      if (!fee) throw new Error('No fue posible estimar la comisión.');
      if (await provider.getBalance(TREASURY) < fee) throw new Error('Necesitas BNB de prueba en esta wallet para pagar el gas. No envíes BNB de la red principal.');
      setPlan({ gas: gas.toString(), fee: formatEther(fee) });
      setMessage('Estimación lista. Revisa los datos y firma tú mismo en MetaMask.');
    } catch (e) { setMessage(e.shortMessage || e.message); }
    finally { setBusy(false); }
  }
  async function deploy() {
    if (!confirmed || !plan || record) return;
    setBusy(true); setMessage('Revisa y firma la solicitud en MetaMask.');
    try {
      const { signer, artifact } = await context();
      const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer);
      const contract = await factory.deploy('BTN', TREASURY);
      const tx = contract.deploymentTransaction();
      save({ hash: tx.hash, chainId: 97, address: await contract.getAddress(), status: 'Enviada' });
      setPlan(null);
      setMessage('Transacción enviada. Comprueba la confirmación con el botón Verificar.');
    } catch (e) { setMessage(e.code === 'ACTION_REJECTED' ? 'Firma cancelada. No se confirmó el despliegue.' : e.shortMessage || e.message); }
    finally { setBusy(false); }
  }
  async function verify() {
    if (!record) return;
    setBusy(true);
    try {
      const { provider, artifact } = await context();
      const receipt = await provider.getTransactionReceipt(record.hash);
      if (!receipt) throw new Error('La transacción aún no tiene recibo. No vuelvas a desplegar.');
      if (receipt.status !== 1) throw new Error('La transacción falló. Revisa su recibo en el explorador.');
      if (!receipt.contractAddress) throw new Error('El recibo no corresponde a creación de contrato.');
      const token = new Contract(receipt.contractAddress, artifact.abi, provider);
      const [name, symbol, initial, supply, owner, balance] = await Promise.all([token.name(), token.symbol(), token.INITIAL_SUPPLY(), token.totalSupply(), token.getOwner(), token.balanceOf(TREASURY)]);
      if (name !== 'BitNode' || symbol !== 'BTN' || initial.toString() !== artifact.initialSupply || owner !== TREASURY || supply > initial) throw new Error('Los datos en cadena no coinciden con el despliegue previsto.');
      save({ ...record, address: receipt.contractAddress, status: 'Confirmada', supply: supply.toString(), treasuryBalance: balance.toString() });
      setMessage('Contrato confirmado en BSC Testnet. Emisión inicial y propietario verificados.');
    } catch (e) { setMessage(e.shortMessage || e.message); }
    finally { setBusy(false); }
  }
  return <section className="panel info" style={{marginTop:24}}><span className="section-label">DESPLIEGUE · SOLO TESTNET</span><h2>Crear BitNode de prueba</h2><p>Nombre: <b>BitNode</b> · Símbolo: <b>BTN</b><br/>Emisión única: <b>11,000,000</b> · Red: <b>BSC Testnet (97)</b></p><p>Los tokens y el gas de prueba no tienen valor real. Este flujo no permite desplegar en la red principal.</p><label>Wallet de tesorería y propietario</label><p style={{overflowWrap:'anywhere'}}>{TREASURY}</p>
    <div className="notice" role="status">{message || 'Todavía no se ha solicitado una firma.'}</div>
    {!record && <button disabled={busy} onClick={prepare}>{busy ? 'Procesando…' : 'Conectar y estimar despliegue'}</button>}
    {plan && !record && <div><p>Gas estimado: {plan.gas}<br/>Comisión estimada: {plan.fee} BNB de prueba. MetaMask mostrará la comisión final.</p><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo red de prueba, emisión y tesorería.</label><div className="actions"><button className="primary" disabled={busy || !confirmed} onClick={deploy}>Revisar y firmar en MetaMask</button></div></div>}
    {record && <div><p>Estado: {record.status}</p><p style={{overflowWrap:'anywhere'}}>Contrato: {record.address}</p><a href={`https://testnet.bscscan.com/tx/${record.hash}`} target="_blank" rel="noreferrer">Ver transacción ↗</a><div className="actions"><button disabled={busy} onClick={verify}>Verificar confirmación</button></div><p>El registro local evita repetir el despliegue desde esta sesión del navegador. Consérvalo.</p></div>}
  </section>;
}
