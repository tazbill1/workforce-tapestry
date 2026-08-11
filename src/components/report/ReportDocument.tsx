import type { ReactNode } from "react";
import {
  BenchmarkBarChart,
  GroupedBarChart,
  RankedBarChart,
  StackedShareBar,
} from "./charts";
import {
  DASH,
  TOKENS,
  buildMetricBook,
  fmtDate,
  fmtDeltaInt,
  fmtDeltaPp,
  fmtInt,
  fmtNum,
  fmtPct,
  periodLabel,
  periodShort,
  scopeLabel,
} from "@/lib/report-core";
import type { ReportData } from "@/lib/report-load";

/**
 * The report template. Every number below is a lookup against `published_metrics`; the only
 * arithmetic performed here is the period-over-period delta in comparison columns, which is a
 * presentation of two stored values rather than a metric. Missing values render as an em dash.
 */

export const SECTIONS = [
  { id: "cover", label: "Cover" },
  { id: "summary", label: "Executive summary" },
  { id: "headcount", label: "Headcount and composition" },
  { id: "turnover", label: "Turnover" },
  { id: "benchmark", label: "Turnover against benchmark" },
  { id: "departures", label: "Departures" },
  { id: "tenure", label: "Tenure" },
  { id: "participation", label: "Participation" },
  { id: "mood", label: "Mood" },
  { id: "watchlist", label: "Didn't check in" },
  { id: "lowmood", label: "Checked in, low mood" },
  { id: "recognition", label: "Recognition and engagement" },
  { id: "people", label: "Anniversaries and new starters" },
  { id: "action", label: "Action plan" },
  { id: "method", label: "Method and definitions" },
] as const;

function Page({
  id,
  title,
  client,
  period,
  children,
  cover = false,
}: {
  id: string;
  title: string;
  client: string;
  period: string;
  children: ReactNode;
  cover?: boolean;
}) {
  return (
    <section className="rp-page" id={`rp-${id}`} data-section={id}>
      {!cover ? (
        <div className="rp-runhead">WerkandMe · Team Culture &amp; Tenure Report</div>
      ) : null}
      <div className="rp-body">{children}</div>
      {!cover ? (
        <div className="rp-runfoot">
          <span>WerkandMe · Culture Report</span>
          <span>
            Page <span className="rp-pageno" />
          </span>
        </div>
      ) : null}
    </section>
  );
}

function Cards({
  cols,
  items,
}: {
  cols: 3 | 4;
  items: { label: string; value: string; caption?: string }[];
}) {
  return (
    <div className="rp-cards" data-cols={cols}>
      {items.map((item) => (
        <div className="rp-card" key={item.label}>
          <p className="rp-card-label">{item.label}</p>
          <span className="rp-card-value">{item.value}</span>
          <span className="rp-card-caption">{item.caption ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

/** Fixed-height list block: rows beyond the page allowance are summarised, never clipped. */
function Overflow({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  if (total <= shown) return null;
  return (
    <p className="rp-table-note">
      Showing {shown} of {total} {noun}. The full list is available in the workspace.
    </p>
  );
}

export function ReportDocument({ data }: { data: ReportData }) {
  const m = buildMetricBook(data.metrics, data.period, data.priorPeriod);
  const clientName = data.client.name;
  const period = periodLabel(data.period);
  const prior = periodShort(data.priorPeriod);
  const now = periodShort(data.period);
  const page = { client: clientName, period };

  const franchises = m.scopesFor("headcount_active", "franchise:");
  const roles = m.scopesFor("headcount_active", "role:");
  const depts = m.scopesFor("recognitions_count", "dept:");
  const moodScopes = franchises.length > 0 ? franchises : m.scopesFor("mood_per_employee", "dept:");

  const activeTotal = m.get("headcount_active");
  const turnover = m.get("turnover_pct");
  const mood = m.get("mood_per_employee");
  const checkedIn = m.get("checked_in_count");
  const notCheckedIn = m.get("not_checked_in_count");

  return (
    <div className="rp">
      {/* 1 — Cover */}
      <Page id="cover" title="Cover" client={clientName} period={period} cover>
        <div className="rp-cover-rule" />
        <div className="rp-logos">
          <span className="rp-logo">Werk&amp;Me</span>
          <span className="rp-logo-sep" />
          <span className="rp-logo">{clientName}</span>
        </div>
        <p className="rp-eyebrow">Monthly culture report</p>
        <h1 className="rp-title">
          {clientName}
          <br />
          {period}
        </h1>
        <p className="rp-cover-sub">
          Headcount, turnover, tenure, participation and mood, measured against the prior period.
        </p>
        <div className="rp-meta">
          <div>
            <p className="rp-meta-label">Period</p>
            <p className="rp-meta-value">{period}</p>
          </div>
          <div>
            <p className="rp-meta-label">Compared with</p>
            <p className="rp-meta-value">{periodLabel(data.priorPeriod)}</p>
          </div>
          <div>
            <p className="rp-meta-label">People in scope</p>
            <p className="rp-meta-value">{fmtInt(m.get("roster_size"))}</p>
          </div>
        </div>
      </Page>

      {/* 2 — Executive summary */}
      <Page id="summary" title="Executive summary" {...page}>
        <p className="rp-eyebrow">Executive summary</p>
        <h2 className="rp-title" style={{ fontSize: "17pt", marginBottom: "12pt" }}>
          {period} at a glance
        </h2>
        <Cards
          cols={4}
          items={[
            {
              label: "Active headcount",
              value: fmtInt(activeTotal),
              caption: `${fmtDeltaInt(activeTotal, m.prior("headcount_active"))} vs ${prior}`,
            },
            {
              label: "Turnover",
              value: fmtPct(turnover),
              caption: `${fmtDeltaPp(turnover, m.prior("turnover_pct"))} pp vs ${prior}`,
            },
            {
              label: "Average tenure",
              value: mNum(m.get("avg_tenure_years")),
              caption: "years, dated leavers only",
            },
            {
              label: "Mood per employee",
              value: mNum(mood, 2),
              caption: `${fmtDeltaPp(mood, m.prior("mood_per_employee"))} vs ${prior}`,
            },
          ]}
        />
        <Cards
          cols={4}
          items={[
            {
              label: "Checked in",
              value: fmtInt(checkedIn),
              caption: `${fmtPct(m.get("checked_in_pct"))} of active headcount`,
            },
            {
              label: "Not checked in",
              value: fmtInt(notCheckedIn),
              caption: "active people with no check-in",
            },
            {
              label: "Departures",
              value: fmtInt(m.get("departures_count")),
              caption: `${fmtInt(m.get("departures_after_period_end"))} dated after period end`,
            },
            {
              label: "Early departures",
              value: fmtPct(m.get("early_departure_pct")),
              caption: `of ${fmtInt(m.get("datable_departures"))} dated leavers`,
            },
          ]}
        />
        <div className="rp-two-col" style={{ marginTop: "4pt" }}>
          <div>
            <p className="rp-subheading">What the numbers say</p>
            <ul className="rp-bullets">
              <li>
                Turnover is {fmtPct(turnover)} against {fmtPct(m.prior("turnover_pct"))} last
                period, a change of {fmtDeltaPp(turnover, m.prior("turnover_pct"))} percentage
                points.
              </li>
              <li>
                {fmtInt(checkedIn)} of {fmtInt(activeTotal)} active people checked in, leaving{" "}
                {fmtInt(notCheckedIn)} without a signal this month.
              </li>
              <li>
                Mood per check-in reads {mNum(m.get("mood_per_checkin"), 2)} against{" "}
                {mNum(m.get("mood_per_employee"), 2)} per employee, both on active headcount at
                period end.
              </li>
            </ul>
          </div>
          <div>
            <p className="rp-subheading">Scope of this report</p>
            <ul className="rp-bullets">
              <li>
                {fmtInt(m.get("roster_size"))} people on the roster after{" "}
                {fmtInt(m.get("excluded_count"))} confirmed exclusions.
              </li>
              <li>
                Invited people count towards headcount only; they are outside every ratio in this
                report.
              </li>
              <li>
                {fmtInt(m.get("undated_inactive_count"))} inactive records carry no usable
                departure date and are excluded from tenure and early-departure figures.
              </li>
            </ul>
          </div>
        </div>
      </Page>

      {/* 3 — Headcount */}
      <Page id="headcount" title="Headcount and composition" {...page}>
        <h2 className="rp-heading">Headcount and composition</h2>
        <div className="rp-chart">
          <GroupedBarChart
            height={300}
            categories={franchises.map(scopeLabel)}
            series={[
              { name: prior, color: TOKENS.priorBar },
              { name: now, color: TOKENS.blue },
            ]}
            values={franchises.map((scope) => [
              m.prior("headcount_active", scope),
              m.get("headcount_active", scope),
            ])}
            axisLabel="Active headcount by franchise"
          />
        </div>
        <table className="rp-table" style={{ marginTop: "8pt" }}>
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Franchise</th>
              <th className="rp-num">Active</th>
              <th className="rp-num">Inactive</th>
              <th className="rp-num">Invited</th>
              <th className="rp-num">Turnover</th>
              <th className="rp-num">Active vs {prior}</th>
            </tr>
          </thead>
          <tbody>
            {franchises.map((scope) => (
              <tr key={scope}>
                <td>{scopeLabel(scope)}</td>
                <td className="rp-num">{fmtInt(m.get("headcount_active", scope))}</td>
                <td className="rp-num">{fmtInt(m.get("headcount_inactive", scope))}</td>
                <td className="rp-num">{fmtInt(m.get("headcount_invited", scope))}</td>
                <td className="rp-num">{fmtPct(m.get("turnover_pct", scope))}</td>
                <td className="rp-num">
                  {fmtDeltaInt(m.get("headcount_active", scope), m.prior("headcount_active", scope))}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td>Company</td>
              <td className="rp-num">{fmtInt(activeTotal)}</td>
              <td className="rp-num">{fmtInt(m.get("headcount_inactive"))}</td>
              <td className="rp-num">{fmtInt(m.get("headcount_invited"))}</td>
              <td className="rp-num">{fmtPct(turnover)}</td>
              <td className="rp-num">{fmtDeltaInt(activeTotal, m.prior("headcount_active"))}</td>
            </tr>
          </tbody>
        </table>
        <p className="rp-footnote">
          Invited people are counted in headcount and excluded from turnover, tenure and mood.
        </p>
      </Page>

      {/* 4 — Turnover */}
      <Page id="turnover" title="Turnover" {...page}>
        <h2 className="rp-heading">Turnover by role</h2>
        <div className="rp-chart">
          <GroupedBarChart
            height={288}
            categories={roles.map(scopeLabel)}
            series={[
              { name: prior, color: TOKENS.priorBar },
              { name: now, color: TOKENS.blue },
            ]}
            values={roles.map((scope) => [
              m.prior("turnover_pct", scope),
              m.get("turnover_pct", scope),
            ])}
            format={(n) => `${n.toFixed(0)}%`}
            axisLabel="Turnover, prior period against this period"
          />
        </div>
        <div className="rp-two-col" style={{ marginTop: "8pt" }}>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Role</th>
                <th className="rp-num">Active</th>
                <th className="rp-num">Inactive</th>
                <th className="rp-num">Turnover</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((scope) => (
                <tr key={scope}>
                  <td>{scopeLabel(scope)}</td>
                  <td className="rp-num">{fmtInt(m.get("headcount_active", scope))}</td>
                  <td className="rp-num">{fmtInt(m.get("headcount_inactive", scope))}</td>
                  <td className="rp-num">{fmtPct(m.get("turnover_pct", scope))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <p className="rp-subheading">Cohorts</p>
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Cohort</th>
                  <th className="rp-num">This period</th>
                  <th className="rp-num">{prior}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Recent hires (under 1 year)</td>
                  <td className="rp-num">{fmtPct(m.get("recent_hire_turnover_pct"))}</td>
                  <td className="rp-num">{fmtPct(m.prior("recent_hire_turnover_pct"))}</td>
                </tr>
                <tr>
                  <td>Tenured (1 year and over)</td>
                  <td className="rp-num">{fmtPct(m.get("tenured_turnover_pct"))}</td>
                  <td className="rp-num">{fmtPct(m.prior("tenured_turnover_pct"))}</td>
                </tr>
                <tr>
                  <td>Company</td>
                  <td className="rp-num">{fmtPct(turnover)}</td>
                  <td className="rp-num">{fmtPct(m.prior("turnover_pct"))}</td>
                </tr>
              </tbody>
            </table>
            <p className="rp-footnote">
              Turnover is inactive people over the sum of active and inactive people, invited
              excluded.
            </p>
          </div>
        </div>
      </Page>

      {/* 5 — Benchmark */}
      <Page id="benchmark" title="Turnover against benchmark" {...page}>
        <h2 className="rp-heading">Turnover against industry benchmark</h2>
        <div className="rp-chart">
          <BenchmarkBarChart
            height={300}
            data={roles.map((scope) => ({
              label: scopeLabel(scope),
              value: m.get("turnover_pct", scope),
              benchmark: m.get("role_benchmark_turnover_pct", scope),
            }))}
          />
        </div>
        <table className="rp-table" style={{ marginTop: "8pt" }}>
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Role</th>
              <th className="rp-num">Turnover</th>
              <th className="rp-num">Benchmark</th>
              <th className="rp-num">Variance (pp)</th>
              <th>Reading</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((scope) => {
              const variance = m.get("turnover_variance_pp", scope);
              const benchmark = m.get("role_benchmark_turnover_pct", scope);
              return (
                <tr key={scope}>
                  <td>{scopeLabel(scope)}</td>
                  <td className="rp-num">{fmtPct(m.get("turnover_pct", scope))}</td>
                  <td className="rp-num">{benchmark === null ? DASH : fmtPct(benchmark)}</td>
                  <td className="rp-num">
                    {variance === null ? DASH : `${variance > 0 ? "+" : ""}${variance.toFixed(1)}`}
                  </td>
                  <td>
                    {benchmark === null
                      ? "No published benchmark for this role"
                      : variance === null
                        ? DASH
                        : variance > 0
                          ? "Above benchmark"
                          : "At or below benchmark"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="rp-footnote">
          Benchmarks are published industry figures held in the workspace; roles without a
          published benchmark are shown without a comparison rather than against a substitute.
        </p>
      </Page>

      {/* 6 — Departures */}
      <Page id="departures" title="Departures" {...page}>
        <h2 className="rp-heading">Departures this period</h2>
        <Cards
          cols={4}
          items={[
            { label: "Departures", value: fmtInt(m.get("departures_count")), caption: "people active last period, inactive now" },
            { label: "Dated in period", value: fmtInt(m.get("departures_in_period")) },
            { label: "Dated after period end", value: fmtInt(m.get("departures_after_period_end")) },
            { label: "No usable date", value: fmtInt(m.get("undated_inactive_count")) },
          ]}
        />
        <table className="rp-table rp-tight">
          <thead>
            <tr>
              <th style={{ width: "22%" }}>Name</th>
              <th style={{ width: "20%" }}>Department</th>
              <th style={{ width: "12%" }}>Role</th>
              <th style={{ width: "13%" }}>Hired</th>
              <th style={{ width: "13%" }}>Departed</th>
              <th className="rp-num" style={{ width: "10%" }}>Tenure</th>
              <th style={{ width: "10%" }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {data.lists.departures.slice(0, 14).map((row) => (
              <tr key={row.email} className={row.on_watch_list ? "rp-row-highlight" : undefined}>
                <td>{row.name}</td>
                <td>{row.department ?? DASH}</td>
                <td>{row.role ?? DASH}</td>
                <td>{fmtDate(row.hire_date)}</td>
                <td>{fmtDate(row.departure_date)}</td>
                <td className="rp-num">{fmtNum(row.tenure_years, 1)}</td>
                <td>{row.after_period_end ? "After period end" : row.on_watch_list ? "Was on watch list" : ""}</td>
              </tr>
            ))}
            {data.lists.departures.length === 0 ? (
              <tr>
                <td colSpan={7}>No departures recorded for this period.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <Overflow shown={Math.min(14, data.lists.departures.length)} total={data.lists.departures.length} noun="departures" />
        <p className="rp-footnote">
          Shaded rows were on last month&apos;s watch list. Departure dates are a proxy taken from
          the last modification of an inactive record.
        </p>
      </Page>

      {/* 7 — Tenure */}
      <Page id="tenure" title="Tenure" {...page}>
        <h2 className="rp-heading">Tenure</h2>
        <Cards
          cols={4}
          items={[
            { label: "Average tenure", value: mNum(m.get("avg_tenure_years")), caption: "years" },
            { label: "Rows in calculation", value: fmtInt(m.get("tenure_rows_included")) },
            { label: "Dropped, negative result", value: fmtInt(m.get("tenure_dropped_negative")), caption: "departure earlier than hire" },
            { label: "Dropped, no usable date", value: fmtInt(m.get("tenure_dropped_undated")) },
          ]}
        />
        <div className="rp-chart">
          <RankedBarChart
            height={230}
            data={franchises.map((scope) => ({
              label: scopeLabel(scope),
              value: m.get("avg_tenure_years", scope),
            }))}
            average={m.get("avg_tenure_years")}
            averageLabel={`Company ${fmtNum(m.get("avg_tenure_years"), 2)}`}
            format={(n) => n.toFixed(2)}
            color={TOKENS.cyan}
          />
        </div>
        <table className="rp-table" style={{ marginTop: "6pt" }}>
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Role</th>
              <th className="rp-num">Average tenure (years)</th>
              <th className="rp-num">Rows included</th>
              <th className="rp-num">Dropped</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((scope) => {
              const negative = m.get("tenure_dropped_negative", scope) ?? 0;
              const undated = m.get("tenure_dropped_undated", scope) ?? 0;
              return (
                <tr key={scope}>
                  <td>{scopeLabel(scope)}</td>
                  <td className="rp-num">{fmtNum(m.get("avg_tenure_years", scope), 2)}</td>
                  <td className="rp-num">{fmtInt(m.get("tenure_rows_included", scope))}</td>
                  <td className="rp-num">{fmtInt(negative + undated)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="rp-footnote">
          Tenure uses dated records only. Rows with a departure proxy earlier than the hire date
          are dropped rather than clamped, so the figure never borrows an impossible value.
        </p>
      </Page>

      {/* 8 — Participation */}
      <Page id="participation" title="Participation" {...page}>
        <h2 className="rp-heading">Participation</h2>
        <div className="rp-chart">
          <StackedShareBar
            total={activeTotal}
            segments={[
              { label: "Checked in", value: checkedIn, color: TOKENS.blue },
              { label: "No check-in", value: notCheckedIn, color: TOKENS.priorBar },
            ]}
          />
        </div>
        <Cards
          cols={4}
          items={[
            { label: "Participation", value: fmtPct(m.get("checked_in_pct")), caption: `${fmtDeltaPp(m.get("checked_in_pct"), m.prior("checked_in_pct"))} pp vs ${prior}` },
            { label: "Checked in", value: fmtInt(checkedIn) },
            { label: "No check-in", value: fmtInt(notCheckedIn) },
            { label: "Active headcount", value: fmtInt(activeTotal) },
          ]}
        />
        <div className="rp-chart">
          <RankedBarChart
            height={220}
            data={franchises.map((scope) => ({
              label: scopeLabel(scope),
              value: m.get("checked_in_pct", scope),
            }))}
            average={m.get("checked_in_pct")}
            averageLabel={`Company ${fmtPct(m.get("checked_in_pct"))}`}
            format={(n) => `${n.toFixed(1)}%`}
            domainMax={100}
          />
        </div>
        <p className="rp-footnote">
          Participation is active people with at least one check-in over active headcount at
          period end.
        </p>
      </Page>

      {/* 9 — Mood */}
      <Page id="mood" title="Mood" {...page}>
        <h2 className="rp-heading">Mood</h2>
        <Cards
          cols={3}
          items={[
            { label: "Mood per employee", value: mNum(mood, 2), caption: `${fmtDeltaPp(mood, m.prior("mood_per_employee"))} vs ${prior}` },
            { label: "Mood per check-in", value: mNum(m.get("mood_per_checkin"), 2), caption: `${fmtDeltaPp(m.get("mood_per_checkin"), m.prior("mood_per_checkin"))} vs ${prior}` },
            { label: "Active headcount in denominator", value: fmtInt(activeTotal) },
          ]}
        />
        <div className="rp-chart">
          <RankedBarChart
            height={230}
            data={moodScopes.map((scope) => ({
              label: scopeLabel(scope),
              value: m.get("mood_per_employee", scope),
            }))}
            average={mood}
            averageLabel={`Company ${fmtNum(mood, 2)}`}
            format={(n) => n.toFixed(2)}
            color={TOKENS.cyan}
            domainMax={100}
          />
        </div>
        <table className="rp-table" style={{ marginTop: "6pt" }}>
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Franchise</th>
              <th className="rp-num">Mood per employee</th>
              <th className="rp-num">Mood per check-in</th>
              <th className="rp-num">{prior} per employee</th>
              <th className="rp-num">Change</th>
            </tr>
          </thead>
          <tbody>
            {moodScopes.map((scope) => (
              <tr key={scope}>
                <td>{scopeLabel(scope)}</td>
                <td className="rp-num">{fmtNum(m.get("mood_per_employee", scope), 2)}</td>
                <td className="rp-num">{fmtNum(m.get("mood_per_checkin", scope), 2)}</td>
                <td className="rp-num">{fmtNum(m.prior("mood_per_employee", scope), 2)}</td>
                <td className="rp-num">
                  {fmtDeltaPp(m.get("mood_per_employee", scope), m.prior("mood_per_employee", scope))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rp-footnote">
          Both mood metrics use active headcount at period end as the denominator, so people who
          checked in and then left do not inflate the figure.
        </p>
      </Page>

      {/* 10 — Watch list */}
      <Page id="watchlist" title="Didn't check in" {...page}>
        <h2 className="rp-heading">Didn&apos;t check in ({fmtInt(notCheckedIn)})</h2>
        <p className="rp-lede">
          Active people with no check-in this period. Shaded rows sat below the mood threshold of{" "}
          {data.lists.moodThreshold} last period.
        </p>
        <div className="rp-two-col">
          {[0, 1].map((col) => {
            const half = Math.ceil(data.lists.notCheckedIn.length / 2);
            const rows = data.lists.notCheckedIn.slice(col * half, col * half + half);
            return (
              <table className="rp-table rp-tight" key={col}>
                <thead>
                  <tr>
                    <th style={{ width: "44%" }}>Name</th>
                    <th>Department</th>
                    <th className="rp-num" style={{ width: "24%" }}>
                      {prior} mood
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.email} className={row.highlight ? "rp-row-highlight" : undefined}>
                      <td>{row.name}</td>
                      <td>{row.department ?? DASH}</td>
                      <td className="rp-num">{fmtNum(row.mood, 1)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={3}>Everyone active checked in this period.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            );
          })}
        </div>
        <p className="rp-footnote">
          People with no check-in have no mood this period; the mood column shows last
          period&apos;s figure where one exists.
        </p>
      </Page>

      {/* 11 — Checked in, mood below threshold */}
      <Page id="lowmood" title="Checked in, mood below threshold" {...page}>
        <h2 className="rp-heading">
          Checked in, mood below {data.lists.moodThreshold} ({data.lists.lowMood.length})
        </h2>
        <p className="rp-lede">
          Active people who checked in but whose average mood for the period sits below the
          threshold.
        </p>
        <div className="rp-two-col">
          {[0, 1].map((col) => {
            const half = Math.ceil(data.lists.lowMood.length / 2);
            const rows = data.lists.lowMood.slice(col * half, col * half + half);
            return (
              <table className="rp-table rp-tight" key={col}>
                <thead>
                  <tr>
                    <th style={{ width: "42%" }}>Name</th>
                    <th>Department</th>
                    <th className="rp-num" style={{ width: "16%" }}>
                      Mood
                    </th>
                    <th className="rp-num" style={{ width: "18%" }}>
                      Check-ins
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.email} className="rp-row-highlight">
                      <td>{row.name}</td>
                      <td>{row.department ?? DASH}</td>
                      <td className="rp-num">{fmtNum(row.mood, 1)}</td>
                      <td className="rp-num">{fmtInt(row.checkins)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        No active person recorded an average mood below the threshold.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            );
          })}
        </div>
      </Page>

      {/* 11 — Recognition and engagement */}
      <Page id="recognition" title="Recognition and engagement" {...page}>
        <h2 className="rp-heading">Recognition and engagement</h2>
        <Cards
          cols={4}
          items={[
            { label: "Recognitions", value: fmtInt(m.get("engagement_recognitions")), caption: `${fmtDeltaInt(m.get("engagement_recognitions"), m.prior("engagement_recognitions"))} vs ${prior}` },
            { label: "Logins", value: fmtInt(m.get("engagement_logins")) },
            { label: "Likes", value: fmtInt(m.get("engagement_likes")) },
            { label: "Comments", value: fmtInt(m.get("engagement_comments")) },
          ]}
        />
        <div className="rp-two-col">
          <div className="rp-chart">
            <RankedBarChart
              height={400}
              data={depts.map((scope) => ({
                label: scopeLabel(scope),
                value: m.get("recognitions_count", scope),
              }))}
              format={(n) => String(Math.round(n))}
              color={TOKENS.lime}
            />
            <p className="rp-footnote">Recognitions by department, as entered for this period.</p>
          </div>

          <div>
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Engagement</th>
                  <th className="rp-num">This period</th>
                  <th className="rp-num">{prior}</th>
                  <th className="rp-num">Change</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Logins", "engagement_logins"],
                  ["Likes", "engagement_likes"],
                  ["Comments", "engagement_comments"],
                  ["Recognitions", "engagement_recognitions"],
                ].map(([label, key]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td className="rp-num">{fmtInt(m.get(key!))}</td>
                    <td className="rp-num">{fmtInt(m.prior(key!))}</td>
                    <td className="rp-num">{fmtDeltaInt(m.get(key!), m.prior(key!))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="rp-footnote">
              Engagement totals are entered manually from the platform export and stored as
              published metrics; the report reads them without adjustment.
            </p>
            <p className="rp-subheading" style={{ marginTop: "10pt" }}>
              Recognitions per active employee
            </p>
            <table className="rp-table rp-tight">
              <thead>
                <tr>
                  <th>Department</th>
                  <th className="rp-num">Recognitions</th>
                  <th className="rp-num">Per employee</th>
                </tr>
              </thead>
              <tbody>
                {depts.map((scope) => (
                  <tr key={scope}>
                    <td>{scopeLabel(scope)}</td>
                    <td className="rp-num">{fmtInt(m.get("recognitions_count", scope))}</td>
                    <td className="rp-num">
                      {fmtNum(m.get("recognitions_per_employee", scope), 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          </div>
        </div>
      </Page>

      {/* 12 — Anniversaries and new starters */}
      <Page id="people" title="Anniversaries and new starters" {...page}>
        <h2 className="rp-heading">Anniversaries and new starters</h2>
        <div className="rp-two-col">
          <div>
            <p className="rp-subheading">Work anniversaries this month ({data.lists.anniversaries.length})</p>
            <table className="rp-table rp-tight">
              <thead>
                <tr>
                  <th style={{ width: "40%" }}>Name</th>
                  <th>Department</th>
                  <th className="rp-num" style={{ width: "16%" }}>Years</th>
                </tr>
              </thead>
              <tbody>
                {data.lists.anniversaries.slice(0, 18).map((row) => (
                  <tr key={`${row.name}-${row.hire_date}`} className={row.milestone ? "rp-row-highlight" : undefined}>
                    <td>{row.name}</td>
                    <td>{row.department ?? DASH}</td>
                    <td className="rp-num">{row.years}</td>
                  </tr>
                ))}
                {data.lists.anniversaries.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No anniversaries fall in this month.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <Overflow shown={Math.min(18, data.lists.anniversaries.length)} total={data.lists.anniversaries.length} noun="anniversaries" />
          </div>
          <div>
            <p className="rp-subheading">New starters ({data.lists.newStarters.length})</p>
            <table className="rp-table rp-tight">
              <thead>
                <tr>
                  <th style={{ width: "36%" }}>Name</th>
                  <th>Department</th>
                  <th style={{ width: "24%" }}>Started</th>
                </tr>
              </thead>
              <tbody>
                {data.lists.newStarters.slice(0, 18).map((row) => (
                  <tr key={`${row.name}-${row.hire_date}`}>
                    <td>{row.name}</td>
                    <td>{row.department ?? DASH}</td>
                    <td>{fmtDate(row.hire_date)}</td>
                  </tr>
                ))}
                {data.lists.newStarters.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No new starters recorded in this period.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <Overflow shown={Math.min(18, data.lists.newStarters.length)} total={data.lists.newStarters.length} noun="starters" />
          </div>
        </div>
        <p className="rp-footnote">
          Shaded anniversaries are milestone years. Both lists cover active people only.
        </p>
      </Page>

      {/* 13 — Action plan, one page per item */}
      {(data.actionPlan.length > 0
        ? data.actionPlan
        : [{ id: "placeholder", position: 1, headline: "", problem: "", solution: "" }]
      ).map((item, index) => (
        <Page
          key={item.id}
          id={index === 0 ? "action" : `action-${index}`}
          title="Action plan"
          {...page}
        >
          <span className="rp-action-number">
            Action plan · item {item.position ?? index + 1}
          </span>
          <h2 className="rp-heading" style={{ marginTop: "6pt", fontSize: "16pt", minHeight: "24pt" }}>
            {item.headline || "\u00A0"}
          </h2>
          <div className="rp-action-block">
            <p className="rp-action-label">Problem</p>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{item.problem || "\u00A0"}</p>
          </div>
          <div className="rp-action-block">
            <p className="rp-action-label">Solution</p>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{item.solution || "\u00A0"}</p>
          </div>
          <p className="rp-footnote">
            Action plan content is authored in the workspace for this client and period; empty
            blocks print at fixed height so the page count never moves.
          </p>
        </Page>
      ))}

      {/* 14 — Method */}
      <Page id="method" title="Method and definitions" {...page}>
        <h2 className="rp-heading">Method and definitions</h2>
        <p className="rp-lede">
          Every figure in this report is read from the published metrics for {clientName},{" "}
          {period}. The template performs no calculation. The definition version behind each
          figure is listed below; restatements are published under a new version and older
          versions are retained.
        </p>
        <table className="rp-table rp-tight">
          <thead>
            <tr>
              <th style={{ width: "26%" }}>Metric</th>
              <th className="rp-num" style={{ width: "10%" }}>Version</th>
              <th>Definition as applied</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Headcount", "headcount_active", "Active, inactive and invited people at period end, exclusions removed."],
              ["Turnover", "turnover_pct", "Inactive over active plus inactive. Invited people are outside the ratio."],
              ["Average tenure", "avg_tenure_years", "Years between hire date and departure proxy. Undated and negative results are dropped."],
              ["Departures", "departures_count", "People active in the prior period and inactive now, split by date in or after the period."],
              ["Early departure", "early_departure_pct", "Departures inside the first year over dated departures only."],
              ["Mood per employee", "mood_per_employee", "Sum of mood over active headcount at period end."],
              ["Mood per check-in", "mood_per_checkin", "Sum of mood over check-ins by people active at period end."],
              ["Participation", "checked_in_pct", "Active people with at least one check-in over active headcount."],
              ["Recognitions", "engagement_recognitions", "Manual entry from the platform export for the period."],
              ["Benchmark variance", "turnover_variance_pp", "Role turnover minus the published industry benchmark, in percentage points."],
            ].map(([label, key, text]) => (
              <tr key={key}>
                <td>{label}</td>
                <td className="rp-num">{m.version(key!) ?? DASH}</td>
                <td>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rp-footnote">
          Roster of {fmtInt(m.get("roster_size"))} people after {fmtInt(m.get("excluded_count"))}{" "}
          confirmed exclusions. Where a value is unavailable the report prints an em dash rather
          than a substitute.
        </p>
      </Page>
    </div>
  );
}

const mNum = (value: number | null, digits = 2) => fmtNum(value, digits);
