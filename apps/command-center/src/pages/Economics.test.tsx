import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Economics from "./Economics";

describe("Economics page", () => {
  it("renders GMV and platform revenue as separate, clearly labelled series", () => {
    render(<Economics />);
    // Both labels present, as distinct elements — never a combined figure.
    expect(screen.getAllByText("GMV (merchant volume)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Platform revenue (Lumin)").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the explicit legend note that GMV is not Lumin revenue", () => {
    render(<Economics />);
    expect(
      screen.getByText("GMV is merchant volume, not Lumin revenue — the two are never combined."),
    ).toBeInTheDocument();
  });

  it("never renders a label conflating GMV with revenue", () => {
    const { container } = render(<Economics />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/GMV\s*\+\s*(platform\s*)?revenue/i);
    expect(text).not.toMatch(/total\s+GMV\s+and\s+revenue/i);
  });

  it("renders subscription vs transaction split and average booking value", () => {
    render(<Economics />);
    expect(screen.getByText("Average booking value")).toBeInTheDocument();
    expect(screen.getByText("Subscription revenue (12mo)")).toBeInTheDocument();
    expect(screen.getByText("Transaction revenue (12mo)")).toBeInTheDocument();
    // Pinned from the seeded dataset: average booking value is $261.92.
    expect(screen.getByText("$261.92")).toBeInTheDocument();
  });
});
