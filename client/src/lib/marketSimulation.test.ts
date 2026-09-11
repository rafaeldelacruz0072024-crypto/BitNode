import { describe, expect, it } from "vitest";
import {
  advancePredictions,
  createPrediction,
  initialPredictions,
  predictionReturn,
  simulationSummary,
} from "./marketSimulation";

describe("prediction simulation", () => {
  it("calculates opposite P/L for bullish and bearish positions", () => {
    const base = {
      ...createPrediction(1),
      entry: 100,
      price: 102,
      amount: 1000,
    };
    expect(predictionReturn({ ...base, direction: "Alcista" })).toEqual({
      percent: 2,
      amount: 20,
    });
    expect(predictionReturn({ ...base, direction: "Bajista" })).toEqual({
      percent: -2,
      amount: -20,
    });
  });
  it("counts only completed results and handles no completed scenarios", () => {
    const row = {
      ...createPrediction(1),
      entry: 100,
      price: 101,
      amount: 1000,
      direction: "Alcista" as const,
    };
    const summary = simulationSummary([
      row,
      { ...row, id: 2, status: "Completada" },
    ]);
    expect(summary).toEqual({
      count: 2,
      volume: 2000,
      result: 10,
      accuracy: 100,
    });
    expect(simulationSummary([row])).toMatchObject({
      result: 0,
      accuracy: null,
    });
  });
  it("freezes completed scenarios while settling monitored ones", () => {
    const rows = initialPredictions();
    let next = rows;
    for (let step = 1; step <= 3; step++) next = advancePredictions(next, step);
    expect(next.find(row => row.id === rows[0].id)?.status).toBe("Completada");
    expect(next.find(row => row.id === rows[6].id)).toEqual(rows[6]);
    expect(rows[0].status).toBe("Monitoreando");
  });
  it("keeps a bounded sample with unique IDs and both positive and negative outcomes", () => {
    let rows = initialPredictions();
    expect(rows.some(row => predictionReturn(row).amount < 0)).toBe(true);
    expect(rows.some(row => predictionReturn(row).amount > 0)).toBe(true);
    for (let step = 1; step <= 100; step++)
      rows = advancePredictions(rows, step);
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map(row => row.id)).size).toBe(30);
    expect(rows.every(row => Number.isFinite(row.price) && row.price > 0)).toBe(
      true
    );
  });
});
