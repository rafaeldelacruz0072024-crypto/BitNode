import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserProvider, Contract } from 'ethers';
import QRCode from 'qrcode';
import { ABI, INITIAL_SUPPLY, NETWORKS, displayUnits, tokenMetrics, validateAddress } from './wallet.js';
import './style.css';
import { DeployTestnet } from './DeployTestnet.jsx';
import { Overview, DemoProgram, Transparency } from './Hub.jsx';

function App() {
  const [tab, setTab] = useState('Resumen');
  const [account, setAccount] = useState('');
  const [network, setNetwork] = useState(null);
  const [native, setNative] = useState(null);
  const [token, setToken] = useState(null);
  const [contractInput, setContractInput] = useState('');
  const [contractAddress, setContractAddress] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const [showReceive, setShowReceive] = useState(false);
  const [updated, setUpdated] = useState('');
  const epoch = useRef(0);

  useEffect(() => {
    if (!showReceive) return;
    const escape = e => { if (e.key === 'Escape') setShowReceive(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [showReceive]);

  function clear() { epoch.current++; setAccount(''); setNative(null); setToken(null); setNetwork(null); setUpdated(''); setQr(''); setShowReceive(false); setBusy(false); }
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;
    const changed = () => { clear(); setMessage('La cuenta o la red cambió. Vuelve a conectar para consultar los datos.'); };
    eth.on('accountsChanged', changed); eth.on('chainChanged', changed);
    return () => { eth.removeListener?.('accountsChanged', changed); eth.removeListener?.('chainChanged', changed); };
  }, []);

  async function load(connect = false, selectedContract = contractAddress) {
    const version = ++epoch.current;
    setBusy(true); setMessage(''); setNative(null); setToken(null); setUpdated('');
    try {
      if (!window.ethereum) throw new Error('Abre esta página en Chrome con MetaMask o una wallet compatible instalada. No se necesitan frases semilla ni claves privadas.');
      const accounts = await window.ethereum.request({ method: connect ? 'eth_requestAccounts' : 'eth_accounts' });
      if (!accounts.length) throw new Error('Conecta tu wallet para consultar su saldo.');
      const address = validateAddress(accounts[0]);
      const provider = new BrowserProvider(window.ethereum);
      const chain = Number((await provider.getNetwork()).chainId);
      if (version !== epoch.current) return;
      setAccount(address); setNetwork(chain);
      if (!NETWORKS[chain]) throw new Error('Selecciona BNB Smart Chain o BSC Testnet en tu wallet. No se consultan saldos de otras redes.');
      const balance = await provider.getBalance(address);
      if (version !== epoch.current) return;
      setNative(balance);
      if (selectedContract) {
        const validated = validateAddress(selectedContract);
        if (await provider.getCode(validated) === '0x') throw new Error('No existe un contrato en esa dirección y red.');
        const contract = new Contract(validated, ABI, provider);
        const [name, symbol, decimals, initial, supply, owned] = await Promise.all([contract.name(), contract.symbol(), contract.decimals(), contract.INITIAL_SUPPLY(), contract.totalSupply(), contract.balanceOf(address)]);
        if (name !== 'BitNode' || decimals !== 18n || initial !== INITIAL_SUPPLY) throw new Error('El contrato no coincide con el nombre, decimales y emisión inicial de BitNode.');
        const metrics = tokenMetrics(supply);
        if (version !== epoch.current) return;
        setToken({ name, symbol, owned, ...metrics });
      }
      if (version === epoch.current) setUpdated(new Date().toLocaleTimeString('es'));
    } catch (e) {
      if (version === epoch.current) setMessage(e.code === 4001 || e.code === 'ACTION_REJECTED' ? 'Conexión cancelada. No se realizó ninguna operación.' : e.shortMessage || e.message || 'No se pudo consultar la wallet.');
    } finally { if (version === epoch.current) setBusy(false); }
  }
  async function receive() {
    try { setQr(await QRCode.toDataURL(account, { width: 256, margin: 2 })); setShowReceive(true); }
    catch { setMessage('No se pudo generar el QR. Puedes copiar tu dirección.'); }
  }
  async function copy() { try { await navigator.clipboard.writeText(account); setMessage('Dirección copiada.'); } catch { setMessage('No se pudo copiar. Selecciona la dirección que aparece en pantalla.'); } }
  function configure(e) {
    e.preventDefault();
    try {
      const address = contractInput.trim() ? validateAddress(contractInput) : '';
      setContractAddress(address); setToken(null); setMessage(address ? 'Dirección configurada solo para esta sesión. Su identidad debe verificarse por el canal oficial de BitNode.' : 'Contrato pendiente de despliegue.');
      if (account) load(false, address);
    } catch { setMessage('La dirección del contrato no es válida.'); }
  }
  const unit = token?.symbol || 'BTN';
  return <div className="shell">
    <aside><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('Resumen'); }}><img src="/bitnode-logo.png" alt="BitNode"/></a><div className="workspace">TOKEN WORKSPACE</div>
      <nav>{[['Resumen','⌂'],['Wallet','◈'],['Recompensas','✧'],['Beneficios','◇'],['Suministro','▥'],['Transparencia','◎'],['Actividad','↗'],['Configuración','⚙']].map(([label,icon]) => <button key={label} className={tab === label ? 'active' : ''} onClick={() => setTab(label)}><span>{icon}</span>{label}</button>)}</nav>
      <div className="aside-bottom"><span className="status-dot"/> Desarrollo local<p>BitNode BEP-20<br/>Beneficios y recompensas</p></div>
    </aside>
    <main><header><span>BitNode / <b>{tab}</b></span><div><span className="network">● {NETWORKS[network]?.name || 'BEP-20'}</span><button className="connect" disabled={busy} onClick={() => account ? (clear(), setMessage('Wallet desconectada de esta interfaz.')) : load(true)}>{busy ? 'Consultando…' : account ? `${account.slice(0,6)}…${account.slice(-4)} · Salir` : 'Conectar wallet'} ↗</button></div></header>
      <div className="page"><div className="page-title"><div><h1>{tab === 'Wallet' ? 'Mi wallet' : tab}</h1><p>Tu conexión al ecosistema BitNode.</p></div><span className="local-label">LOCAL · SIN CUSTODIA</span></div>
        {message && <div className="notice" role="status">{message}</div>}
        {tab === 'Resumen' && <Overview token={token} navigate={setTab}/>} 
        <div hidden={!['Recompensas','Beneficios'].includes(tab)}><DemoProgram view={tab}/></div> 
        {tab === 'Transparencia' && <Transparency token={token} network={network} address={contractAddress} navigate={setTab}/>} 
        {tab === 'Wallet' && <>
          <div className="top-grid"><section className="balance panel"><div className="section-label">BALANCE DE BITNODE <span>↗</span></div><h2>{token ? displayUnits(token.owned) : account ? 'Por consultar' : 'Sin conectar'}{token && <small> {unit}</small>}</h2><p>{account ? account : 'Conecta tu wallet para consultar tus activos en BNB Chain.'}</p><div className="actions"><button className="primary" disabled={!account || !NETWORKS[network]} onClick={receive}>↓ Recibir</button><button disabled={!account} onClick={copy}>⧉ Copiar dirección</button><button aria-label="Actualizar saldos" disabled={!account || busy} onClick={() => load()}>↻</button></div><div className="balance-footer">{updated ? `Última consulta ${updated}` : 'Las claves permanecen en tu wallet.'}<span>BNB CHAIN ↗</span></div></section>
          <section className="supply-card panel"><div className="section-label">EMISIÓN INICIAL <span>◈</span></div><h2>11,000,000</h2><p>Tokens BitNode · Emisión única</p><div className="supply-divider"/><div className="pending"><span className="status-dot"/>{contractAddress ? 'Contrato configurado localmente' : 'Contrato pendiente de despliegue'}</div><button className="text-button" onClick={() => setTab('Suministro')}>Explorar suministro <span>↗</span></button></section></div>
          <div className="metrics">{[['Saldo '+unit,token ? displayUnits(token.owned) : '—','Token de beneficios'],['Saldo BNB',native !== null ? displayUnits(native) : '—','Moneda para las comisiones de red'],['Tokens quemados',token ? displayUnits(token.burned) : '—','Reducción permanente del suministro']].map(([title,value,desc]) => <section className="metric panel" key={title}><div className="section-label">{title}<span>↗</span></div><strong>{value}</strong><p>{desc}</p></section>)}</div>
          <Supply token={token}/><Activity/>
        </>}
        {tab === 'Suministro' && <><Supply token={token}/><section className="panel info"><h2>Una emisión. Sin nuevas emisiones.</h2><p>El contrato crea 11 millones de tokens en la tesorería al desplegarse. Cada quema voluntaria reduce el suministro total. Los tokens quemados no vuelven a emitirse.</p><p>El suministro total no equivale al circulante. La distribución de reservas y recompensas aún está pendiente de definir.</p><p>La quema se implementó en el contrato; firmar quemas desde esta interfaz se habilitará tras verificar su despliegue.</p></section></>}
        {tab === 'Actividad' && <Activity/>}
        {tab === 'Configuración' && <section className="panel info"><h2>Contrato de BitNode</h2><p>Configura la dirección pública cuando el contrato esté desplegado. Se consulta en la red seleccionada en tu wallet. Esta configuración se elimina al recargar la página.</p><form onSubmit={configure}><label htmlFor="contract">Dirección del contrato BEP-20</label><input id="contract" placeholder="0x…" value={contractInput} onChange={e => setContractInput(e.target.value)}/><button className="primary" disabled={busy}>Guardar y consultar</button></form><p>BTN es el símbolo confirmado. El nombre, símbolo, emisión y saldos se consultan directamente al contrato. Comprobar sus metadatos no sustituye verificar la dirección oficial.</p></section>}
        {tab === 'Configuración' && <DeployTestnet/>}
        <footer>BitNode Wallet <span>Sin precio de mercado ni conversión a USDT configurados.</span></footer>
      </div>
    </main>
    {showReceive && <div className="modal-bg" onClick={() => setShowReceive(false)}><section className="modal panel" role="dialog" aria-modal="true" aria-label="Recibir en tu wallet" onClick={e => e.stopPropagation()}><button autoFocus className="close" onClick={() => setShowReceive(false)}>Cerrar ×</button><h2>Recibir en tu wallet</h2><p>{NETWORKS[network]?.name}</p><img src={qr} alt="Código QR de tu dirección pública"/><code>{account}</code><p>QR de dirección solamente. Confirma token, monto y red en la wallet emisora.</p><button className="primary" onClick={copy}>Copiar dirección</button></section></div>}
  </div>;
}
function Supply({token}) { return <section className="panel supply-detail"><div className="section-label">SUMINISTRO DEL TOKEN <span>{token ? 'CONSULTADO EN CADENA' : 'PENDIENTE DE CONSULTA'}</span></div><div className="supply-heading"><h3>La quema reduce el suministro.</h3><span>{token ? token.percent + '% quemado' : 'Emisión máxima: 11 millones'}</span></div><div className="supply-bar"><div style={{width:token ? `${100-token.percent}%` : '0%'}}/></div><div className="legend"><span><i/> Suministro total {token ? displayUnits(token.supply) : '—'}</span><span>Quemado {token ? displayUnits(token.burned) : '—'}</span></div></section>; }
function Activity() { return <section className="panel activity"><div className="section-label">ACTIVIDAD RECIENTE <span>HISTORIAL</span></div><div className="table-head"><span>OPERACIÓN</span><span>MONTO</span><span>ESTADO</span></div><div className="empty"><span>↗</span><h3>Sin movimientos consultados</h3><p>El historial indexado se conectará cuando se despliegue el contrato.<br/>Esta vista no representa un historial vacío de tu wallet.</p></div></section>; }
createRoot(document.getElementById('root')).render(<App/>);







