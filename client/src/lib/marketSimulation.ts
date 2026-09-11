export type Market = "Cripto" | "Forex" | "Índices";
export type Prediction = {
  id: number;
  pair: string;
  market: Market;
  decimals: number;
  direction: "Alcista" | "Bajista";
  entry: number;
  price: number;
  amount: number;
  confidence: number;
  horizon: string;
  status: "Monitoreando" | "Completada";
  ticks: number;
};

// Fictional quotes for the demonstration. No market feed or account connection.
const instruments = [
  { pair: "BTC / USDT", market: "Cripto", price: 109240, decimals: 2 },
  { pair: "ETH / USDT", market: "Cripto", price: 4182, decimals: 2 },
  { pair: "BNB / USDT", market: "Cripto", price: 846, decimals: 2 },
  { pair: "SOL / USDT", market: "Cripto", price: 198.4, decimals: 2 },
  { pair: "EUR / USD", market: "Forex", price: 1.0842, decimals: 5 },
  { pair: "GBP / USD", market: "Forex", price: 1.2735, decimals: 5 },
  { pair: "NASDAQ 100", market: "Índices", price: 22415, decimals: 2 },
  { pair: "S&P 500", market: "Índices", price: 6380, decimals: 2 },
] as const;

function sample(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));

export function createPrediction(id: number, completed = false): Prediction {
  const asset = instruments[id % instruments.length];
  const entry = round(
    asset.price * (1 + (sample(id + 1) - 0.5) * 0.015),
    asset.decimals
  );
  const direction = id % 3 === 0 ? "Bajista" : "Alcista";
  const change = (sample(id + 8) - 0.32) * 0.025;
  return {
    id,
    pair: asset.pair,
    market: asset.market,
    decimals: asset.decimals,
    direction,
    entry,
    price: round(
      entry * (1 + change * (direction === "Alcista" ? 1 : -1)),
      asset.decimals
    ),
    amount: 250 + Math.floor(sample(id + 12) * 4750),
    confidence: 58 + Math.floor(sample(id + 20) * 29),
    horizon: ["5 min", "15 min", "1 hora"][id % 3],
    status: completed ? "Completada" : "Monitoreando",
    ticks: 0,
  };
}

export function initialPredictions(): Prediction[] {
  return Array.from({ length: 30 }, (_, index) =>
    createPrediction(30 - index, index >= 6)
  );
}

export function predictionReturn(row: Prediction) {
  const percent =
    ((row.price - row.entry) / row.entry) *
    100 *
    (row.direction === "Alcista" ? 1 : -1);
  return { percent, amount: round((row.amount * percent) / 100) };
}

export function advancePredictions(
  rows: Prediction[],
  step: number
): Prediction[] {
  const updated = rows.map(row => {
    if (row.status === "Completada") return row;
    const ticks = row.ticks + 1;
    return {
      ...row,
      ticks,
      price: round(
        row.price * (1 + (sample(row.id * 31 + step) - 0.5) * 0.006),
        row.decimals
      ),
      confidence: Math.max(
        50,
        Math.min(
          89,
          row.confidence + Math.round((sample(step + row.id) - 0.5) * 4)
        )
      ),
      status: ticks >= 3 ? ("Completada" as const) : ("Monitoreando" as const),
    };
  });
  return [
    createPrediction(Math.max(...rows.map(row => row.id)) + 1),
    ...updated,
  ].slice(0, 30);
}

export function tickPredictionPrices(
  rows: Prediction[],
  quoteStep: number
): Prediction[] {
  return rows.map(row => {
    if (row.status === "Completada") return row;
    const drift = (sample(row.id * 79 + quoteStep * 3) - 0.5) * 0.0024;
    const confidenceDrift = sample(row.id * 17 + quoteStep) > 0.66
      ? sample(row.id + quoteStep) > 0.5 ? 1 : -1
      : 0;
    return {
      ...row,
      price: round(Math.max(row.entry * 0.94, row.price * (1 + drift)), row.decimals),
      confidence: Math.max(50, Math.min(89, row.confidence + confidenceDrift)),
    };
  });
}

export function simulationSummary(rows: Prediction[]) {
  const completed = rows.filter(row => row.status === "Completada");
  return {
    count: rows.length,
    volume: rows.reduce((sum, row) => sum + row.amount, 0),
    result: round(rows.reduce((sum, row) => sum + predictionReturn(row).amount, 0)),
    accuracy: completed.length
      ? (completed.filter(row => predictionReturn(row).amount > 0).length /
          completed.length) *
        100
      : null,
  };
}
