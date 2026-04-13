import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const MAX_CHARS = 50000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { docId, filePath, fileType } = req.body || {};
  if (!docId || !filePath) {
    return res.status(400).json({ error: 'Missing docId or filePath' });
  }

  try {
    const { data: fileData, error: dlError } = await supabase.storage
      .from('documents')
      .download(filePath);

    if (dlError || !fileData) {
      return res.status(500).json({ error: 'Failed to download file', details: dlError?.message });
    }

    let content = '';

    if (fileType && fileType.startsWith('text/')) {
      content = await fileData.text();
    } else if (
      fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      filePath.endsWith('.docx')
    ) {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
    } else if (fileType === 'application/pdf' || filePath.endsWith('.pdf')) {
      content = '[PDF extraction not yet supported — upload .docx or .txt for full text]';
    } else {
      content = await fileData.text();
    }

    content = content.slice(0, MAX_CHARS);

    const { error: updateError } = await supabase
      .from('documentation')
      .update({ content })
      .eq('id', docId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update documentation row', details: updateError.message });
    }

    return res.status(200).json({ extracted: true, characters: content.length });
  } catch (err) {
    console.error('Extract error:', err);
    return res.status(500).json({ extracted: false, error: err.message });
  }
}
