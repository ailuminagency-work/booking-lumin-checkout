import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResourcesPage } from "../pages/Resources";

afterEach(cleanup);

/** resources wiring: availability is derived from @lumin/resources over the
 *  mock reservation picture (crew 2/3, bay fully booked, van free). */
describe("Resources view", () => {
  it("shows resource-derived availability for the sample slot", () => {
    render(<ResourcesPage />);
    expect(screen.getByTestId("avail-res-crew-a")).toHaveTextContent("2/3");
    expect(screen.getByTestId("avail-res-bay-1")).toHaveTextContent("0/1");
    expect(screen.getByTestId("avail-res-van-1")).toHaveTextContent("1/1");
  });
});
