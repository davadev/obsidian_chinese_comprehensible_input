// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "./__mocks__/obsidianDom";
import { countBeforeWindow, renderDailyGraph, renderProgressArea, renderProgressGraph, renderTopicRadar, RADAR_LAYOUT, type RadarSpoke } from "../ui/StatsGraph";

/**
 * The charts on the stats dashboard, as the SVG they draw. The numbers behind them are tested elsewhere (bucketing,
 * running totals, radar geometry); this checks what ends up on screen: how many marks, how tall, where, with what
 * tooltip and legend, and what is drawn (or not) when there is nothing to plot.
 */

installObsidianDom();

const NOW = new Date("2026-10-10T12:00:00.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const box = () => document.createElement("div");
const attr = (e: Element, k: string) => e.getAttribute(k);
const day = (back: number) => new Date(NOW.getTime() - back * 86400000).toISOString().slice(0, 10);
const series = (label: string, color: string, counts: number[]) => ({ label, color, data: counts.map((count, i) => ({ label: `b${i}`, count })) });

describe("renderDailyGraph", () => {
  it("draws one bar per day for 60 days by default, today on the right, scaled to the busiest day", () => {
    const c = box();
    renderDailyGraph(c, { [day(0)]: 10, [day(1)]: 5 });
    const svg = c.querySelector("svg")!;
    expect(attr(svg, "class")).toBe("cci-stats-graph");
    expect(attr(svg, "viewBox")).toBe("0 0 360 80");
    const bars = Array.from(svg.querySelectorAll("rect"));
    expect(bars).toHaveLength(60);
    expect(attr(bars[59], "height")).toBe("76");
    expect(attr(bars[59], "y")).toBe("4");
    expect(attr(bars[58], "height")).toBe("38");
    expect(attr(bars[0], "height")).toBe("0");
    expect(attr(bars[3], "x")).toBe("18");
  });

  it("takes any number of days, and replaces what the container held", () => {
    const c = box();
    c.textContent = "old";
    renderDailyGraph(c, {}, 7);
    expect(c.textContent).toBe("");
    expect(c.querySelectorAll("rect")).toHaveLength(7);
    expect(attr(c.querySelector("svg")!, "viewBox")).toBe("0 0 42 80");
  });

  it("no activity at all draws flat bars, not NaN", () => {
    const c = box();
    renderDailyGraph(c, {}, 5);
    expect(Array.from(c.querySelectorAll("rect")).every((r) => attr(r, "height") === "0" && attr(r, "y") === "80")).toBe(true);
  });
});

describe("renderProgressArea (running totals)", () => {
  it("draws nothing for no series or a series with no buckets", () => {
    const c = box();
    c.textContent = "old";
    renderProgressArea(c, []);
    expect(c.children).toHaveLength(0);
    renderProgressArea(c, [series("A", "red", [])]);
    expect(c.children).toHaveLength(0);
  });

  it("a filled area, its line and an end dot with the running total, per series", () => {
    const c = box();
    renderProgressArea(c, [series("Known", "green", [1, 2, 3]), series("Seen", "blue", [0, 0, 1])]);
    const svg = c.querySelector("svg")!;
    expect(attr(svg, "class")).toBe("cci-progress-graph");
    expect(attr(svg, "preserveAspectRatio")).toBe("none");
    expect(svg.querySelectorAll("polygon")).toHaveLength(2);
    expect(svg.querySelectorAll("polyline")).toHaveLength(2);
    const dots = Array.from(svg.querySelectorAll("circle"));
    expect(dots.map((d) => d.querySelector("title")!.textContent)).toEqual(["Known: 6", "Seen: 1"]);
    expect(attr(dots[0], "fill")).toBe("green");
    // the line climbs: the last point is higher (smaller y) than the first
    const pts = attr(svg.querySelector("polyline")!, "points")!.split(" ").map((p) => p.split(",").map(Number));
    expect(pts[2][1]).toBeLessThan(pts[0][1]);
    expect(pts[0][0]).toBe(6);
    expect(pts[2][0]).toBe(594);
  });

  it("opens at the balance from before the window", () => {
    const c = box();
    renderProgressArea(c, [{ ...series("Known", "green", [1, 1]), prior: 10 }]);
    expect(c.querySelector("circle title")!.textContent).toBe("Known: 12");
  });

  it("a single bucket sits in the middle", () => {
    const c = box();
    renderProgressArea(c, [series("A", "red", [4])]);
    expect(attr(c.querySelector("circle")!, "cx")).toBe("300");
  });

  it("labels the first, middle and last bucket on the axis", () => {
    const c = box();
    renderProgressArea(c, [series("A", "red", [1, 1, 1, 1, 1])]);
    expect(Array.from(c.querySelectorAll("text")).map((t) => t.textContent)).toEqual(["b0", "b2", "b4"]);
  });

  it("the legend names each series with its total, in its colour", () => {
    const c = box();
    renderProgressArea(c, [series("Known", "green", [1, 2]), series("Seen", "blue", [3, 0])]);
    const items = Array.from(c.querySelectorAll(".cci-progress-legend-item"));
    expect(items.map((i) => i.textContent)).toEqual(["Known (3)", "Seen (3)"]);
    expect((items[0].querySelector(".cci-progress-legend-swatch") as HTMLElement).style.background).toBe("green");
  });

  it("a chart of zeros still draws (flat) without dividing by zero", () => {
    const c = box();
    renderProgressArea(c, [series("A", "red", [0, 0, 0])]);
    expect(attr(c.querySelector("polyline")!, "points")).not.toContain("NaN");
  });
});

describe("renderProgressGraph (bars)", () => {
  it("draws nothing for no series or no buckets", () => {
    const c = box();
    renderProgressGraph(c, []);
    renderProgressGraph(c, [series("A", "red", [])]);
    expect(c.children).toHaveLength(0);
  });

  it("one bar per bucket per series, side by side, scaled to the biggest count, each with a tooltip", () => {
    const c = box();
    renderProgressGraph(c, [series("Added", "red", [2, 0, 4]), series("Learned", "blue", [1, 1, 1])]);
    const svg = c.querySelector("svg")!;
    expect(attr(svg, "viewBox")).toBe("0 0 36 100");
    const bars = Array.from(svg.querySelectorAll("rect"));
    expect(bars).toHaveLength(6);
    expect(attr(bars[2], "height")).toBe("86"); // the max count fills H - 14
    expect(attr(bars[1], "height")).toBe("0");
    expect(bars[0].querySelector("title")!.textContent).toBe("b0 · Added: 2");
    expect(attr(bars[0], "width")).toBe("5");
    expect(attr(bars[3], "x")).not.toBe(attr(bars[0], "x")); // series sit side by side
  });

  it("a lone series gets the widest bars, and never thinner than 2", () => {
    const one = box();
    renderProgressGraph(one, [series("A", "red", [1])]);
    expect(attr(one.querySelector("rect")!, "width")).toBe("10");
    const many = box();
    renderProgressGraph(many, Array.from({ length: 8 }, (_, i) => series(`S${i}`, "red", [1])));
    expect(attr(many.querySelector("rect")!, "width")).toBe("2");
  });

  it("labels the axis and totals each series in the legend", () => {
    const c = box();
    renderProgressGraph(c, [series("Added", "red", [2, 0, 4])]);
    expect(Array.from(c.querySelectorAll("text")).map((t) => t.textContent)).toEqual(["b0", "b1", "b2"]);
    expect(c.querySelector(".cci-progress-legend-item")!.textContent).toBe("Added (6)");
  });
});

describe("the opening balance when the window starts in a week that began on a Sunday", () => {
  it("counts only what is before that week's Monday", () => {
    vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z")); // a Sunday
    // one week window: from Monday 5 Oct 00:00 UTC
    expect(countBeforeWindow(["2026-10-04T23:59:00.000Z", "2026-10-05T00:00:00.000Z", undefined, "nonsense"], "week", 1)).toBe(1);
  });
});

describe("renderTopicRadar", () => {
  const spoke = (label: string, values: number[], over: Partial<RadarSpoke> = {}): RadarSpoke => ({ label, values, max: 10, lowData: false, tooltip: `${label} tip`, ...over });
  const four = [spoke("North", [10, 5]), spoke("East", [5, 5]), spoke("South", [0, 5]), spoke("West", [10, 0])];
  const opts = { series: [{ label: "Known", color: "green", fill: true }, { label: "Seen", color: "blue", fill: false }] };

  it("draws nothing without spokes", () => {
    const c = box();
    c.textContent = "old";
    renderTopicRadar(c, [], opts);
    expect(c.children).toHaveLength(0);
  });

  it("a web with grid rings, axes, one polygon per series, a dot and a label per spoke", () => {
    const c = box();
    renderTopicRadar(c, four, opts);
    const svg = c.querySelector("svg")!;
    expect(attr(svg, "viewBox")).toBe(`0 0 ${RADAR_LAYOUT.width} ${RADAR_LAYOUT.height}`);
    expect(attr(svg, "role")).toBe("img");
    const polys = Array.from(svg.querySelectorAll("polygon"));
    expect(polys).toHaveLength(4 + 2); // four grid rings + two series
    expect(svg.querySelectorAll("line")).toHaveLength(4);
    expect(svg.querySelectorAll("circle")).toHaveLength(4);
    expect(svg.querySelectorAll("text")).toHaveLength(4);
    expect(polys.slice(0, 4).map((p) => attr(p, "opacity"))).toEqual(["0.15", "0.15", "0.15", "0.35"]);
  });

  it("the filled series is filled and solid, the other an outline with a dash", () => {
    const c = box();
    renderTopicRadar(c, four, opts);
    const polys = Array.from(c.querySelectorAll("polygon")).slice(4);
    const filled = polys.find((p) => attr(p, "fill") === "green")!;
    const outline = polys.find((p) => attr(p, "stroke") === "blue")!;
    expect(attr(filled, "opacity")).toBe("0.28");
    expect(filled.hasAttribute("stroke-dasharray")).toBe(false);
    expect(attr(outline, "fill")).toBe("none");
    expect(attr(outline, "stroke-dasharray")).toBe("4 2");
  });

  it("draws the series with the larger total first, so it cannot hide the smaller one", () => {
    const c = box();
    renderTopicRadar(c, [spoke("A", [1, 9]), spoke("B", [1, 9])], opts);
    const strokes = Array.from(c.querySelectorAll("polygon")).slice(4).map((p) => attr(p, "stroke"));
    expect(strokes).toEqual(["blue", "green"]);
  });

  it("a spoke with fewer values than there are series counts the missing ones as zero when ordering", () => {
    const c = box();
    renderTopicRadar(c, [spoke("A", [4]), spoke("B", [4])], opts);
    expect(c.querySelectorAll("polygon")).toHaveLength(6);
  });

  it("a value past its maximum is held at the rim, a spoke with no maximum or no value sits at the centre", () => {
    const c = box();
    renderTopicRadar(c, [spoke("A", [99], { max: 10 }), spoke("B", [5], { max: 0 }), spoke("C", [], { max: 10 })], { series: [{ label: "K", color: "green", fill: true }] });
    const dots = Array.from(c.querySelectorAll("circle")).map((d) => [Number(attr(d, "cx")), Number(attr(d, "cy"))]);
    const cx = RADAR_LAYOUT.width / 2;
    const cy = RADAR_LAYOUT.height / 2;
    expect(Math.hypot(dots[0][0] - cx, dots[0][1] - cy)).toBeCloseTo(RADAR_LAYOUT.radius, 0);
    expect(dots[1]).toEqual([cx, cy]);
    expect(dots[2]).toEqual([cx, cy]);
  });

  it("the reference ring appears for a positive value only, held within 0 to 1, with its title", () => {
    const withRef = (reference?: number, referenceLabel?: string) => {
      const c = box();
      renderTopicRadar(c, four, { ...opts, reference, referenceLabel });
      return Array.from(c.querySelectorAll("polygon")).filter((p) => p.hasAttribute("stroke-dasharray") && attr(p, "stroke") === "currentColor");
    };
    expect(withRef(undefined)).toHaveLength(0);
    expect(withRef(0)).toHaveLength(0);
    expect(withRef(0.5)).toHaveLength(1);
    expect(withRef(0.5)[0].querySelector("title")!.textContent).toBe("your average");
    expect(withRef(0.5, "class mean")[0].querySelector("title")!.textContent).toBe("class mean");
    const plain = box();
    renderTopicRadar(plain, four, opts);
    const outerRing = attr(Array.from(plain.querySelectorAll("polygon"))[3], "points"); // the 100% grid ring
    expect(attr(withRef(5)[0], "points")).toBe(outerRing); // held at the rim
  });

  it("dots belong to the first series, hollow where a topic has too little data, with the tooltip", () => {
    const c = box();
    renderTopicRadar(c, [spoke("A", [5], { lowData: true }), spoke("B", [5])], { series: [{ label: "K", color: "green", fill: true }] });
    const dots = Array.from(c.querySelectorAll("circle"));
    expect(dots.map((d) => attr(d, "fill"))).toEqual(["var(--background-secondary)", "green"]);
    expect(dots.every((d) => attr(d, "stroke") === "green")).toBe(true);
    expect(dots[0].querySelector("title")!.textContent).toBe("A tip");
  });

  it("labels sit outside the web, anchored by side, dimmed when data is low", () => {
    const c = box();
    renderTopicRadar(c, [spoke("North", [5]), spoke("East", [5]), spoke("South", [5]), spoke("West", [5], { lowData: true })], { series: [{ label: "K", color: "green", fill: true }] });
    const labels = Array.from(c.querySelectorAll("text"));
    expect(labels.map((t) => attr(t, "text-anchor"))).toEqual(["middle", "start", "middle", "end"]);
    expect(labels.map((t) => attr(t, "opacity"))).toEqual(["0.7", "0.7", "0.7", "0.35"]);
    expect(labels[0].firstChild!.textContent).toBe("North");
    expect(labels[0].querySelector("title")!.textContent).toBe("North tip");
    expect(Number(attr(labels[0], "y"))).toBeLessThan(RADAR_LAYOUT.height / 2 - RADAR_LAYOUT.radius);
  });

  it("the legend lists each series, and marks an outline series so it can be drawn hollow", () => {
    const c = box();
    renderTopicRadar(c, four, opts);
    const items = Array.from(c.querySelectorAll(".cci-progress-legend-item"));
    expect(items.map((i) => i.textContent)).toEqual(["Known", "Seen"]);
    expect(items[0].querySelector(".is-outline")).toBeNull();
    expect(items[1].querySelector(".is-outline")).toBeTruthy();
    expect((items[1].querySelector(".cci-progress-legend-swatch") as HTMLElement).style.background).toBe("blue");
  });
});
