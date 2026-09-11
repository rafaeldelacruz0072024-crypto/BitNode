import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
} from "lucide-react";
import {
  advancePredictions,
  initialPredictions,
  predictionReturn,
  simulationSummary,
  type Market,
} from "@/lib/marketSimulation";
import "./market-predictions.css";

const currency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value
  );
const signedMoney = (value: number) =>
  `${value >= 0 ? "+" : "−"}${currency(Math.abs(value))}`;
const price = (value: number, decimals: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

const operationFeed = [
  ["BTC / USDT", "Analizando impulso", "+0.42%"],
  ["EUR / USD", "Validando señal", "68%"],
  ["NASDAQ 100", "Ajustando escenario", "−0.18%"],
  ["ETH / USDT", "Operación virtual", "+0.31%"],
  ["S&P 500", "Calculando resultado", "+0.12%"],
] as const;

export default function MarketPredictions() {
  const [simulation, setSimulation] = useState(() => ({
    rows: initialPredictions(),
    step: 0,
  }));
  const [running, setRunning] = useState(true);
  const [market, setMarket] = useState<Market | "Todos">("Todos");
  const [status, setStatus] = useState("Todas");
  const [notice, setNotice] = useState("");
  const [activityIndex, setActivityIndex] = useState(0);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setSimulation(current => ({
        rows: advancePredictions(current.rows, current.step + 1),
        step: current.step + 1,
      }));
    }, 8000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setActivityIndex(value => (value + 1) % operationFeed.length),
      1400
    );
    return () => window.clearInterval(timer);
  }, [running]);

  const visible = useMemo(
    () =>
      simulation.rows.filter(
        row =>
          (market === "Todos" || row.market === market) &&
          (status === "Todas" || row.status === status)
      ),
    [simulation.rows, market, status]
  );
  const summary = useMemo(
    () => simulationSummary(simulation.rows),
    [simulation.rows]
  );

  return (
    <div className="market-sim">
      <div className="mp-heading">
        <div>
          <span className="mp-eyebrow">BITNODE · INTELIGENCIA DE MERCADO</span>
          <h2>Predicciones de mercado</h2>
          <p>Explora señales, escenarios y movimientos de precio.</p>
        </div>
        <span className={`mp-live ${running ? "is-running" : ""}`}>
          <i />
          {running ? "SIMULACIÓN ACTIVA" : "SIMULACIÓN PAUSADA"}
        </span>
      </div>

      <div className="mp-disclosure">
        <CircleHelp size={16} />
        <p>
          <strong>Modo demostración.</strong> Precios, señales y resultados
          ficticios. No ejecuta operaciones ni modifica tu balance.
        </p>
        <span>USD VIRTUAL</span>
      </div>

      <div className={`mp-operation-feed ${running ? "is-running" : ""}`} aria-label="Actividad de operaciones simuladas">
        <span className="mp-feed-label"><Activity size={14} /> OPERACIONES SIMULADAS</span>
        <div className="mp-feed-window" aria-live="polite">
          {operationFeed.map((item, index) => (
            <div className={index === activityIndex ? "is-active" : ""} key={item[0]}>
              <i /><strong>{item[0]}</strong><span>{item[1]}</span><b>{item[2]}</b>
            </div>
          ))}
        </div>
        <small>{running ? "PROCESANDO" : "EN PAUSA"}<i /></small>
      </div>

      <section
        className="mp-metrics"
        key={`metrics-${simulation.step}`}
        aria-label="Resumen de los 30 escenarios simulados"
      >
        <article>
          <span>ESCENARIOS MONITOREADOS</span>
          <strong>{summary.count}</strong>
          <small>Últimos 30 escenarios</small>
        </article>
        <article className="mp-blue">
          <span>VOLUMEN SIMULADO</span>
          <strong>{currency(summary.volume)}</strong>
          <small>Capital virtual de la muestra</small>
        </article>
        <article
          className={summary.result >= 0 ? "mp-positive" : "mp-negative"}
        >
          <span>RESULTADO SIMULADO</span>
          <strong>{signedMoney(summary.result)}</strong>
          <small>Solo escenarios completados</small>
        </article>
        <article className="mp-purple">
          <span>ACIERTOS DE LA MUESTRA</span>
          <strong>
            {summary.accuracy === null
              ? "—"
              : `${summary.accuracy.toFixed(1)}%`}
          </strong>
          <small>Completados con resultado positivo</small>
        </article>
      </section>

      <div className="mp-toolbar">
        <div>
          <h3>
            <ScanLine size={17} /> Escenarios monitoreados
          </h3>
          <span>Ciclo acelerado · actualización cada 8 s · actividad continua</span>
        </div>
        <div className="mp-actions">
          <button
            type="button"
            onClick={() => {
              setRunning(value => !value);
              setNotice(
                running ? "Simulación pausada." : "Simulación reanudada."
              );
            }}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
            {running ? "Pausar" : "Reanudar"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSimulation({ rows: initialPredictions(), step: 0 });
              setRunning(false);
              setMarket("Todos");
              setStatus("Todas");
              setNotice(
                "Muestra reiniciada y pausada. Pulsa Reanudar para comenzar."
              );
            }}
          >
            <RotateCcw size={14} />
            Reiniciar
          </button>
        </div>
      </div>
      <div className="mp-filters">
        <div className="mp-tabs" role="group" aria-label="Estado del escenario">
          {[
            ["Todas", "Todas"],
            ["Monitoreando", "Monitoreando"],
            ["Completada", "Completadas"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mp-select">
          Mercado
          <select
            value={market}
            onChange={event =>
              setMarket(event.target.value as Market | "Todos")
            }
          >
            <option>Todos</option>
            <option>Cripto</option>
            <option>Forex</option>
            <option>Índices</option>
          </select>
        </label>
      </div>
      <p className="mp-status" role="status">
        {notice ||
          `${visible.length} escenarios visibles · los indicadores resumen la muestra completa.`}
      </p>

      <div className="mp-list">
        {visible.map(row => {
          const result = predictionReturn(row);
          const Direction =
            row.direction === "Alcista" ? ArrowUpRight : ArrowDownRight;
          return (
            <article
              className={`mp-row ${row.ticks === 0 && row.status === "Monitoreando" ? "is-new-operation" : ""}`}
              key={row.id}
              aria-label={`Escenario ${row.id}: ${row.pair}, ${row.status}`}
            >
              <div className="mp-row-header">
                <div className="mp-instrument">
                  <span
                    className={`mp-category mp-category-${row.market === "Cripto" ? "crypto" : row.market === "Forex" ? "forex" : "index"}`}
                  >
                    {row.market}
                  </span>
                  <h4>{row.pair}</h4>
                  <span className="mp-horizon">{row.horizon}</span>
                </div>
                <span
                  className={`mp-state ${row.status === "Completada" ? "is-complete" : "is-monitoring"}`}
                >
                  <i />
                  {row.status}
                </span>
              </div>
              <div className="mp-row-body">
                <div className="mp-price">
                  <span>ENTRADA</span>
                  <strong>{price(row.entry, row.decimals)}</strong>
                  <small
                    className={
                      row.direction === "Alcista" ? "mp-positive" : "mp-purple"
                    }
                  >
                    <Direction size={12} />
                    {row.direction}
                  </small>
                </div>
                <ArrowRight className="mp-arrow" size={15} />
                <div className="mp-price">
                  <span>
                    {row.status === "Completada"
                      ? "CIERRE SIMULADO"
                      : "PRECIO SIMULADO"}
                  </span>
                  <strong className="mp-live-price" key={`${row.id}-${row.ticks}`}>{price(row.price, row.decimals)}</strong>
                  <small>Escenario #{String(row.id).padStart(4, "0")}</small>
                </div>
                <div className="mp-confidence">
                  <span>CONFIANZA SIMULADA</span>
                  <strong>{row.confidence}%</strong>
                  <div className="mp-confidence-track" aria-hidden="true">
                    <i style={{ width: `${row.confidence}%` }} />
                  </div>
                </div>
                <div className="mp-amount">
                  <span>VOLUMEN VIRTUAL</span>
                  <strong>{currency(row.amount)}</strong>
                  <small>USD</small>
                </div>
                <div
                  className={`mp-result ${result.amount >= 0 ? "mp-positive" : "mp-negative"}`}
                >
                  <span>
                    {row.status === "Completada" ? "RESULTADO" : "NO REALIZADO"}
                  </span>
                  <strong>{signedMoney(result.amount)}</strong>
                  <small>
                    {result.percent >= 0 ? "+" : ""}
                    {result.percent.toFixed(3)}%
                  </small>
                </div>
              </div>
            </article>
          );
        })}
        {!visible.length && (
          <div className="mp-empty">
            <Activity size={24} />
            <h4>No hay escenarios con estos filtros</h4>
            <p>Cambia el mercado o el estado para explorar la muestra.</p>
          </div>
        )}
      </div>
      <footer className="mp-footer">
        <span>
          <i /> {visible.length} de {simulation.rows.length} escenarios
        </span>
        <span>Simulación educativa · sin cotizaciones en vivo</span>
      </footer>
    </div>
  );
}
