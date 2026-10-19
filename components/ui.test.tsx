import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CircleDot } from "lucide-react";
import { MetricCard } from "@/components/ui";
import CommitActivityChart from "@/components/CommitActivityChart";
import ChartPanel from "@/components/ChartPanel";

describe("MetricCard", () => {
  it("renders — for null values", () => {
    render(<MetricCard label="Contributors" value={null} icon={<CircleDot />} />);
    expect(screen.getByText("Contributors")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("formats real numbers", () => {
    render(<MetricCard label="Stars" value={1234567} icon={<CircleDot />} />);
    expect(screen.getByText("1,234,567")).toBeInTheDocument();
  });

  it("prefers display string over numeric value", () => {
    render(<MetricCard label="Latest release" value={null} icon={<CircleDot />} display="Oct 1, 2026" />);
    expect(screen.getByText("Oct 1, 2026")).toBeInTheDocument();
  });
});

describe("CommitActivityChart", () => {
  it("renders an empty-state message for empty datasets", () => {
    render(<CommitActivityChart data={[]} />);
    expect(screen.getByText(/no weekly commit data/i)).toBeInTheDocument();
  });
});

describe("ChartPanel", () => {
  it("shows pending/unavailable text for null weeks", () => {
    render(<ChartPanel weeks={null} summary={null} />);
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
  });

  it("renders a text summary with real data", () => {
    render(
      <ChartPanel
        weeks={[
          { weekStart: "2026-01-01", commits: 10 },
          { weekStart: "2026-01-08", commits: 20 },
        ]}
        summary={{
          total: 30,
          peak: { weekStart: "2026-01-08", commits: 20 },
          quiet: { weekStart: "2026-01-01", commits: 10 },
          weeks: 2,
          activeWeeks: 2,
        }}
      />,
    );
    expect(screen.getByTestId("chart-summary")).toHaveTextContent("30 commits across 2 weeks");
  });
});
