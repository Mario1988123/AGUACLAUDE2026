import { describe, it, expect } from "vitest";
import { haversineKm, totalDistanceKm, nearestNeighborRoute, type RoutePoint } from "./haversine";

describe("haversineKm", () => {
  it("mismo punto => 0", () => {
    expect(haversineKm(40.4, -3.7, 40.4, -3.7)).toBe(0);
  });

  it("1 grado de latitud ≈ 111,19 km", () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it("es simétrica (A→B == B→A)", () => {
    const a = haversineKm(40.4168, -3.7038, 41.3874, 2.1686);
    const b = haversineKm(41.3874, 2.1686, 40.4168, -3.7038);
    expect(a).toBeCloseTo(b, 6);
  });

  it("Madrid–Barcelona en línea recta (rango razonable ~505 km)", () => {
    const d = haversineKm(40.4168, -3.7038, 41.3874, 2.1686);
    expect(d).toBeGreaterThan(490);
    expect(d).toBeLessThan(520);
  });
});

describe("totalDistanceKm", () => {
  const start = { lat: 40, lng: -3 };
  const p1: RoutePoint = { id: "1", lat: 41, lng: -3 };
  const p2: RoutePoint = { id: "2", lat: 41, lng: -2 };

  it("suma los tramos en el orden dado", () => {
    const expected = haversineKm(40, -3, 41, -3) + haversineKm(41, -3, 41, -2);
    expect(totalDistanceKm(start, [p1, p2])).toBeCloseTo(expected, 6);
  });

  it("sin paradas => 0", () => {
    expect(totalDistanceKm(start, [])).toBe(0);
  });
});

describe("nearestNeighborRoute (greedy)", () => {
  const start = { lat: 0, lng: 0 };
  const near: RoutePoint = { id: "near", lat: 0, lng: 1 }; // ~111 km
  const mid: RoutePoint = { id: "mid", lat: 0, lng: 2 }; // ~222 km
  const far: RoutePoint = { id: "far", lat: 0, lng: 5 }; // ~556 km

  it("visita del más cercano al más lejano", () => {
    const r = nearestNeighborRoute(start, [far, near, mid]);
    expect(r.ordered.map((p) => p.id)).toEqual(["near", "mid", "far"]);
  });

  it("visita todos los puntos exactamente una vez", () => {
    const r = nearestNeighborRoute(start, [far, near, mid]);
    expect(r.ordered).toHaveLength(3);
    expect(new Set(r.ordered.map((p) => p.id)).size).toBe(3);
  });

  it("totalKm coincide con la suma de los tramos del recorrido greedy", () => {
    const r = nearestNeighborRoute(start, [far, near, mid]);
    const manual = totalDistanceKm(start, [near, mid, far]);
    expect(r.totalKm).toBeCloseTo(manual, 6);
  });
});
