// ═══════════════════════════════════════════════════════════════════════════
// TEXT EXTRACTION API — v1.1.0
//
// Vercel serverless function. Extracts text from uploaded documents.
// PDF: via Anthropic API (handles scanned docs, complex layouts, tables)
// DOCX: via mammoth
// TXT: direct read
//
// Usage:
//   POST /api/extract-text
//   { "documentId": 35 }           — extract one document
//   { "extractAll": true }         — extract all unprocessed documents
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { documentId, extractAll } = req.body;

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(200).json({ error: 'Database not configured' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find documents that need extraction
    let docs = [];

    if (documentId) {
      const { data, error } = await supabase
        .from('documentation')
        .select('id, title, file_path, content')
        .eq('id', documentId);
      if (error) return res.status(200).json({ error: 'Query failed', detail: error.message });
      docs = data || [];
    } else if (extractAll) {
      // Find docs with placeholder content
      const { data, error } = await supabase
        .from('documentation')
        .select('id, title, file_path, content')
        .not('file_path', 'is', null);
      if (error) return res.status(200).json({ error: 'Query failed', detail: error.message });
      // Filter to only those with placeholder or missing content
      docs = (data || []).filter(d =>
        !d.content ||
        d.content.length < 200 ||
        d.content.startsWith('[')
      );
    } else {
      return res.status(200).json({ error: 'Provide documentId or extractAll: true' });
    }

    if (docs.length === 0) {
      return res.status(200).json({ message: 'No documents to extract', processed: 0 });
    }

    const results = [];

    for (const doc of docs) {
      try {
        // Skip if already has real content
        if (doc.content && doc.content.length > 200 && !doc.content.startsWith('[')) {
          results.push({ id: doc.id, title: doc.title, status: 'skipped', reason: 'already has content' });
          continue;
        }

        if (!doc.file_path) {
          results.push({ id: doc.id, title: doc.title, status: 'skipped', reason: 'no file_path' });
          continue;
        }

        const ext = doc.file_path.split('.').pop().toLowerCase();

        // Download file from Supabase storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('documents')
          .download(doc.file_path);

        if (downloadError || !fileData) {
          results.push({ id: doc.id, title: doc.title, status: 'error', reason: 'download failed: ' + (downloadError?.message || 'no data') });
          continue;
        }

        let extractedText = '';

        if (ext === 'pdf') {
          // ── PDF extraction via Anthropic API ──
          if (!anthropicKey) {
            results.push({ id: doc.id, title: doc.title, status: 'error', reason: 'ANTHROPIC_API_KEY not configured for PDF extraction' });
            continue;
          }

          const buffer = Buffer.from(await fileData.arrayBuffer());
          const base64 = buffer.toString('base64');

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',  // Use Sonnet for extraction — cheaper than Opus
              max_tokens: 8192,
              messages: [{
                role: 'user',
                content: [
                  {
                    type: 'document',
                    source: {
                      type: 'base64',
                      media_type: 'application/pdf',
                      data: base64,
                    },
                  },
                  {
                    type: 'text',
                    text: 'Extract all text content from this document. Preserve the structure including headings, paragraphs, lists, and tables. Output only the extracted text, no commentary. If the document contains tables, format them clearly with columns aligned.',
                  },
                ],
              }],
            }),
          });

          const apiData = await response.json();

          if (apiData.error) {
            results.push({ id: doc.id, title: doc.title, status: 'error', reason: 'API error: ' + apiData.error.message });
            continue;
          }

          extractedText = apiData.content
            ?.filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n') || '';

        } else if (ext === 'docx') {
          // ── DOCX extraction via mammoth ──
          const mammoth = await import('mammoth');
          const buffer = Buffer.from(await fileData.arrayBuffer());
          const result = await mammoth.extractRawText({ buffer });
          extractedText = result.value;

        } else if (ext === 'txt') {
          // ── Plain text ──
          extractedText = await fileData.text();

        } else {
          results.push({ id: doc.id, title: doc.title, status: 'skipped', reason: `unsupported format: ${ext}` });
          continue;
        }

        // Clean up
        extractedText = extractedText
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        if (!extractedText || extractedText.length < 10) {
          results.push({ id: doc.id, title: doc.title, status: 'warning', reason: 'extraction produced little/no text', chars: extractedText.length });
          continue;
        }

        // Update the documentation record
        const { error: updateError } = await supabase
          .from('documentation')
          .update({
            content: extractedText,
            source_type: 'extracted',
            confidence: ext === 'pdf' ? 'machine' : 'machine',
          })
          .eq('id', doc.id);

        if (updateError) {
          results.push({ id: doc.id, title: doc.title, status: 'error', reason: 'update failed: ' + updateError.message });
        } else {
          results.push({ id: doc.id, title: doc.title, status: 'extracted', chars: extractedText.length, format: ext });
        }

      } catch (docError) {
        console.error(`Extraction error for doc ${doc.id}:`, docError);
        results.push({ id: doc.id, title: doc.title, status: 'error', reason: docError.message });
      }
    }

    const extracted = results.filter(r => r.status === 'extracted').length;
    const errors = results.filter(r => r.status === 'error').length;

    return res.status(200).json({
      message: `Processed ${docs.length} documents: ${extracted} extracted, ${errors} errors`,
      processed: docs.length,
      extracted,
      errors,
      results,
    });

  } catch (error) {
    console.error('Extract-text error:', error);
    return res.status(200).json({ error: 'Extraction failed', detail: error.message });
  }
}
