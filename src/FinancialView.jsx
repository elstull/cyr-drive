import { useState, useEffect, useCallback } from 'react';

const DIM    = '#8899aa';
const BLUE   = '#4a90d9';
const GREEN  = '#4ade80';
const YELLOW = '#e8c060';
const RED    = '#ef4444';

// ── Formatters ───────────────────────────────────────────────────────────────
const fmt = (n) => {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtShort = (n) => {
  if (n == null) return '—';
  const abs = Math.abs(Number(n));
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000000) return sign + '$' + (abs / 1000000).toFixed(2) + 'M';
  if (abs >= 1000)    return sign + '$' + (abs / 1000).toFixed(1) + 'K';
  return sign + '$' + abs.toFixed(2);
};
const fmtPct = (n) => {
  if (n == null) return '—';
  return Number(n).toFixed(1) + '%';
};

// ── Status helpers ───────────────────────────────────────────────────────────
const statusColor = (s) => {
  switch ((s || '').toLowerCase()) {
    case 'paid': case 'received': case 'approved': case 'completed': return GREEN;
    case 'overdue': case 'cancelled': case 'failed':                  return RED;
    case 'sent': case 'pending': case 'confirmed':                    return YELLOW;
    default:                                                          return DIM;
  }
};
const StatusBadge = ({ status }) => (
  <span style={{
    fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
    color: statusColor(status), background: statusColor(status) + '18',
    border: '1px solid ' + statusColor(status) + '44',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  }}>{status || '—'}</span>
);

// ── Reusable building blocks ─────────────────────────────────────────────────
const SummaryCard = ({ label, value, sub, color = '#e2e8f0', accent = BLUE }) => (
  <div style={{
    background: '#111827', border: '1px solid #1e293b', borderRadius: 10,
    padding: '14px 16px', flex: 1, minWidth: 140,
    borderTop: '2px solid ' + accent,
  }}>
    <div style={{ fontSize: 10, color: DIM, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color, marginBottom: sub ? 2 : 0 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: DIM }}>{sub}</div>}
  </div>
);

const StatBox = ({ label, value, color = '#e2e8f0', highlight = false }) => (
  <div style={{
    flex: 1, minWidth: 0,
    background: highlight ? YELLOW + '14' : '#0a0e17',
    border: highlight ? '1px solid ' + YELLOW + '44' : '1px solid transparent',
    borderRadius: 6, padding: '8px 10px',
  }}>
    <div style={{ fontSize: 10, color: '#aabbcc', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
  </div>
);

const Card = ({ accentColor, children }) => (
  <div style={{
    background: '#111827', border: '1px solid #1e293b', borderRadius: 10,
    padding: '12px 14px', marginBottom: 8,
    borderLeft: accentColor ? '3px solid ' + accentColor : '1px solid #1e293b',
  }}>{children}</div>
);

const SectionLabel = ({ children }) => (
  <div style={{ fontSize: 11, color: DIM, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{children}</div>
);

const Empty = ({ msg }) => (
  <div style={{ textAlign: 'center', padding: '40px 16px', color: DIM, fontSize: 13 }}>{msg}</div>
);

// ── P&L by process ───────────────────────────────────────────────────────────
function PLView({ rows }) {
  if (!rows.length) return <Empty msg="No P&L data available." />;
  const totals = rows.reduce((acc, r) => ({
    engagements: acc.engagements + Number(r.engagements || 0),
    revenue:     acc.revenue + Number(r.revenue || 0),
    costs:       acc.costs + Number(r.costs || 0),
    gross_margin: acc.gross_margin + Number(r.gross_margin || 0),
  }), { engagements: 0, revenue: 0, costs: 0, gross_margin: 0 });
  const totalMarginPct = totals.revenue > 0 ? (totals.gross_margin / totals.revenue) * 100 : 0;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <SummaryCard label="Total Revenue"  value={fmtShort(totals.revenue)}      sub={totals.engagements + ' engagements'} accent={GREEN} color={GREEN} />
        <SummaryCard label="Total Costs"    value={fmtShort(totals.costs)}        accent={RED}   color={RED} />
        <SummaryCard label="Gross Margin"   value={fmtShort(totals.gross_margin)} sub={fmtPct(totalMarginPct) + ' overall'} accent={BLUE}  color={BLUE} />
      </div>
      <SectionLabel>P&amp;L by Process</SectionLabel>
      {rows.map((r, i) => {
        const mPct = Number(r.margin_pct || 0);
        return (
          <Card key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{r.process_type || '—'}</div>
                <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{r.engagements ?? 0} engagement{(r.engagements ?? 0) === 1 ? '' : 's'}</div>
              </div>
              <span style={{ fontSize: 12, color: BLUE, fontWeight: 700 }}>{fmtPct(mPct)} margin</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatBox label="Revenue"      value={fmtShort(r.revenue)}      color={GREEN} />
              <StatBox label="Cost"         value={fmtShort(r.costs)}        color={RED} />
              <StatBox label="Gross Margin" value={fmtShort(r.gross_margin)} color={BLUE} />
            </div>
          </Card>
        );
      })}
    </>
  );
}

// ── P&L by team member ───────────────────────────────────────────────────────
function TeamView({ rows }) {
  if (!rows.length) return <Empty msg="No team P&L data available." />;
  const totals = rows.reduce((acc, r) => ({
    engagements: acc.engagements + Number(r.engagements || 0),
    revenue:     acc.revenue + Number(r.revenue || 0),
    costs:       acc.costs + Number(r.costs || 0),
    gross_margin: acc.gross_margin + Number(r.gross_margin || 0),
  }), { engagements: 0, revenue: 0, costs: 0, gross_margin: 0 });
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <SummaryCard label="Team Revenue"  value={fmtShort(totals.revenue)}      sub={rows.length + ' members'}                accent={GREEN} color={GREEN} />
        <SummaryCard label="Team Costs"    value={fmtShort(totals.costs)}        accent={RED}   color={RED} />
        <SummaryCard label="Gross Margin"  value={fmtShort(totals.gross_margin)} sub={totals.engagements + ' engagements'}     accent={BLUE}  color={BLUE} />
      </div>
      <SectionLabel>P&amp;L by Team Member</SectionLabel>
      {rows.map((r, i) => (
        <Card key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{r.member_name || '—'}</div>
              <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{r.engagements ?? 0} engagement{(r.engagements ?? 0) === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <StatBox label="Revenue"      value={fmtShort(r.revenue)}      color={GREEN} />
            <StatBox label="Cost"         value={fmtShort(r.costs)}        color={RED} />
            <StatBox label="Gross Margin" value={fmtShort(r.gross_margin)} color={BLUE} />
          </div>
        </Card>
      ))}
    </>
  );
}

// ── Engagements / financial_summary ──────────────────────────────────────────
function EngagementsView({ rows }) {
  if (!rows.length) return <Empty msg="No engagements found." />;
  const totalRevenue   = rows.reduce((s, r) => s + Number(r.total_revenue   || 0), 0);
  const totalCollected = rows.reduce((s, r) => s + Number(r.total_collected || 0), 0);
  const totalAR        = rows.reduce((s, r) => s + Number(r.outstanding_ar  || 0), 0);
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <SummaryCard label="Total Revenue"  value={fmtShort(totalRevenue)}   sub={rows.length + ' engagements'}                                accent={GREEN}                       color={GREEN} />
        <SummaryCard label="Collected"      value={fmtShort(totalCollected)} accent={BLUE}                                                     color={BLUE} />
        <SummaryCard label="Outstanding AR" value={fmtShort(totalAR)}        sub={rows.filter(r => Number(r.outstanding_ar || 0) > 0).length + ' with balance'} accent={totalAR > 0 ? YELLOW : DIM} color={totalAR > 0 ? YELLOW : '#e2e8f0'} />
      </div>
      <SectionLabel>Engagement Details</SectionLabel>
      {rows.map((r, i) => {
        const ar = Number(r.outstanding_ar || 0);
        const arHighlight = ar > 0;
        return (
          <Card key={i} accentColor={arHighlight ? YELLOW : BLUE}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{r.process_type || '—'}</div>
                <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>
                  {r.account_lead ? 'Lead: ' + r.account_lead : 'Unassigned'}
                </div>
              </div>
              <StatusBadge status={r.current_state} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <StatBox label="Revenue"      value={fmtShort(r.total_revenue)} color={GREEN} />
              <StatBox label="Cost"         value={fmtShort(r.total_cost)}    color={RED} />
              <StatBox label="Gross Margin" value={fmtShort(r.gross_margin)}  color={BLUE} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatBox label="Invoiced"  value={fmtShort(r.total_invoiced)}  />
              <StatBox label="Collected" value={fmtShort(r.total_collected)} />
              <StatBox label="Outstanding AR" value={fmtShort(r.outstanding_ar)} color={arHighlight ? YELLOW : '#e2e8f0'} highlight={arHighlight} />
            </div>
          </Card>
        );
      })}
    </>
  );
}

// ── Cash flow / financial_events ─────────────────────────────────────────────
function CashFlowView({ rows }) {
  if (!rows.length) return <Empty msg="No financial events recorded." />;
  const totalIn  = rows.filter(r => Number(r.amount || 0) > 0).reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalOut = rows.filter(r => Number(r.amount || 0) < 0).reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
  const net = totalIn - totalOut;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <SummaryCard label="Total In"     value={fmtShort(totalIn)}  sub={rows.filter(r => Number(r.amount || 0) > 0).length + ' inflows'}  accent={GREEN}                color={GREEN} />
        <SummaryCard label="Total Out"    value={fmtShort(totalOut)} sub={rows.filter(r => Number(r.amount || 0) < 0).length + ' outflows'} accent={RED}                  color={RED} />
        <SummaryCard label="Net Position" value={fmtShort(net)}      accent={net >= 0 ? GREEN : RED}                                                                       color={net >= 0 ? GREEN : RED} />
      </div>
      <SectionLabel>Financial Events · Most Recent First</SectionLabel>
      {rows.map((r, i) => {
        const amt = Number(r.amount || 0);
        const amtColor = amt > 0 ? GREEN : amt < 0 ? RED : DIM;
        return (
          <Card key={i} accentColor={amtColor}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, color: amtColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{r.event_type || 'event'}</span>
                  {r.category && <span style={{ fontSize: 10, color: DIM }}>· {r.category}</span>}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', wordBreak: 'break-word' }}>{r.description || '—'}</div>
                {r.instance_id && (
                  <div style={{ fontSize: 10, color: '#7a8a9c', marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>{r.instance_id}</div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: amtColor, fontVariantNumeric: 'tabular-nums' }}>
                  {amt > 0 ? '+' : ''}{fmtShort(amt)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: '#aabbcc' }}>
                {r.event_date ? new Date(r.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
              </span>
              <StatusBadge status={r.status} />
            </div>
          </Card>
        );
      })}
    </>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function FinancialView({ currentUser, users, supabase }) {
  const [tab, setTab] = useState('pl');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setRows([]);
    try {
      let res;
      if (tab === 'pl') {
        res = await supabase.from('pnl_by_process').select('*');
      } else if (tab === 'team') {
        res = await supabase.from('pnl_by_team_member').select('*');
      } else if (tab === 'engagements') {
        res = await supabase.from('financial_summary').select('*');
      } else if (tab === 'cashflow') {
        res = await supabase.from('financial_events').select('*').order('event_date', { ascending: false });
      }
      if (res?.error) throw res.error;
      setRows(res?.data || []);
    } catch (e) {
      console.error('Financial load:', e);
      setError(e.message || 'Failed to load financial data.');
    }
    setLoading(false);
  }, [supabase, tab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const TABS = [
    { id: 'pl',          label: 'P&L' },
    { id: 'team',        label: 'Team' },
    { id: 'engagements', label: 'Engagements' },
    { id: 'cashflow',    label: 'Cash Flow' },
  ];

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '16px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Financials</div>
        <div style={{ fontSize: 12, color: DIM }}>P&amp;L · Team · Engagements · Cash Flow</div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, overflowX: 'auto', paddingBottom: 2 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flexShrink: 0, padding: '8px 14px', borderRadius: 8,
            background: tab === t.id ? '#111827' : 'transparent',
            border: '1px solid ' + (tab === t.id ? BLUE : '#2a3a4e'),
            color: tab === t.id ? BLUE : DIM,
            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            WebkitTapHighlightColor: 'transparent',
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={fetchData} style={{
          background: 'none', border: '1px solid #2a3a4e', borderRadius: 6,
          color: DIM, fontSize: 11, padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit',
        }}>Refresh</button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: BLUE, fontSize: 13 }}>Loading financial data...</div>}
      {error && !loading && (
        <div style={{
          background: '#e0303018', border: '1px solid #e0303044', borderRadius: 8,
          padding: '12px 14px', color: '#f08080', fontSize: 12,
        }}>{error}</div>
      )}
      {!loading && !error && (
        <>
          {tab === 'pl'          && <PLView rows={rows} />}
          {tab === 'team'        && <TeamView rows={rows} />}
          {tab === 'engagements' && <EngagementsView rows={rows} />}
          {tab === 'cashflow'    && <CashFlowView rows={rows} />}
        </>
      )}
    </div>
  );
}
