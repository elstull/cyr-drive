// UNIFIED CHAT API — v5.3.0 (mermaid mindmap syntax safety + diagram quality rules)
//
// New in v5.3.0:
//   • Rule #6 expanded with explicit Mermaid syntax-safety guidance to prevent
//     parse errors in mindmap output (no checkmarks suffixed to node labels,
//     quote labels containing parentheses or special characters, separate
//     "Recently Shipped" from active items into distinct branches).
//   • No schema changes. No new helpers. System-prompt rules only.
//
// New in v5.2.0:
//   - Loads open todos and recent work_log entries into the system prompt
//     context for platform owners (you and Rick on a1ai).
//   - Non-platform-owners see no change. The loader silently no-ops for
//     them, matching the RLS posture on the underlying tables.
//   - Asking Chat "what's open?" or "what did we ship this week?" now
//     returns the actual answer rather than "I don't have visibility
//     into that."
//
// v5.1.0 (existing): conversation persistence (RC-001/003)
// v5.0.0 (existing): RBAC-governed intelligence per DN-008
//
// RBAC: owner(4) > admin(3) > member(2) > viewer(1)  — data tier
// Platform: owner | member  — meta tier (AcuityFirst people vs everyone else)

import { createClient } from '@supabase/supabase-js';
import { verifyAuth } from './_auth.js';

const INPUT_COST_PER_TOKEN = 5.0 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 25.0 / 1_000_000;
const MODEL = 'claude-opus-4-7';

function rbacLevel(r) {
  return r === 'owner' ? 4 : r === 'admin' ? 3 : r === 'member' ? 2 : r === 'viewer' ? 1 : 0;
}

// ── RC-001/003: conversation persistence helpers (unchanged from v5.1.0) ──
async function ensureConversation(supabase, ownerId, conversationId) {
  if (conversationId) return conversationId;
  try {
    const { data, error } = await supabase
      .from('conversations')
      .insert({ owner_id: ownerId })
      .select('id')
      .single();
    if (error) { console.warn('ensureConversation:', error.message); return null; }
    return data?.id || null;
  } catch (e) {
    console.warn('ensureConversation exception:', e.message);
    return null;
  }
}

async function persistMessage(supabase, conversationId, userId, role, content) {
  if (!conversationId) return;
  try {
    await supabase.from('assistant_conversations').insert({
      user_id: userId,
      role,
      content,
      conversation_id: conversationId,
    });
  } catch (e) {
    console.warn('persistMessage exception:', e.message);
  }
}

// ── v5.2.0: work-tracking context for platform owners ──
// Returns formatted text describing current todos + recent work_log,
// or empty string for non-owners. Wrapped in try/catch so missing tables
// (e.g., on customer instances pre-migration) gracefully no-op.
async function loadWorkTrackingContext(supabase, platformRole) {
  if (platformRole !== 'owner') return '';
  try {
    const { data: todos, error: todoErr } = await supabase
      .from('todo')
      .select('id, title, status, priority, post_date, related_to, notes')
      .eq('status', 'open')
      .order('post_date', { ascending: false })
      .limit(40);

    const { data: log, error: logErr } = await supabase
      .from('work_log')
      .select('title, what_changed, why_it_mattered, post_date, related_to')
      .order('post_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(15);

    if (todoErr && logErr) return '';  // both failed — likely no tables

    const priorityRank = (p) => p === 'high' ? 1 : p === 'normal' ? 2 : p === 'as needed' ? 3 : 4;
    const sortedTodos = (todos || []).slice().sort((a, b) => {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return (b.post_date || '').localeCompare(a.post_date || '');
    });

    let ctx = '';

    if (sortedTodos.length > 0) {
      ctx += '\n\nOPEN TODOS (work tracking — platform owners only):';
      for (const t of sortedTodos) {
        const prio = t.priority || 'unspecified';
        const ref = t.related_to ? ` [${t.related_to}]` : '';
        ctx += `\n  - [${t.id}] (${prio}, posted ${t.post_date}) ${t.title}${ref}`;
        if (t.notes) {
          // First ~200 chars of notes, single line
          const preview = t.notes.replace(/\s+/g, ' ').trim().slice(0, 200);
          ctx += `\n      notes: ${preview}${t.notes.length > 200 ? '...' : ''}`;
        }
      }
    }

    if (log && log.length > 0) {
      ctx += '\n\nRECENT WORK_LOG (last 15 entries):';
      for (const w of log) {
        const ref = w.related_to ? ` [${w.related_to}]` : '';
        ctx += `\n  - (${w.post_date}) ${w.title}${ref}`;
        if (w.why_it_mattered) {
          const preview = w.why_it_mattered.replace(/\s+/g, ' ').trim().slice(0, 150);
          ctx += `\n      why: ${preview}${w.why_it_mattered.length > 150 ? '...' : ''}`;
        }
      }
    }

    return ctx;
  } catch (e) {
    console.warn('loadWorkTrackingContext exception:', e.message);
    return '';
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, history, userId, userName, conversationId } = req.body;
    const user = userName || userId;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(200).json({ reply: "Database not configured." });
    if (!anthropicKey) return res.status(200).json({ reply: "AI service not configured." });
    const supabase = createClient(supabaseUrl, supabaseKey);

    const auth = await verifyAuth(req, res, supabase);
    if (!auth) return;

    // ── RC-001/003: establish conversation thread, persist user message ──
    const activeConvId = await ensureConversation(supabase, userId, conversationId);
    await persistMessage(supabase, activeConvId, userId, 'user', message);

    // ── Resolve RBAC role + platform role (v5.2.0: also reads platform_role) ──
    let userRbacRole = 'viewer', userLevel = 1, platformRole = 'member';
    try {
      const { data: u } = await supabase
        .from("fsm_users")
        .select("rbac_role, platform_role")
        .eq("id", userId)
        .single();
      if (u?.rbac_role) { userRbacRole = u.rbac_role; userLevel = rbacLevel(userRbacRole); }
      if (u?.platform_role) { platformRole = u.platform_role; }
    } catch {}

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

    // ── Chart injection (unchanged) ──
    const msgLower = message.toLowerCase();
    const wantsChart = msgLower.includes('pie') || msgLower.includes('chart')
      || (msgLower.includes('draw') && (msgLower.includes('visual') || msgLower.includes('diagram')));
    const isFinancial = msgLower.includes('expense') || msgLower.includes('cost')
      || msgLower.includes('vendor') || msgLower.includes('financial')
      || msgLower.includes('spend') || msgLower.includes('budget')
      || msgLower.includes('p&l') || msgLower.includes('pnl');

    if (wantsChart) {
      if (isFinancial && userLevel < 3) {
        const denial = "Financial data requires authorized access. Please contact your administrator.";
        await persistMessage(supabase, activeConvId, userId, 'assistant', denial);
        return res.status(200).json({ reply: denial, conversation_id: activeConvId });
      }
      let chartReply = '';
      if (isFinancial) {
        const { data: vendors } = await supabase.from("pnl_fsm_support_by_vendor").select("*");
        const { data: lineItems } = await supabase.from("pnl_fsm_support_by_line_item").select("*");
        if (vendors?.length > 0) {
          chartReply = "Here's the vendor cost breakdown:\n\n```mermaid\npie title Costs by Vendor";
          for (const v of vendors) chartReply += `\n    "${v.vendor}" : ${Number(v.vendor_total)}`;
          chartReply += '\n```\n';
        }
        if (lineItems?.length > 0) {
          chartReply += '\n```mermaid\npie title Costs by Line Item';
          for (const li of lineItems) if (Number(li.running_total) > 0) chartReply += `\n    "${li.line_item}" : ${Number(li.running_total)}`;
          chartReply += '\n```\n';
          chartReply += '\n| Vendor | Line Item | Type | YTD |\n|---|---|---|---|';
          for (const li of lineItems) {
            const type = li.usage_based ? 'variable' : `$${Number(li.current_rate)}/${li.cadence}`;
            chartReply += `\n| ${li.vendor} | ${li.line_item} | ${type} | $${Number(li.running_total).toFixed(2)} |`;
          }
          chartReply += `\n| **Total** | | | **$${lineItems.reduce((s, li) => s + Number(li.running_total), 0).toFixed(2)}** |`;
        }
        if (!chartReply) chartReply = 'No vendor cost data found.';
      } else {
        const { data: all } = await supabase.from("fsm_instances").select("status, fsm_name");
        chartReply = "FSM instance breakdown:\n";
        if (all?.length > 0) {
          const sc = {}; all.forEach(i => sc[i.status] = (sc[i.status]||0)+1);
          chartReply += '\n```mermaid\npie title Instances by Status';
          for (const s in sc) chartReply += `\n    "${s}" : ${sc[s]}`;
          chartReply += '\n```\n';
          const tc = {}; all.forEach(i => tc[i.fsm_name] = (tc[i.fsm_name]||0)+1);
          chartReply += '\n```mermaid\npie title Instances by FSM Type';
          for (const t in tc) chartReply += `\n    "${t}" : ${tc[t]}`;
          chartReply += '\n```\n';
        } else chartReply += 'No instances found.';
      }
      try { await supabase.from("api_usage_log").insert({ instance_code: instanceCode, user_id: user, input_tokens: 0, output_tokens: 0, total_tokens: 0, model: 'server-generated', estimated_cost_usd: 0, message_preview: message.substring(0, 100) }); } catch {}
      await persistMessage(supabase, activeConvId, userId, 'assistant', chartReply);
      return res.status(200).json({ reply: chartReply, conversation_id: activeConvId });
    }

    // ═══════════════════════════════════════════════════════════════════
    // BUILD RBAC-FILTERED CONTEXT
    // ═══════════════════════════════════════════════════════════════════

    // Team
    let teamCtx = "No team members found.";
    try {
      const { data: team } = await supabase.from("fsm_users").select("id, name, role, rbac_role, email").order("name");
      if (team?.length > 0) {
        teamCtx = userLevel >= 3
          ? team.map(u => `${u.name} (${u.id}) — ${u.role} [${u.rbac_role}]${u.email ? ', ' + u.email : ''}`).join("\n")
          : team.map(u => `${u.name} — ${u.role}`).join("\n");
      }
    } catch {}

    // FSM summary
    let fsmCtx = "FSM summary not available.";
    try { const { data } = await supabase.rpc("get_fsm_summary"); if (data) fsmCtx = "FSM Summary:\n" + JSON.stringify(data, null, 2); } catch {}

    // Active instances
    let instCtx = "";
    try {
      const { data: inst } = await supabase.from("fsm_instances")
        .select("id, fsm_name, label, current_state_name, status, priority, started_by, entity_type, entity_id, memory, updated_at")
        .order("updated_at", { ascending: false }).limit(50);
      if (inst?.length > 0) {
        instCtx = "\n\nACTIVE INSTANCES:\n";
        for (const i of inst) {
          instCtx += `\n- [${i.id}] ${i.label || i.fsm_name} | State: ${i.current_state_name} | Status: ${i.status} | Lead: ${i.started_by}`;
          if (i.memory && Object.keys(i.memory).length > 0) instCtx += ` | Data: ${JSON.stringify(i.memory)}`;
        }
      }
    } catch {}

    // Recent transitions
    let transCtx = "";
    try {
      const { data: tr } = await supabase.from("instance_transitions")
        .select("instance_id, from_state_name, to_state_name, transition_label, triggered_by, fired_at")
        .order("fired_at", { ascending: false }).limit(50);
      if (tr?.length > 0) {
        transCtx = "\n\nRECENT TRANSITIONS:\n";
        for (const t of tr) transCtx += `  ${t.instance_id}: ${t.from_state_name||'?'} → ${t.to_state_name||'?'} by ${t.triggered_by} at ${t.fired_at}${t.transition_label ? ' ('+t.transition_label+')' : ''}\n`;
      }
    } catch {}

    // Advisories
    let advCtx = "";
    if (user) {
      try {
        const { data: pa } = await supabase.from("pending_advisories").select("*").eq("recipient", user);
        if (pa?.length > 0) {
          advCtx = `\n\nPENDING ADVISORIES FOR ${user}:`;
          for (const u of ['critical','priority','routine']) pa.filter(a => a.urgency === u).forEach(a => { advCtx += `\n${u.toUpperCase()}: ${a.title}`; });
        }
      } catch {}
    }

    // Resources
    let resCtx = "";
    try {
      const { data: sz } = await supabase.rpc("get_database_size");
      const { data: uc } = await supabase.from("fsm_users").select("id", { count: "exact" });
      resCtx = `\nResources: DB ${sz || '?'}, Team ${uc?.length || 0}`;
    } catch {}

    // ── RBAC: Financial (owner/admin, level >= 3) ──
    let finCtx = "", apiCtx = "";
    if (userLevel >= 3) {
      try {
        const { data: pp } = await supabase.from("pnl_by_process").select("*");
        if (pp?.length > 0) {
          finCtx = "\n\nFINANCIAL SUMMARY (Living P&L):";
          for (const p of pp) finCtx += `\n  ${p.process_type}: ${p.engagements} engagements, Rev $${Number(p.revenue).toLocaleString()}, Costs $${Number(p.costs).toLocaleString()}, Margin ${p.margin_pct}%`;
        }
        const { data: pt } = await supabase.from("pnl_by_team_member").select("*");
        if (pt?.length > 0) { finCtx += "\n\nBY TEAM MEMBER:"; for (const p of pt) finCtx += `\n  ${p.member_name}: ${p.engagements} engagements, Margin $${Number(p.gross_margin).toLocaleString()}`; }
        const { data: ef } = await supabase.from("financial_summary").select("*");
        if (ef?.length > 0) { finCtx += "\n\nENGAGEMENT FINANCIALS:"; for (const e of ef) finCtx += `\n  ${e.engagement}: Rev $${Number(e.total_revenue).toLocaleString()} | Costs $${Number(e.total_cost).toLocaleString()} | AR $${Number(e.outstanding_ar).toLocaleString()}`; }
      } catch {}
      try {
        const { data: u } = await supabase.from("api_usage_monthly").select("*").limit(3);
        if (u?.length > 0) { apiCtx = "\n\nAPI USAGE:"; for (const x of u) apiCtx += `\n  ${x.usage_month}: ${x.api_calls} calls, $${Number(x.estimated_cost).toFixed(2)}`; }
      } catch {}
    }

    // ── RBAC: Vendor/payment (owner only, level >= 4) ──
    let vendCtx = "", payCtx = "";
    if (userLevel >= 4) {
      try {
        const { data: v } = await supabase.from("pnl_fsm_support_by_vendor").select("*");
        if (v?.length > 0) { vendCtx = "\n\nVENDOR COSTS:"; for (const x of v) vendCtx += `\n  ${x.vendor}: $${Number(x.vendor_total).toLocaleString()} (avg $${Number(x.avg_monthly).toLocaleString()}/mo)`; }
        const { data: li } = await supabase.from("pnl_fsm_support_by_line_item").select("*");
        if (li?.length > 0) { vendCtx += "\n  LINE ITEMS:"; for (const x of li) vendCtx += `\n    ${x.vendor}/${x.line_item}: $${Number(x.running_total).toLocaleString()} YTD`; }
        const { data: r } = await supabase.from("reimbursements_owed").select("*");
        if (r?.length > 0) { vendCtx += "\n  REIMBURSEMENTS:"; for (const x of r) vendCtx += `\n    ${x.owner}: $${Number(x.amount_owed).toLocaleString()}`; }
      } catch {}
      try {
        const { data: a } = await supabase.from("payment_accounts").select("*").eq("status", "active");
        if (a?.length > 0) { payCtx = "\n\nPAYMENT ACCOUNTS:"; for (const x of a) payCtx += `\n  ${x.name} (${x.account_type}) — ${x.owner}${x.reimbursable ? ' REIMBURSABLE' : ''}`; }
      } catch {}
    }

    // ── RBAC: Documents (filtered by min_role) ──
    let docCtx = "";
    try {
      const { data: docs } = await supabase.from("documentation")
        .select("id, title, content, category, source_type, source_name, confidence, uploaded_by, created_at, status, superseded_by, version, min_role")
        .order("created_at", { ascending: false }).limit(50);
      if (docs?.length > 0) {
        const accessible = docs.filter(d => userLevel >= rbacLevel(d.min_role || 'viewer'));
        const active = accessible.filter(d => d.status === 'active' || !d.status);
        const superseded = accessible.filter(d => d.status === 'superseded');
        if (active.length > 0) {
          docCtx = "\n\nACTIVE DOCUMENTS:";
          for (const d of active) {
            docCtx += `\n\n--- #${d.id}: ${d.title} ---`;
            docCtx += `\n  ${d.category || 'uncategorized'} | ${d.source_type || 'document'}${d.source_name ? ' from '+d.source_name : ''}${d.version ? ' | v'+d.version : ''}`;
            const preview = d.content?.length > 2000 ? d.content.substring(0, 2000) + '...' : d.content;
            if (preview) docCtx += `\n  ${preview}`;
          }
        }
        if (superseded.length > 0) { docCtx += "\n\nSUPERSEDED:"; for (const d of superseded) docCtx += `\n  #${d.id}: ${d.title} [replaced by #${d.superseded_by}]`; }
      }
    } catch {}

    // ── FSM definitions ──
    let fsmDefCtx = "";
    try {
      const { data: defs } = await supabase.from("fsm_definitions").select("fsm_name, description");
      const { data: states } = await supabase.from("fsm_states").select("fsm_name, state_id, label");
      const { data: trans } = await supabase.from("fsm_transitions_def").select("fsm_name, from_state_id, to_state_id, label");
      if (defs && states && trans) {
        fsmDefCtx = "\n\nFSM DEFINITIONS:";
        for (const d of defs) {
          fsmDefCtx += `\n  ${d.fsm_name}${d.description ? ' — '+d.description : ''}`;
          const fs = states.filter(s => s.fsm_name === d.fsm_name);
          const ft = trans.filter(t => t.fsm_name === d.fsm_name);
          if (fs.length > 0) fsmDefCtx += `\n    States: ${fs.map(s => s.label || s.state_id).join(', ')}`;
          if (ft.length > 0) for (const t of ft) {
            const fl = fs.find(s => s.state_id === t.from_state_id)?.label || t.from_state_id;
            const tl = fs.find(s => s.state_id === t.to_state_id)?.label || t.to_state_id;
            fsmDefCtx += `\n    ${fl} --> ${tl}${t.label ? ': '+t.label : ''}`;
          }
        }
      }
    } catch {}

    // ── v5.2.0: Work tracking (platform owners only) ──
    const workCtx = await loadWorkTrackingContext(supabase, platformRole);

    // ── System prompt ──
    const rbacNotice = userLevel < 4 ? `\n\nRBAC: User ${user} has ${userRbacRole} access. Only discuss data in your context. If asked about missing data, say "That requires authorized access." Never confirm or deny existence of restricted data.` : "";

    const platformOwnerNotice = platformRole === 'owner' ? `\n\nPLATFORM ROLE: ${user} is a platform owner (AcuityFirst principal). The OPEN TODOS and RECENT WORK_LOG sections below show internal platform-development tracking visible only to platform owners. When asked "what's open?" or "what's on the todo list?" or "what did we ship?", refer to these sections directly.` : "";

    const systemPrompt = `You are the Chat conductor for ${instanceName}, serving ${customerName}.
Instance: ${instanceCode} | User: ${user} (${userRbacRole}, platform: ${platformRole})

TEAM:\n${teamCtx}

OPERATIONAL STATE:
${fsmCtx}${instCtx}${transCtx}${advCtx}${resCtx}${finCtx}${vendCtx}${apiCtx}${payCtx}${docCtx}${fsmDefCtx}${workCtx}${rbacNotice}${platformOwnerNotice}

RULES:
1. Always offer actions, never dead ends.
2. Present CRITICAL advisories first.
3. Only discuss financial data present in context.
4. Cite document titles and sources.
5. Prefer ACTIVE documents over superseded.
6. For diagrams: use mermaid code blocks. stateDiagram-v2 for FSMs, pie for distributions, flowchart for processes, mindmap for hierarchical breakdowns.
   MERMAID SYNTAX SAFETY (mindmap parser is strict — these rules prevent rendering errors):
   • Do NOT suffix node labels with decoration characters like ✓, ✗, ★, →. The mindmap parser treats these as syntax tokens and fails.
   • If a label contains parentheses, a colon, a comma, or any non-ASCII character, wrap the entire label in double quotes: "Domain live (May 1)" not Domain live (May 1).
   • Indentation must be consistent — use the same number of spaces at each level. Tabs and spaces must not mix.
   • Avoid mixing inline status markers ("done", "shipped", checkmarks) into active-work nodes. If status matters to the visualization, use a separate parent branch ("Recently Shipped", "Active", "Blocked") and place items under the appropriate parent.
   STRUCTURAL QUALITY (these are demo-readiness rules):
   • Group nodes by status, not by mixing active and shipped items in the same branch. Readers should be able to scan one branch and answer "what's left to do" without filtering.
   • Keep node labels short (under 60 characters). Long labels wrap awkwardly in the rendered SVG.
   • Prefer 3-5 children per parent. Mindmaps with 10+ siblings under one parent become unreadable.
   • Do NOT mark nodes as "(?)" speculative inside the diagram itself; if a node is uncertain, omit it and mention the uncertainty in surrounding prose.
7. Never reveal data not in context. Say "requires authorized access" if asked.
8. ${domainContext}`;

    // ── Call Anthropic ──
    const realHistory = (Array.isArray(history) ? history : []).slice(-12).map(m => ({ role: m.role, content: m.content }));
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, system: systemPrompt, messages: [...realHistory, { role: "user", content: message }] })
    });
    const data = await response.json();
    const reply = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "Connection issue. Please try again.";

    // ── Persist assistant reply ──
    await persistMessage(supabase, activeConvId, userId, 'assistant', reply);

    // ── Log usage ──
    try {
      const u = data.usage;
      if (u) await supabase.from("api_usage_log").insert({
        instance_code: instanceCode, user_id: user,
        input_tokens: u.input_tokens||0, output_tokens: u.output_tokens||0, total_tokens: (u.input_tokens||0)+(u.output_tokens||0),
        model: MODEL, estimated_cost_usd: Number(((u.input_tokens||0)*INPUT_COST_PER_TOKEN + (u.output_tokens||0)*OUTPUT_COST_PER_TOKEN).toFixed(6)),
        message_preview: message.substring(0, 100)
      });
    } catch {}

    return res.status(200).json({ reply, conversation_id: activeConvId });
  } catch (error) {
    console.error("Chat API error:", error.message);
    return res.status(200).json({ reply: "Connection issue. Please try again." });
  }
}
