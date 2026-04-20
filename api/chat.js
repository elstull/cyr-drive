// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED CHAT API — v4.0.0
//
// Vercel serverless function. Lives in the golden repo.
// One push deploys to ALL instances automatically.
// Replaces per-instance Supabase Edge Function deployments.
//
// Each Vercel project has its own env vars:
//   SUPABASE_URL (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY
//   ANTHROPIC_API_KEY
//
// The code is IDENTICAL across instances. The data makes each one unique.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

// Opus 4.7 pricing: $5/M input, $25/M output tokens
const INPUT_COST_PER_TOKEN = 5.0 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 25.0 / 1_000_000;
const MODEL = 'claude-opus-4-7';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, history, userId, userName } = req.body;
    const user = userName || userId;

    // Connect to this instance's Supabase
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(200).json({ reply: "Database connection not configured. Please contact your administrator." });
    }
    if (!anthropicKey) {
      return res.status(200).json({ reply: "AI service not configured. Please contact your administrator." });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── RBAC: resolve user role ──
    const ROLE_LEVELS = { owner: 4, admin: 3, member: 2, viewer: 1 };
    let rbacRole = 'viewer';
    let rbacLevel = 1;
    if (userId) {
      try {
        const { data: userRow } = await supabase.from('fsm_users').select('rbac_role').eq('id', userId).single();
        if (userRow?.rbac_role && ROLE_LEVELS[userRow.rbac_role] !== undefined) {
          rbacRole = userRow.rbac_role;
          rbacLevel = ROLE_LEVELS[rbacRole];
        }
      } catch {}
    }

    // ── Instance config ──
    let instanceCode = "FSM", instanceName = "FSM Drive", customerName = "Customer", domainContext = "";
    try {
      const { data: config } = await supabase.from("instance_config").select("key, value");
      if (config) {
        const cfg = Object.fromEntries(config.map(c => [c.key, c.value]));
        instanceCode = cfg.instance_code || instanceCode;
        instanceName = cfg.instance_name || instanceName;
        customerName = cfg.customer_name || customerName;
        domainContext = cfg.domain_context || "";
      }
    } catch {}

    // ══════════════════════════════════════════════════════════
    // CHART INJECTION — Generate charts server-side from live data
    // ══════════════════════════════════════════════════════════
    const msgLower = message.toLowerCase();
    const wantsChart = msgLower.includes('pie') || msgLower.includes('chart')
      || (msgLower.includes('draw') && (msgLower.includes('visual') || msgLower.includes('diagram')));
    const isFinancial = msgLower.includes('expense') || msgLower.includes('cost')
      || msgLower.includes('vendor') || msgLower.includes('financial')
      || msgLower.includes('spend') || msgLower.includes('budget')
      || msgLower.includes('p&l') || msgLower.includes('pnl');

    if (wantsChart) {
      let chartReply = '';

      if (isFinancial) {
        // ── Financial / vendor / expense charts (owner only) ──
        if (rbacLevel < 4) {
          return res.status(200).json({ reply: "Financial data is restricted to owner-level access. Please contact your administrator if you need this information." });
        }
        const { data: vendors } = await supabase.from("pnl_fsm_support_by_vendor").select("*");
        const { data: lineItems } = await supabase.from("pnl_fsm_support_by_line_item").select("*");

        if (vendors && vendors.length > 0) {
          chartReply = "Here's the FSM Drive vendor cost breakdown:\n";
          chartReply += '\n```mermaid\npie title FSM Drive Costs by Vendor';
          for (const v of vendors) { chartReply += `\n    "${v.vendor}" : ${Number(v.vendor_total)}`; }
          chartReply += '\n```\n';
        }

        if (lineItems && lineItems.length > 0) {
          chartReply += '\n```mermaid\npie title FSM Drive Costs by Line Item';
          for (const li of lineItems) {
            if (Number(li.running_total) > 0) {
              chartReply += `\n    "${li.line_item}" : ${Number(li.running_total)}`;
            }
          }
          chartReply += '\n```\n';

          // Summary table
          chartReply += '\n| Vendor | Line Item | Type | YTD |\n|---|---|---|---|';
          for (const li of lineItems) {
            const type = li.usage_based ? 'variable' : `$${Number(li.current_rate)}/${li.cadence}`;
            chartReply += `\n| ${li.vendor} | ${li.line_item} | ${type} | $${Number(li.running_total).toFixed(2)} |`;
          }
          const total = lineItems.reduce((sum, li) => sum + Number(li.running_total), 0);
          chartReply += `\n| **Total** | | | **$${total.toFixed(2)}** |`;
        }

        if (!chartReply) { chartReply = 'No vendor cost data found.'; }

      } else {
        // ── Instance status charts ──
        const { data: allInstances } = await supabase.from("fsm_instances").select("status, fsm_name");
        chartReply = "Here's your FSM instance breakdown:\n";
        if (allInstances && allInstances.length > 0) {
          const statusCounts = {};
          allInstances.forEach(i => { statusCounts[i.status] = (statusCounts[i.status] || 0) + 1; });
          chartReply += '\n```mermaid\npie title FSM Instances by Status';
          for (const s of Object.keys(statusCounts)) { chartReply += `\n    "${s}" : ${statusCounts[s]}`; }
          chartReply += '\n```\n';
          const typeCounts = {};
          allInstances.forEach(i => { typeCounts[i.fsm_name] = (typeCounts[i.fsm_name] || 0) + 1; });
          chartReply += '\n```mermaid\npie title Instances by FSM Type';
          for (const t of Object.keys(typeCounts)) { chartReply += `\n    "${t}" : ${typeCounts[t]}`; }
          chartReply += '\n```\n';
          chartReply += `\n${allInstances.length} total instances across ${Object.keys(typeCounts).length} FSM types.`;
        } else { chartReply += '\nNo instances found.'; }
      }

      // Log as zero-cost (no model invoked)
      try {
        await supabase.from("api_usage_log").insert({
          instance_code: instanceCode, user_id: user,
          input_tokens: 0, output_tokens: 0, total_tokens: 0,
          model: 'server-generated', estimated_cost_usd: 0,
          message_preview: message.substring(0, 100)
        });
      } catch {}

      return res.status(200).json({ reply: chartReply });
    }

    // ══════════════════════════════════════════════════════════
    // NORMAL PATH — Build context, call Opus 4.7
    // ══════════════════════════════════════════════════════════

    // Team
    let teamContext = "No team members found.";
    try {
      const { data: team } = await supabase.from("fsm_users").select("id, name, role, email").order("name");
      if (team && team.length > 0) {
        teamContext = team.map(u => {
          const showEmail = rbacLevel >= 3 && u.email;
          return `${u.name} (${u.id}) \u2014 ${u.role}${showEmail ? ', ' + u.email : ''}`;
        }).join("\n");
      }
    } catch {}

    // FSM summary
    const { data: fsmSummary } = await supabase.rpc("get_fsm_summary");
    let fsmContext = "FSM summary not available.";
    if (fsmSummary) { fsmContext = "FSM Summary:\n" + JSON.stringify(fsmSummary, null, 2); }

    // Active instances
    let instanceContext = "";
    try {
      const { data: instances } = await supabase.from("fsm_instances")
        .select("id, fsm_name, label, current_state_name, current_state_id, status, priority, started_by, entity_type, entity_id, memory, updated_at")
        .order("updated_at", { ascending: false }).limit(50);
      if (instances && instances.length > 0) {
        instanceContext = "\n\nACTIVE INSTANCES:\n";
        for (const inst of instances) {
          instanceContext += `\n- [${inst.id}] ${inst.label || inst.fsm_name}`;
          instanceContext += `\n  FSM: ${inst.fsm_name} | State: ${inst.current_state_name} | Status: ${inst.status} | Priority: ${inst.priority || 'normal'}`;
          instanceContext += `\n  Lead: ${inst.started_by} | Entity: ${inst.entity_type}/${inst.entity_id}`;
          if (inst.memory && Object.keys(inst.memory).length > 0) {
            instanceContext += `\n  Data: ${JSON.stringify(inst.memory)}`;
          }
        }
      }
    } catch {}

    // Recent transitions
    let transitionContext = "";
    try {
      const { data: transitions } = await supabase.from("instance_transitions")
        .select("instance_id, from_state_name, to_state_name, transition_label, triggered_by, fired_at")
        .order("fired_at", { ascending: false }).limit(50);
      if (transitions && transitions.length > 0) {
        transitionContext = "\n\nRECENT TRANSITIONS:\n";
        for (const t of transitions) {
          transitionContext += `  ${t.instance_id}: ${t.from_state_name || '?'} \u2192 ${t.to_state_name || '?'} by ${t.triggered_by} at ${t.fired_at}`;
          if (t.transition_label) transitionContext += ` (${t.transition_label})`;
          transitionContext += "\n";
        }
      }
    } catch {}

    // Pending advisories
    let advisoryContext = "";
    if (user) {
      try {
        const { data: pa } = await supabase.from("pending_advisories").select("*").eq("recipient", user);
        if (pa && pa.length > 0) {
          advisoryContext = `\n\nPENDING ADVISORIES FOR ${user}:`;
          pa.filter(a => a.urgency === "critical").forEach(a => { advisoryContext += `\nCRITICAL: ${a.title}`; });
          pa.filter(a => a.urgency === "priority").forEach(a => { advisoryContext += `\nPRIORITY: ${a.title}`; });
          pa.filter(a => a.urgency === "routine").forEach(a => { advisoryContext += `\nROUTINE: ${a.title}`; });
        }
      } catch {}
    }

    // Resources
    let resourceContext = "";
    try {
      const { data: dbSize } = await supabase.rpc("get_database_size");
      const { data: uc } = await supabase.from("fsm_users").select("id", { count: "exact" });
      resourceContext = `\nResources: DB ${dbSize || '?'}, Team ${uc?.length || 0}/10`;
    } catch {}

    // Financial summary (Living P&L) — owner only
    let financialContext = "";
    if (rbacLevel < 4) {
      financialContext = "";
    } else try {
      const { data: pnlProcess } = await supabase.from("pnl_by_process").select("*");
      if (pnlProcess && pnlProcess.length > 0) {
        financialContext = "\n\nFINANCIAL SUMMARY (Living P&L):";
        for (const p of pnlProcess) {
          financialContext += `\n  ${p.process_type}: ${p.engagements} engagements, Revenue $${Number(p.revenue).toLocaleString()}, Costs $${Number(p.costs).toLocaleString()}, Margin $${Number(p.gross_margin).toLocaleString()} (${p.margin_pct}%)`;
        }
      }
      const { data: pnlTeam } = await supabase.from("pnl_by_team_member").select("*");
      if (pnlTeam && pnlTeam.length > 0) {
        financialContext += "\n\nFINANCIAL BY TEAM MEMBER:";
        for (const p of pnlTeam) {
          financialContext += `\n  ${p.member_name}: ${p.engagements} engagements, Revenue $${Number(p.revenue).toLocaleString()}, Margin $${Number(p.gross_margin).toLocaleString()}`;
        }
      }
      const { data: engFin } = await supabase.from("financial_summary").select("*");
      if (engFin && engFin.length > 0) {
        financialContext += "\n\nENGAGEMENT-LEVEL FINANCIALS:";
        for (const e of engFin) {
          financialContext += `\n  ${e.engagement} (${e.current_state}, lead: ${e.account_lead})`;
          financialContext += `\n    Revenue: $${Number(e.total_revenue).toLocaleString()} | Costs: $${Number(e.total_cost).toLocaleString()} | Margin: $${Number(e.gross_margin).toLocaleString()}`;
          financialContext += `\n    Invoiced: $${Number(e.total_invoiced).toLocaleString()} | Collected: $${Number(e.total_collected).toLocaleString()} | Outstanding AR: $${Number(e.outstanding_ar).toLocaleString()}`;
        }
      }
    } catch {}

    // Vendor / recurring charges context — owner only
    let vendorContext = "";
    if (rbacLevel < 4) {
      vendorContext = "";
    } else try {
      const { data: vendors } = await supabase.from("pnl_fsm_support_by_vendor").select("*");
      if (vendors && vendors.length > 0) {
        vendorContext = "\n\nVENDOR COSTS (FSM Drive):";
        for (const v of vendors) {
          vendorContext += `\n  ${v.vendor}: $${Number(v.vendor_total).toLocaleString()} total (${v.months_active} months, avg $${Number(v.avg_monthly).toLocaleString()}/mo) \u2014 ${v.vendor_status}`;
        }
      }
      const { data: lineItems } = await supabase.from("pnl_fsm_support_by_line_item").select("*");
      if (lineItems && lineItems.length > 0) {
        vendorContext += "\n\n  LINE ITEMS:";
        for (const li of lineItems) {
          vendorContext += `\n    ${li.vendor} / ${li.line_item}: $${Number(li.running_total).toLocaleString()} YTD${li.usage_based ? ' (usage-based)' : ' @ $' + Number(li.current_rate).toLocaleString() + '/' + li.cadence}`;
        }
      }
      const { data: reimb } = await supabase.from("reimbursements_owed").select("*");
      if (reimb && reimb.length > 0) {
        vendorContext += "\n\n  REIMBURSEMENTS OWED:";
        for (const r of reimb) {
          vendorContext += `\n    ${r.owner}: $${Number(r.amount_owed).toLocaleString()} (${r.charge_count} charges via ${r.account_name})`;
        }
      }
    } catch {}

    // API usage context — owner/admin only
    let apiUsageContext = "";
    if (rbacLevel < 3) {
      apiUsageContext = "";
    } else try {
      const { data: usage } = await supabase.from("api_usage_monthly").select("*").limit(3);
      if (usage && usage.length > 0) {
        apiUsageContext = "\n\nAPI USAGE:";
        for (const u of usage) {
          apiUsageContext += `\n  ${u.usage_month}: ${u.api_calls} calls, ${u.total_tokens?.toLocaleString()} tokens, est. $${Number(u.estimated_cost).toFixed(2)} (${u.unique_users} users)`;
        }
      }
    } catch {}

    // Payment accounts — owner only
    let paymentContext = "";
    if (rbacLevel < 4) {
      paymentContext = "";
    } else try {
      const { data: accounts } = await supabase.from("payment_accounts").select("*").eq("status", "active");
      if (accounts && accounts.length > 0) {
        paymentContext = "\n\nPAYMENT ACCOUNTS:";
        for (const a of accounts) {
          paymentContext += `\n  ${a.name} (${a.account_type}) \u2014 Owner: ${a.owner}, Status: ${a.status}${a.reimbursable ? ', REIMBURSABLE' : ''}`;
        }
      }
    } catch {}

    // Documents
    let documentContext = "";
    try {
      const { data: docs } = await supabase.from("documentation")
        .select("id, title, content, category, source_type, source_name, confidence, uploaded_by, created_at, status, superseded_by, version, effective_date, expiry_date, min_role")
        .order("created_at", { ascending: false }).limit(50);
      if (docs && docs.length > 0) {
        const roleAllowed = d => !d.min_role || (ROLE_LEVELS[d.min_role] || 1) <= rbacLevel;
        const activeDocs = docs.filter(d => (d.status === 'active' || !d.status) && roleAllowed(d));
        const supersededDocs = docs.filter(d => d.status === 'superseded' && roleAllowed(d));
        if (activeDocs.length > 0) {
          documentContext = "\n\nACTIVE DOCUMENTS:";
          for (const d of activeDocs) {
            documentContext += `\n\n--- Document #${d.id}: ${d.title} ---`;
            documentContext += `\n  Category: ${d.category || 'uncategorized'} | Source: ${d.source_type || 'document'}${d.source_name ? ' from ' + d.source_name : ''} | Confidence: ${d.confidence || 'direct'}`;
            if (d.version) documentContext += ` | Version: ${d.version}`;
            if (d.effective_date) documentContext += ` | Effective: ${d.effective_date}`;
            documentContext += `\n  Uploaded: ${d.created_at}${d.uploaded_by ? ' by ' + d.uploaded_by : ''}`;
            const contentPreview = d.content && d.content.length > 2000 ? d.content.substring(0, 2000) + '... [truncated]' : d.content;
            if (contentPreview) { documentContext += `\n  Content: ${contentPreview}`; }
          }
        }
        if (supersededDocs.length > 0) {
          documentContext += "\n\nSUPERSEDED DOCUMENTS (replaced \u2014 use with caution):";
          for (const d of supersededDocs) {
            documentContext += `\n  #${d.id}: ${d.title} [SUPERSEDED by #${d.superseded_by}]`;
            if (d.version) documentContext += ` (was ${d.version})`;
          }
        }
      }
    } catch {}

    // FSM definitions (for diagram generation)
    let fsmDefinitionsContext = "";
    try {
      const { data: defs } = await supabase.from("fsm_definitions").select("fsm_name, description");
      const { data: states } = await supabase.from("fsm_states").select("fsm_name, state_id, label");
      const { data: trans } = await supabase.from("fsm_transitions_def").select("fsm_name, from_state_id, to_state_id, label");
      if (defs && states && trans) {
        fsmDefinitionsContext = "\n\nFSM DEFINITIONS (for diagram generation):";
        for (const d of defs) {
          fsmDefinitionsContext += `\n\n  FSM: ${d.fsm_name}${d.description ? ' \u2014 ' + d.description : ''}`;
          const fsmStates = states.filter(s => s.fsm_name === d.fsm_name);
          const fsmTrans = trans.filter(t => t.fsm_name === d.fsm_name);
          if (fsmStates.length > 0) {
            fsmDefinitionsContext += `\n    States: ${fsmStates.map(s => s.label || s.state_id).join(', ')}`;
          }
          if (fsmTrans.length > 0) {
            fsmDefinitionsContext += `\n    Transitions:`;
            for (const t of fsmTrans) {
              const fromLabel = fsmStates.find(s => s.state_id === t.from_state_id)?.label || t.from_state_id;
              const toLabel = fsmStates.find(s => s.state_id === t.to_state_id)?.label || t.to_state_id;
              fsmDefinitionsContext += `\n      ${fromLabel} --> ${toLabel}${t.label ? ': ' + t.label : ''}`;
            }
          }
        }
      }
    } catch {}

    // ── RBAC notice for restricted users ──
    let rbacNotice = '';
    if (rbacLevel < 4) {
      const restricted = [];
      if (rbacLevel < 4) restricted.push('financial data', 'vendor costs', 'reimbursements', 'payment accounts');
      if (rbacLevel < 3) restricted.push('API usage data', 'team email addresses');
      rbacNotice = `\n\nACCESS LEVEL: ${rbacRole} (level ${rbacLevel}/4). The following data is not available to this user: ${restricted.join(', ')}. If asked about these topics, explain that access is restricted and suggest contacting an administrator. Do NOT guess or fabricate restricted data.`;
    }

    // ── Build system prompt ──
    const systemPrompt = `You are the Chat conductor for ${instanceName}, serving ${customerName}.
Instance code: ${instanceCode}

YOUR ROLE: You are an intelligent conductor with live access to the operational database. Every answer is grounded in actual data.

TEAM:
${teamContext}

OPERATIONAL STATE:
${fsmContext}${instanceContext}${transitionContext}${advisoryContext}${resourceContext}${financialContext}${vendorContext}${apiUsageContext}${paymentContext}${documentContext}${fsmDefinitionsContext}${rbacNotice}

RULES:
1. PROBLEM-SOLUTION: Never present dead ends. Always offer actions.
2. INSTANCE AWARENESS: You have full instance details, transition history, and financial data.
3. ADVISORY AWARENESS: Present CRITICAL first, OVERDUE prominently, PRIORITY early.
4. FINANCIAL INTELLIGENCE: You have the Living P&L, vendor costs, reimbursement data, and API usage. Compute from actual data.
5. DOCUMENT AWARENESS: Cite document title, source, and who provided it.
6. SOURCE ATTRIBUTION: Always attribute facts to their sources.
7. DOCUMENT LIFECYCLE: Prefer ACTIVE documents. Warn when referencing superseded documents.
8. STYLE: Direct, warm, competent. Use names. Format with tables when appropriate.
9. DOMAIN: ${domainContext}
10. VISUAL DIAGRAMS: When asked to show, visualize, diagram, draw, or chart, output a mermaid fenced code block. The frontend renders it visually. Use real data. For FSM workflows use stateDiagram-v2. For distributions use pie. For processes use flowchart. Keep to 15 nodes max.`;

    // ── Call Anthropic API ──
    const realHistory = (Array.isArray(history) ? history : []).slice(-12).map(m => ({ role: m.role, content: m.content }));
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [...realHistory, { role: "user", content: message }]
      })
    });

    const data = await response.json();
    if (data.error) { console.error("Anthropic API error:", JSON.stringify(data.error)); }
    if (!response.ok) { console.error("Anthropic API non-OK:", response.status, JSON.stringify(data)); }

    const reply = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n")
      || "I'm having trouble connecting right now. Please try again in a moment.";

    // ── Log API usage ──
    try {
      const usage = data.usage;
      if (usage) {
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const totalTokens = inputTokens + outputTokens;
        const estimatedCost = (inputTokens * INPUT_COST_PER_TOKEN) + (outputTokens * OUTPUT_COST_PER_TOKEN);
        await supabase.from("api_usage_log").insert({
          instance_code: instanceCode,
          user_id: user,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: totalTokens,
          model: MODEL,
          estimated_cost_usd: Number(estimatedCost.toFixed(6)),
          message_preview: message.substring(0, 100)
        });
      }
    } catch (logErr) {
      console.error("Usage log error:", logErr);
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Chat API error:", error.message);
    return res.status(200).json({
      reply: "I'm having trouble connecting right now. Please try again in a moment."
    });
  }
}
