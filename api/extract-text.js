// ═══════════════════════════════════════════════════════════════════════════
// TEXT EXTRACTION API — v1.0.0
//
// Vercel serverless function. Extracts text from uploaded documents.
// Supports PDF (via pdf-parse) and DOCX (via mammoth).
//
// Usage:
//   POST /api/extract-text
//   { "documentId": 35 }           — extract one document
//   { "extractAll": true }         — extract all unprocessed documents
//
// Called automatically after upload, or manually to backfill.
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

    if (!supabaseUrl || !supabaseKey) {
      return res.status(200).json({ error: 'Database not configured' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find documents that need extraction
    let query = supabase.from('documentation')
      .select('id, title, file_path, content')
      .not('file_path', 'is', null);

    if (documentId) {
      query = query.eq('id', documentId);
    } else if (extractAll) {
      // Find docs with placeholder content (not yet extracted)
      query = query.or('content.is.null,content.like.[%,content.like.%not yet supported%');
    } else {
      return res.status(200).json({ error: 'Provide documentId or extractAll: true' });
    }

    const { data: docs, error: queryError } = await query;

    if (queryError) {
      console.error('Query error:', queryError);
      return res.status(200).json({ error: 'Failed to query documents', detail: queryError.message });
    }

    if (!docs || docs.length === 0) {
      return res.status(200).json({ message: 'No documents to extract', processed: 0 });
    }

    const results = [];

    for (const doc of docs) {
      try {
        // Skip if already has real content (not a placeholder)
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
          // PDF extraction
          const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
          const buffer = Buffer.from(await fileData.arrayBuffer());
          const pdfData = await pdfParse(buffer);
          extractedText = pdfData.text;

        } else if (ext === 'docx') {
          // DOCX extraction
          const mammoth = await import('mammoth');
          const buffer = Buffer.from(await fileData.arrayBuffer());
          const result = await mammoth.extractRawText({ buffer });
          extractedText = result.value;

        } else if (ext === 'txt') {
          // Plain text
          extractedText = await fileData.text();

        } else {
          results.push({ id: doc.id, title: doc.title, status: 'skipped', reason: `unsupported format: ${ext}` });
          continue;
        }

        // Clean up extracted text
        extractedText = extractedText
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        if (!extractedText || extractedText.length < 10) {
          results.push({ id: doc.id, title: doc.title, status: 'warning', reason: 'extraction produced little/no text', chars: extractedText.length });
          continue;
        }

        // Update the documentation record with extracted text
        const { error: updateError } = await supabase
          .from('documentation')
          .update({
            content: extractedText,
            source_type: 'extracted',
            confidence: 'machine',
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
