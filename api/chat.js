// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED CHAT API — v3.1.0
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
// The code is IDENTICAL. The data makes each instance unique.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    // ── Read instance config from database ──
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

    // ── Team context ──
    let teamContext = "No team members found.";
    try {
      const { data: team } = await supabase.from("fsm_users").select("id, name, role, email").order("name");
      if (team && team.length > 0) {
        teamContext = team.map(u => `${u.name} (${u.id}) \u2014 ${u.role}${u.email ? ', ' + u.email : ''}`).join("\n");
      }
    } catch {}

    // ── FSM summary ──
    let fsmContext = "FSM summary not available.";
    try {
      const { data: fsmSummary } = await supabase.rpc("get_fsm_summary");
      if (fsmSummary) { fsmContext = "FSM Summary:\n" + JSON.stringify(fsmSummary, null, 2); }
    } catch {}

    // ── Active instances ──
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
          if (inst.memory && Object.keys(inst.memory).length > 0) { instanceContext += `\n  Data: ${JSON.stringify(inst.memory)}`; }
        }
      }
    } catch {}

    // ── Transition history ──
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

    // ── Advisories ──
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

    // ── Resources ──
    let resourceContext = "";
    try {
      const { data: dbSize } = await supabase.rpc("get_database_size");
      const { data: uc } = await supabase.from("fsm_users").select("id", { count: "exact" });
      resourceContext = `\nResources: DB ${dbSize || '?'}, Team ${uc?.length || 0}/10`;
    } catch {}

    // ── Financial context ──
    let financialContext = "";
    try {
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

    // ── Document awareness with lifecycle ──
    let documentContext = "";
    try {
      const { data: docs } = await supabase.from("documentation")
        .select("id, title, content, category, source_type, source_name, confidence, uploaded_by, created_at, status, superseded_by, version, effective_date, expiry_date")
        .order("created_at", { ascending: false }).limit(50);
      if (docs && docs.length > 0) {
        const activeDocs = docs.filter(d => d.status === 'active' || !d.status);
        const supersededDocs = docs.filter(d => d.status === 'superseded');

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

    // ── Build system prompt ──
    const systemPrompt = `You are the Chat conductor for ${instanceName}, serving ${customerName}.
Instance code: ${instanceCode}

YOUR ROLE: You are an intelligent conductor with live access to the operational database. Every answer is grounded in actual data.

TEAM:
${teamContext}

OPERATIONAL STATE:
${fsmContext}${instanceContext}${transitionContext}${advisoryContext}${resourceContext}${financialContext}${documentContext}

RULES:
1. PROBLEM-SOLUTION: Never present dead ends. Always offer actions.
2. INSTANCE AWARENESS: You have full instance details, transition history, and financial data.
3. ADVISORY AWARENESS: Present CRITICAL first, OVERDUE prominently, PRIORITY early.
4. FINANCIAL INTELLIGENCE: You have the Living P&L. Compute revenue, costs, margins, AR from actual data.
5. DOCUMENT AWARENESS: Cite document title, source, and who provided it.
6. SOURCE ATTRIBUTION: Always attribute facts to their sources.
7. DOCUMENT LIFECYCLE: Prefer ACTIVE documents. If referencing a superseded document, warn: "Note: this references [title] which has been superseded by [replacement]. The current version may differ." If asked about a superseded document, explain when and by what it was replaced.
8. STYLE: Direct, warm, competent. Use names. Format with tables when appropriate.
9. DOMAIN: ${domainContext}`;

    // ── Call Anthropic ──
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          ...(Array.isArray(history) ? history : []).slice(-12).map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: message },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Anthropic API error:", JSON.stringify(data.error));
    }

    const reply = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n")
      || "I'm having trouble connecting right now. Please try again in a moment.";

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Chat API error:", error.message);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ reply: "I'm having trouble connecting right now. Please try again in a moment." });
  }
}
