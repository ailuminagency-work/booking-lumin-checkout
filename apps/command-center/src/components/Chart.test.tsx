import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chart } from "./Chart";

describe("Chart", () => {
  it("renders an svg with role img and the supplied aria-label", () => {
    render(
      <Chart
        variant="bar"
        labels={["Jan", "Feb", "Mar"]}
        series={[{ name: "Bookings", values: [10, 20, 30] }]}
        ariaLabel="Bar chart of bookings per month, latest 30"
      />,
    );
    const svg = screen.getByRole("img", { name: "Bar chart of bookings per month, latest 30" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelectorAll("rect").length).toBeGreaterThanOrEqual(3);
  });

  it("renders a line variant with one polyline per series", () => {
    const { container } = render(
      <Chart
        variant="line"
        labels={["Jan", "Feb"]}
        series={[
          { name: "A", values: [1, 2] },
          { name: "B", values: [3, 4] },
        ]}
        ariaLabel="Two-series line chart"
      />,
    );
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("renders a sparkline with an accessible label", () => {
    render(
      <Chart
        variant="sparkline"
        series={[{ name: "Trend", values: [1, 5, 3] }]}
        ariaLabel="Sparkline of monthly bookings"
      />,
    );
    expect(screen.getByRole("img", { name: "Sparkline of monthly bookings" })).toBeInTheDocument();
  });

  it("handles empty data without crashing and still labels the svg", () => {
    render(<Chart variant="bar" series={[]} ariaLabel="Empty chart" />);
    const svg = screen.getByRole("img", { name: "Empty chart" });
    expect(svg).toHaveTextContent("No data");

    render(<Chart variant="sparkline" series={[]} ariaLabel="Empty sparkline" />);
    expect(screen.getByRole("img", { name: "Empty sparkline" })).toBeInTheDocument();
  });
});
