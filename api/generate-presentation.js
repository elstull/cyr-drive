// api/generate-presentation.js — v1.0
// Chat-generated, data-grounded, brand-consistent presentations
// User asks Chat for a presentation → Chat builds slides from live data → returns PPTX
//
// REQUIRES: npm install pptxgenjs
// Add to package.json: "pptxgenjs": "^3.12.0"

import { createClient } from '@supabase/supabase-js';
import PptxGenJS from 'pptxgenjs';
import { verifyAuth } from './_auth.js';

const MODEL = 'claude-opus-4-7';

// Aculine brand kit
const BRAND = {
  navy: '1F2937',
  blue: '3B82F6',
  green: '10B981',
  orange: 'F59E0B',
  purple: '8B5CF6',
  red: 'EF4444',
  white: 'FFFFFF',
  lightGray: 'F3F4F6',
  dark: '111827',
  fontFace: 'Arial',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, userId, userName } = req.body;
    const user = userName || userId;

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!supabaseUrl || !supabaseKey || !anthropicKey) {
      return res.status(200).json({ error: "Services not configured." });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const auth = await verifyAuth(req, res, supabase);
    if (!auth) return;

    // ── Gather operational context (same as chat.js) ──
    let instanceName = "FSM Drive", customerName = "Customer", instanceCode = "FSM";
    try {
      const { data: config } = await supabase.from("instance_config").select("key, value");
      if (config) {
        const cfg = Object.fromEntries(config.map(c => [c.key, c.value]));
        instanceCode = cfg.instance_code || instanceCode;
        instanceName = cfg.instance_name || instanceName;
        customerName = cfg.customer_name || customerName;
      }
    } catch {}

    let context = "";

    // FSM instances
    try {
      const { data } = await supabase.from("fsm_instances")
        .select("id, fsm_name, label, current_state_name, status, priority, started_by, updated_at")
        .order("updated_at", { ascending: false }).limit(30);
      if (data?.length > 0) {
        context += "\nACTIVE INSTANCES:\n";
        for (const i of data) context += `  ${i.label||i.fsm_name}: state=${i.current_state_name}, status=${i.status}, lead=${i.started_by}\n`;
      }
    } catch {}

    // Financial summary
    try {
      const { data } = await supabase.from("pnl_by_process").select("*");
      if (data?.length > 0) {
        context += "\nFINANCIAL SUMMARY:\n";
        for (const p of data) context += `  ${p.process_type}: ${p.engagements} engagements, Revenue $${Number(p.revenue)}, Costs $${Number(p.costs)}, Margin ${p.margin_pct}%\n`;
      }
    } catch {}

    // Vendor costs
    try {
      const { data } = await supabase.from("pnl_fsm_support_by_vendor").select("*");
      if (data?.length > 0) {
        context += "\nVENDOR COSTS:\n";
        for (const v of data) context += `  ${v.vendor}: $${Number(v.vendor_total)} total, avg $${Number(v.avg_monthly)}/mo\n`;
      }
    } catch {}

    // Team
    try {
      const { data } = await supabase.from("fsm_users").select("name, role").order("name");
      if (data?.length > 0) {
        context += "\nTEAM:\n";
        for (const u of data) context += `  ${u.name} — ${u.role}\n`;
      }
    } catch {}

    // Documents (titles only for context)
    try {
      const { data } = await supabase.from("documentation").select("title, category, version").eq("status", "active").limit(20);
      if (data?.length > 0) {
        context += "\nDOCUMENTS:\n";
        for (const d of data) context += `  ${d.title} (${d.category}${d.version ? ', v'+d.version : ''})\n`;
      }
    } catch {}

    // ── Ask Opus to generate slide structure as JSON ──
    const slidePrompt = `You are creating a professional presentation for ${instanceName} (${customerName}).
Tagline: "Collective Intelligence and Reasoning for Business"

OPERATIONAL DATA:
${context}

USER REQUEST: "${prompt}"

Generate a presentation as a JSON array of slides. Each slide has:
- "title": string (slide title)
- "subtitle": string (optional subtitle)
- "type": one of "title", "content", "bullets", "stats", "chart", "closing"
- "bullets": array of strings (for bullet slides)
- "stats": array of {"label": string, "value": string} (for stats slides)
- "chartData": array of {"label": string, "value": number} (for chart slides, pie chart data)
- "body": string (for content slides, 2-3 sentences)
- "notes": string (speaker notes)

Rules:
- First slide must be type "title" with the presentation title and subtitle
- Last slide must be type "closing" with a call to action
- Use REAL DATA from the operational context above — never fabricate numbers
- 6-10 slides total
- Keep bullet points concise (under 12 words each)
- Include at least one "stats" or "chart" slide with real numbers

Respond with ONLY the JSON array. No markdown, no backticks, no explanation.`;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages: [{ role: "user", content: slidePrompt }] })
    });
    const aiData = await aiResponse.json();
    const rawText = aiData.content?.filter(b => b.type === "text").map(b => b.text).join("") || "[]";

    let slides;
    try {
      slides = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      return res.status(200).json({ error: "Could not generate slide structure. Try rephrasing your request." });
    }

    // ── Build PPTX ──
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = customerName;
    pptx.company = 'Aculine, Inc.';
    pptx.subject = prompt;

    for (const slide of slides) {
      const s = pptx.addSlide();

      if (slide.type === 'title') {
        s.background = { color: BRAND.navy };
        s.addText(slide.title || 'Presentation', {
          x: 0.8, y: 1.5, w: 11.5, h: 1.5,
          fontSize: 36, fontFace: BRAND.fontFace, color: BRAND.white, bold: true
        });
        s.addText(slide.subtitle || '', {
          x: 0.8, y: 3.2, w: 11.5, h: 0.8,
          fontSize: 20, fontFace: BRAND.fontFace, color: BRAND.blue
        });
        s.addText('Collective Intelligence and Reasoning for Business', {
          x: 0.8, y: 6.2, w: 11.5, h: 0.5,
          fontSize: 14, fontFace: BRAND.fontFace, color: BRAND.green, italic: true
        });

      } else if (slide.type === 'bullets') {
        s.addText(slide.title || '', {
          x: 0.5, y: 0.3, w: 12, h: 0.8,
          fontSize: 28, fontFace: BRAND.fontFace, color: BRAND.navy, bold: true
        });
        const bullets = (slide.bullets || []).map(b => ({
          text: b, options: { fontSize: 18, fontFace: BRAND.fontFace, color: BRAND.dark, bullet: { code: '25CF', color: BRAND.blue }, paraSpaceAfter: 8 }
        }));
        s.addText(bullets, { x: 0.8, y: 1.4, w: 11, h: 5 });

      } else if (slide.type === 'stats') {
        s.addText(slide.title || 'Key Metrics', {
          x: 0.5, y: 0.3, w: 12, h: 0.8,
          fontSize: 28, fontFace: BRAND.fontFace, color: BRAND.navy, bold: true
        });
        const stats = slide.stats || [];
        const colW = 12 / Math.min(stats.length, 4);
        stats.slice(0, 4).forEach((stat, i) => {
          s.addText(stat.value, {
            x: 0.5 + i * colW, y: 2.0, w: colW - 0.3, h: 1.2,
            fontSize: 40, fontFace: BRAND.fontFace, color: BRAND.blue, bold: true, align: 'center'
          });
          s.addText(stat.label, {
            x: 0.5 + i * colW, y: 3.3, w: colW - 0.3, h: 0.8,
            fontSize: 16, fontFace: BRAND.fontFace, color: BRAND.dark, align: 'center'
          });
        });

      } else if (slide.type === 'chart') {
        s.addText(slide.title || 'Distribution', {
          x: 0.5, y: 0.3, w: 12, h: 0.8,
          fontSize: 28, fontFace: BRAND.fontFace, color: BRAND.navy, bold: true
        });
        const chartData = slide.chartData || [];
        if (chartData.length > 0) {
          s.addChart(pptx.charts.PIE, [{
            name: slide.title || 'Data',
            labels: chartData.map(d => d.label),
            values: chartData.map(d => d.value)
          }], {
            x: 2.5, y: 1.5, w: 8, h: 5,
            showLegend: true, legendPos: 'b', legendFontSize: 14,
            dataLabelFontSize: 12, showPercent: true,
            chartColors: [BRAND.blue, BRAND.green, BRAND.orange, BRAND.purple, BRAND.red, '14B8A6', 'EC4899']
          });
        }

      } else if (slide.type === 'closing') {
        s.background = { color: BRAND.navy };
        s.addText(slide.title || 'Next Steps', {
          x: 0.8, y: 1.5, w: 11.5, h: 1.5,
          fontSize: 36, fontFace: BRAND.fontFace, color: BRAND.white, bold: true
        });
        s.addText(slide.body || '', {
          x: 0.8, y: 3.2, w: 11.5, h: 2,
          fontSize: 20, fontFace: BRAND.fontFace, color: BRAND.lightGray
        });
        s.addText('Aculine, Inc. — Collective Intelligence and Reasoning for Business', {
          x: 0.8, y: 6.2, w: 11.5, h: 0.5,
          fontSize: 14, fontFace: BRAND.fontFace, color: BRAND.green, italic: true
        });

      } else {
        // Generic content slide
        s.addText(slide.title || '', {
          x: 0.5, y: 0.3, w: 12, h: 0.8,
          fontSize: 28, fontFace: BRAND.fontFace, color: BRAND.navy, bold: true
        });
        s.addText(slide.body || '', {
          x: 0.8, y: 1.4, w: 11, h: 5,
          fontSize: 18, fontFace: BRAND.fontFace, color: BRAND.dark
        });
      }

      // Speaker notes
      if (slide.notes) {
        s.addNotes(slide.notes);
      }
    }

    // ── Generate and return ──
    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });

    // Store in Supabase Storage
    const filename = `presentations/${instanceCode}_${Date.now()}.pptx`;
    try {
      await supabase.storage.from('documents').upload(filename, pptxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      });
    } catch {}

    // Log usage
    try {
      const u = aiData.usage;
      if (u) await supabase.from("api_usage_log").insert({
        instance_code: instanceCode, user_id: user,
        input_tokens: u.input_tokens||0, output_tokens: u.output_tokens||0,
        total_tokens: (u.input_tokens||0)+(u.output_tokens||0),
        model: MODEL, estimated_cost_usd: Number(((u.input_tokens||0)*5/1e6 + (u.output_tokens||0)*25/1e6).toFixed(6)),
        message_preview: `[PRESENTATION] ${prompt.substring(0, 80)}`
      });
    } catch {}

    // Return as downloadable file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="presentation.pptx"`);
    return res.status(200).send(Buffer.from(pptxBuffer));

  } catch (error) {
    console.error("Presentation error:", error.message);
    return res.status(200).json({ error: "Could not generate presentation. Please try again." });
  }
}
